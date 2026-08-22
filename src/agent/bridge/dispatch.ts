/**
 * 把一行 `{"path":"read.city","args":[]}` 變成真的呼叫。
 *
 * 整座橋只有這裡有邏輯，其餘（HTTP middleware、WebSocket）都是管線 —— 所以測試
 * 全部集中在這一支。
 *
 * ## 三件非做不可的事
 *
 * **路徑不能亂爬。** 那個字串從外面來。`read.constructor.constructor` 爬得到
 * `Function`，呼叫它就等於讓對方在頁面裡執行任意程式碼。所以只走**自有屬性**，
 * 而且明確擋掉原型鏈上那幾個名字。
 *
 * **不丟例外。** 呼叫端在另一個 process，例外冒出去只會變成一個沒有訊息的 500。
 * 每一種失敗都要變成 `{ ok: false, error }`。
 *
 * **回得出 JSON。** `commuteStats().byHome` 是 `Map`，`JSON.stringify` 把它變成 `{}`
 * —— 對方看到空物件，還以為是沒資料。
 */

/** 路徑最多幾段。`read.city` 是兩段，這個 API 沒有更深的東西。 */
export const MAX_PATH_DEPTH = 2;

/**
 * 永遠不走的屬性名。
 *
 * 少了這一份，`read.constructor.constructor('return process')()` 這種東西就成立了。
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export interface AgentCall {
  /** 例如 `read.city`、`act`、`routes.create`。 */
  path: string;
  args?: unknown[];
}

export interface AgentResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function fail(error: string): AgentResponse {
  return { ok: false, error };
}

/**
 * 走路徑取出那個函式，連同它所在的物件（`this` 要綁回去）。
 *
 * 取出函式之後直接呼叫會讓 `this` 變成 `undefined` —— `AgentRead.city()` 裡的
 * `this.getState()` 就炸了。
 */
function resolve(root: unknown, path: string): { fn: unknown; owner: unknown } | string {
  const segments = path.split('.');
  if (segments.length > MAX_PATH_DEPTH) {
    return `path is too deep (max ${MAX_PATH_DEPTH} segments): ${path}`;
  }
  if (segments.some(s => s.trim() === '')) {
    return `malformed path: ${JSON.stringify(path)}`;
  }

  let owner: unknown = null;
  let current: unknown = root;
  for (const segment of segments) {
    if (FORBIDDEN.has(segment)) return `refusing to walk into ${segment}`;
    if (current === null || typeof current !== 'object') {
      return `nothing at path ${path}`;
    }
    // 只走自有屬性 —— 繼承來的東西都在原型鏈上，那正是不該去的地方。
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      // 類別的方法住在 prototype 上，不是實例的自有屬性。所以自有屬性找不到時
      // 再問一次「這是不是它自己的類別方法」，但仍然不碰 Object.prototype。
      const proto = Object.getPrototypeOf(current) as object | null;
      if (!proto || proto === Object.prototype
        || !Object.prototype.hasOwnProperty.call(proto, segment)) {
        return `nothing at path ${path}`;
      }
    }
    owner = current;
    current = (current as Record<string, unknown>)[segment];
  }
  return { fn: current, owner };
}

/**
 * 換成 `JSON.stringify` 送得出去的形狀。
 *
 * `Map` → 成對的陣列、`Set` → 陣列。循環參照換成 `'[circular]'`（否則 stringify
 * 直接丟例外，而那會變成一個沒有訊息的 500）。
 */
export function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Map) return [...value].map(pair => jsonSafe(pair, seen));
  if (value instanceof Set) return [...value].map(v => jsonSafe(v, seen));
  if (Array.isArray(value)) return value.map(v => jsonSafe(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v, seen);
  return out;
}

/**
 * 呼叫 `root` 上那條路徑。
 *
 * `root` 是頁面上的 `window.__agent`。開局前它只有 `session` 一塊，主選單前更是
 * 什麼都沒有 —— 兩種都回錯誤而不是爆掉。
 */
export async function dispatch(root: unknown, call: AgentCall): Promise<AgentResponse> {
  if (root === null || root === undefined) {
    return fail('no agent yet — the game has not started');
  }
  const path = typeof call?.path === 'string' ? call.path.trim() : '';
  if (path === '') return fail('missing path');

  const found = resolve(root, path);
  if (typeof found === 'string') return fail(found);
  if (typeof found.fn !== 'function') return fail(`${path} is not callable`);

  const args = Array.isArray(call.args) ? call.args : [];
  try {
    const raw: unknown = await (found.fn as (...a: unknown[]) => unknown)
      .apply(found.owner, args);
    return { ok: true, result: jsonSafe(raw) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
