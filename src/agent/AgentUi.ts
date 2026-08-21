import type { OverlayType } from '../renderer/OverlayRenderer';
import type { ViewMode } from '../core/ViewMode';
import type { ToolType } from '../Game';
import { getPanelBridge, isPanelId, PANEL_IDS, type PanelId } from './registry';

/**
 * 「玩家看得到、按得到」的那一層。
 *
 * 分成三種東西:
 *
 * | | 住在哪 | 怎麼碰 |
 * |---|---|---|
 * | 面板（Overview、Layers⋯） | Solid 的 `openModal` signal | 經過 `registry` 註冊的橋 |
 * | 圖層、聚焦視角、暫停、速度 | `Game` 上的公開方法 | 直接呼叫 |
 * | 鏡頭 | `SceneManager` | 直接呼叫 |
 *
 * 面板那一路在單元測試裡不存在（沒有 UI），所以橋沒註冊時回 `false` 而不是丟例外。
 */

export interface CameraTarget {
  /** 看向地圖上的哪一格。 */
  x?: number;
  y?: number;
  /**
   * 畫面高度換算成幾格。**這是正交相機的視錐高度，不是距離** —— 相機的
   * `cameraDistance` 改了幾乎不影響縮放。
   */
  size?: number;
  /** 方位角（弧度）。0 是軸向對齊，π/4 是預設的等角視角。 */
  angle?: number;
  /** 俯角（弧度）。遊戲自己的滾輪把它夾在 π/18 ~ 4π/9。 */
  elevation?: number;
}

export interface CameraState {
  x: number;
  y: number;
  size: number;
  angle: number;
  elevation: number;
}

/** AgentUi 碰得到的東西。用結構型別是為了能在沒有 Three.js 的情況下測。 */
export interface UiHost {
  currentTool: ToolType;
  viewMode: ViewMode;
  paused: boolean;
  speed: number;
  notification: string | null;
  setTool(tool: ToolType): void;
  setOverlay(type: OverlayType): void;
  getOverlay(): OverlayType;
  toggleViewMode(mode: ViewMode): void;
  togglePause(): void;
  changeSpeed(delta: number): void;
  camera(): CameraState;
  setCamera(target: CameraTarget): CameraState;
}

export class AgentUi {
  constructor(private readonly host: UiHost) {}

  // ── 面板 ────────────────────────────────────────────────────────

  /** 可以開哪些面板。 */
  panels(): readonly PanelId[] {
    return PANEL_IDS;
  }

  /** 現在開著哪一個。UI 還沒起來時回 `null`。 */
  panel(): PanelId | null {
    return getPanelBridge()?.get() ?? null;
  }

  /** 開一個面板。名字不對或 UI 還沒起來回 `false`。 */
  openPanel(id: string): boolean {
    if (!isPanelId(id)) return false;
    const bridge = getPanelBridge();
    if (!bridge) return false;
    bridge.set(id);
    return true;
  }

  closePanel(): boolean {
    const bridge = getPanelBridge();
    if (!bridge) return false;
    bridge.set(null);
    return true;
  }

  // ── 圖層與視角 ──────────────────────────────────────────────────

  overlay(): OverlayType {
    return this.host.getOverlay();
  }

  setOverlay(type: OverlayType): OverlayType {
    this.host.setOverlay(type);
    return this.host.getOverlay();
  }

  viewMode(): ViewMode {
    return this.host.viewMode;
  }

  /**
   * 切到某個聚焦視角。
   *
   * `Game` 只給 `toggleViewMode()` —— 同一個模式再按一次會跳回 NORMAL。程式要的是
   * 「設成這個」而不是「切換」，所以先退回 NORMAL 再切過去。已經在目標模式就不動。
   */
  setViewMode(mode: ViewMode): ViewMode {
    const current = this.host.viewMode;
    if (current === mode) return current;
    if (current !== ('NORMAL' as ViewMode)) this.host.toggleViewMode(current);
    if (mode !== ('NORMAL' as ViewMode)) this.host.toggleViewMode(mode);
    return this.host.viewMode;
  }

  // ── 工具 ────────────────────────────────────────────────────────

  tool(): ToolType {
    return this.host.currentTool;
  }

  /**
   * 只換工具，不動手。
   *
   * 要蓋東西走 `act()` —— 它會把 `placementMode` / `elevationLevel` / `currentRotation`
   * 一起設滿，這裡不會。
   */
  setTool(tool: ToolType): ToolType {
    this.host.setTool(tool);
    return this.host.currentTool;
  }

  // ── 時間 ────────────────────────────────────────────────────────

  paused(): boolean {
    return this.host.paused;
  }

  setPaused(paused: boolean): boolean {
    if (this.host.paused !== paused) this.host.togglePause();
    return this.host.paused;
  }

  speed(): number {
    return this.host.speed;
  }

  /**
   * 設遊戲速度。
   *
   * `Game` 只給 `changeSpeed(delta)`（工具列的 +／−），所以只能用相對值逼近。
   *
   * 速度是固定檔位（1 / 3 / 5 / 10）。目標不在檔位上時，天真的「還沒到就繼續按」會
   * **在目標兩側來回震盪** —— 要 7 就會 5 → 10 → 5 → 10 一直跳，最後停在哪一檔由
   * 迴圈上限決定，不是由目標決定。所以跨過目標就停，停在跨過去的那一檔。
   */
  setSpeed(target: number): number {
    for (let guard = 0; guard < 16; guard++) {
      const now = this.host.speed;
      if (now === target) break;
      const goingUp = target > now;
      this.host.changeSpeed(goingUp ? 1 : -1);
      const after = this.host.speed;
      if (after === now) break;                              // 到頂或到底
      if (goingUp ? after > target : after < target) break;   // 跨過去了
    }
    return this.host.speed;
  }

  // ── 鏡頭 ────────────────────────────────────────────────────────

  camera(): CameraState {
    return this.host.camera();
  }

  setCamera(target: CameraTarget): CameraState {
    return this.host.setCamera(target);
  }

  // ── 通知 ────────────────────────────────────────────────────────

  /** 遊戲現在顯示的那一則訊息。 */
  notification(): string | null {
    return this.host.notification;
  }
}
