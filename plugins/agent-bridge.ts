import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 讓**任何會 `curl` 的東西**操作遊戲。
 *
 * ```
 * 對方 AI ──POST /agent──▶ dev server ──HMR 通道──▶ 你開著的分頁 window.__agent
 *         ◀──── JSON ─────            ◀────────────
 * ```
 *
 * ## 為什麼需要它
 *
 * `window.__agent` 活在**瀏覽器分頁裡**。給對方一個網址，它 `curl` 到的只有 HTML ——
 * 除非它自己有瀏覽器工具（chrome-devtools MCP、Playwright），否則碰不到那個介面。
 * 而玩家的 Claude Code / Codex 不一定裝了那些。
 *
 * 有了這一段，交付就變成「網址 + `docs/agent-api.md`」，`curl` 是每個 agent 都有的。
 *
 * ## 只在 dev server 上
 *
 * 這一整支是 dev server 的 middleware，`npm run build` 出來的靜態檔裡沒有它 ——
 * 不是「關掉」，是那半邊根本沒地方住。頁面端也一樣（走 `import.meta.hot`，
 * build 之後是 `undefined`）。
 *
 * ## 只綁 localhost
 *
 * 沿用 vite 預設的 host。不加 `--host` 的話只有本機連得到 —— 而這個東西的用途
 * 正是「玩家自己的 AI 在自己的電腦上玩自己的遊戲」。
 */

const CALL_EVENT = 'agent-bridge:call';
const RESULT_EVENT = 'agent-bridge:result';

/** 等分頁回話最久多久。`newGame()` / `load()` 要重建整個 Game，會跑好幾秒。 */
const REPLY_TIMEOUT_MS = 30_000;

/** 一次請求的 body 最多多大。防的是手滑貼了一整份存檔進來。 */
const MAX_BODY_BYTES = 1_000_000;

interface Pending {
  settle: (payload: unknown) => void;
  timer: NodeJS.Timeout;
}

const USAGE = {
  usage: 'POST /agent with {"path":"read.city","args":[]}',
  examples: [
    { path: 'read.city' },
    { path: 'act', args: [{ tool: 'road', x1: 10, y1: 10, x2: 30, y2: 10 }] },
    { path: 'routes.create', args: ['bus', [1, 2], 2] },
    { path: 'ui.openPanel', args: ['overview'] },
  ],
  docs: 'docs/agent-api.md — the full interface, and why some of it is shaped the way it is',
  note: 'The game must be open in a browser tab; this relays calls into that tab.',
};

/**
 * 上色，但只在真的終端機上。
 *
 * 導向檔案時 ANSI 碼不會被任何人解讀，只會留下 `[32m` 這種垃圾在畫面上 ——
 * vite 自己的訊息會依環境去掉顏色，硬寫的不會。
 */
function c(text: string, code: string): string {
  return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(text);
}

/** 把 request body 讀成字串。超過上限就中止 —— 不把它整包收進記憶體再檢查。 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body too large (limit ${MAX_BODY_BYTES} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function agentBridge(): Plugin {
  const pending = new Map<string, Pending>();
  let nextId = 1;

  return {
    name: 'webcity-agent-bridge',
    // dev server 專屬。`build` 的時候這個 hook 根本不會被叫。
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      server.ws.on(RESULT_EVENT, (data: { id?: string }) => {
        if (!data || typeof data.id !== 'string') return;
        const waiting = pending.get(data.id);
        if (!waiting) return;   // 逾時之後才回來的，丟掉
        pending.delete(data.id);
        clearTimeout(waiting.timer);
        // `id` 是這座橋內部用來配對請求的，不是 API 的一部分 —— 不要外露。
        const { id: _id, ...response } = data as Record<string, unknown> & { id: string };
        waiting.settle(response);
      });

      server.middlewares.use('/agent', (req, res, next) => {
        if (req.method === 'GET') {
          json(res, 200, USAGE);
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }

        void (async () => {
          let call: { path?: unknown; args?: unknown };
          try {
            const body = await readBody(req);
            call = body.trim() === '' ? {} : JSON.parse(body) as typeof call;
          } catch (e) {
            json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
            return;
          }
          if (typeof call?.path !== 'string') {
            json(res, 400, { ok: false, error: 'missing path', ...USAGE });
            return;
          }

          // 沒有分頁連著就別等了。「忘了開遊戲」是最常見的失誤，讓它卡 30 秒
          // 才回一句猜測，不如當場說清楚。
          if (server.ws.clients.size === 0) {
            json(res, 503, {
              ok: false,
              error: 'no game page is connected — open the game in a browser first',
              openThis: `http://localhost:${server.config.server.port ?? ''}/`,
            });
            return;
          }

          const id = String(nextId++);
          const reply = await new Promise<unknown>((resolve) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              resolve({
                ok: false,
                error: 'the game page did not answer — is the game open in a browser tab?',
                timeoutMs: REPLY_TIMEOUT_MS,
              });
            }, REPLY_TIMEOUT_MS);
            pending.set(id, { settle: resolve, timer });
            server.ws.send(CALL_EVENT, { id, path: call.path, args: call.args });
          });

          // 分頁那邊已經把每一種失敗都變成 `{ ok: false, error }`，所以 HTTP 一律 200。
          // 呼叫端看 `ok` 就好，不必同時解讀狀態碼與內容。
          json(res, 200, reply);
        })();
      });

      // 印在 vite 自己那幾行網址**後面**。
      //
      // 原本是在 configureServer 裡直接印，而 vite 啟動時會清畫面 —— 那行就被
      // 擦掉了。在 log 檔裡看得到（檔案不會被清），在真的終端機上看不到，
      // 於是「讓人知道橋在」這個唯一的目的完全落空。
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        const port = server.config.server.port ?? '';
        server.config.logger.info(
          `  ${c('➜', '32')}  ${c('Agent', '1')}:   POST http://localhost:${port}/agent  ${c('(docs/agent-api.md)', '2')}`,
        );
      };
    },
  };
}
