/**
 * The page half of the bridge.
 *
 * The dev server forwards a `POST /agent` **into this tab**, which executes it and sends the
 * result back.
 *
 * ## Why vite's own HMR channel
 *
 * `import.meta.hot` rather than a WebSocket of our own:
 *
 * - **No dependencies.** No `ws` to install and no reconnection to manage; vite's channel
 *   reconnects itself.
 * - **It disappears from a production build.** `import.meta.hot` is `undefined` after a build,
 *   so the `if` below is never entered. No environment check is needed and bundlers can see it
 *   is dead code.
 *
 * The second point is the important one: the bridge's server half lives in dev server
 * middleware and **is absent** from the static files `npm run build` produces. A page half that
 * survived would keep dialling something that is not there.
 */

import { dispatch, type AgentCall } from './dispatch';

/** dev server to tab: "run this". */
export const CALL_EVENT = 'agent-bridge:call';
/** Tab to dev server: "here is the result". */
export const RESULT_EVENT = 'agent-bridge:result';

/** One call. `id` matches the result back to the right HTTP request. */
export interface BridgeCall extends AgentCall {
  id: string;
}

if (import.meta.hot) {
  import.meta.hot.on(CALL_EVENT, (call: BridgeCall) => {
    // `window.__agent` is re-read every time: loading a save or starting a new game replaces it
    // entirely, and a held reference would point at the previous session.
    const root = (window as unknown as Record<string, unknown>).__agent;

    void dispatch(root, call).then((response) => {
      import.meta.hot?.send(RESULT_EVENT, { id: call.id, ...response });
    });
  });
}
