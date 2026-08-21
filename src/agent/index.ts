import type { Game } from '../Game';
import { serializeGameState } from '../core/save/Serializer';
import { AgentApi } from './AgentApi';
import { AgentRead } from './AgentRead';
import { AgentSession } from './AgentSession';
import { AgentUi, type CameraTarget, type UiHost } from './AgentUi';

export { AgentApi, AGENT_LIMITS } from './AgentApi';
export { AgentRead } from './AgentRead';
export { AgentSession } from './AgentSession';
export { AgentUi } from './AgentUi';
export * from './registry';

/**
 * `window.__agent` —— 遊戲裡看得到、按得到的東西，全部給程式一份。
 *
 * 分四塊:
 *
 * | | 做什麼 |
 * |---|---|
 * | `act()` | 蓋、拆、劃分區。走 `Game.handleToolAction()`，把工具狀態設滿 |
 * | `ui` | 開關面板、圖層、聚焦視角、工具、暫停與速度、鏡頭 |
 * | `read` | 城市數字、建築、居民、服務、大眾運輸、逐格資料 |
 * | `session` | 存檔清單、存檔、匯出、載入、開新局（**沒有刪除**） |
 */
export interface AgentRoot {
  act: AgentApi['act'];
  history: AgentApi['history'];
  ui: AgentUi;
  read: AgentRead;
  session: AgentSession;
}

/** `Game` 的形狀轉成 `AgentUi` 要的樣子。 */
function uiHost(game: Game): UiHost {
  const g = game as unknown as {
    overlayRenderer: { getOverlay(): string; };
    sceneManager: {
      getCameraState(): { x: number; y: number; size: number; angle: number; elevation: number };
      setCameraState(t: CameraTarget & { y?: number }): void;
    };
  };
  return {
    get currentTool() { return game.currentTool; },
    set currentTool(v) { game.currentTool = v; },
    get viewMode() { return game.viewMode; },
    set viewMode(v) { game.viewMode = v; },
    get paused() { return game.paused; },
    set paused(v) { game.paused = v; },
    get speed() { return game.speed; },
    set speed(v) { game.speed = v; },
    get notification() { return game.notification; },
    set notification(v) { game.notification = v; },
    setTool: (t) => game.setTool(t),
    setOverlay: (t) => game.setOverlay(t),
    getOverlay: () => g.overlayRenderer.getOverlay() as never,
    toggleViewMode: (m) => game.toggleViewMode(m),
    togglePause: () => game.togglePause(),
    changeSpeed: (d) => game.changeSpeed(d),
    camera: () => g.sceneManager.getCameraState(),
    setCamera: (t) => {
      g.sceneManager.setCameraState({ x: t.x, y: t.y, size: t.size, angle: t.angle, elevation: t.elevation });
      return g.sceneManager.getCameraState();
    },
  };
}

export function createAgent(game: Game): AgentRoot {
  const api = new AgentApi(game);
  const read = new AgentRead(() => game.getState(), game);
  const ui = new AgentUi(uiHost(game));
  const session = new AgentSession(
    () => serializeGameState(game.getState()),
    () => game.getState().citizens.getPopulation(),
  );

  return {
    act: (action) => api.act(action),
    history: () => api.history(),
    ui,
    read,
    session,
  };
}
