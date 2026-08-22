/**
 * 橋的頁面端。
 *
 * dev server 收到 `POST /agent` 之後把呼叫**轉進這個分頁**，這裡執行、把結果送回去。
 *
 * ## 為什麼用 vite 自己的 HMR 通道
 *
 * 走 `import.meta.hot` 而不是自己開一條 WebSocket:
 *
 * - **零相依**。不必裝 `ws`，不必自己管重連 —— vite 的通道斷線會自己接回來。
 * - **正式 build 自動消失**。`import.meta.hot` 在 build 之後是 `undefined`，
 *   下面整段 `if` 直接不成立。不需要任何環境判斷，而且打包工具看得出這是死程式碼。
 *
 * 那第二點是關鍵:這座橋的伺服器半邊住在 dev server 的 middleware 裡，`npm run build`
 * 出來的靜態檔**沒有那半邊**。頁面端如果還在，就會一直去連一個不存在的東西。
 */

import { dispatch, type AgentCall } from './dispatch';

/** dev server → 分頁:「執行這個」。 */
export const CALL_EVENT = 'agent-bridge:call';
/** 分頁 → dev server:「結果在這」。 */
export const RESULT_EVENT = 'agent-bridge:result';

/** 一次呼叫。`id` 用來把結果配回對的那個 HTTP 請求。 */
export interface BridgeCall extends AgentCall {
  id: string;
}

if (import.meta.hot) {
  import.meta.hot.on(CALL_EVENT, (call: BridgeCall) => {
    // `window.__agent` 每次重讀 —— 載入存檔與開新局會整個換掉它，抓在手上的
    // 參照會指著上一局。
    const root = (window as unknown as Record<string, unknown>).__agent;

    void dispatch(root, call).then((response) => {
      import.meta.hot?.send(RESULT_EVENT, { id: call.id, ...response });
    });
  });
}
