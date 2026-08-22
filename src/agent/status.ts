import type { OverlayType } from '../renderer/OverlayRenderer';
import type { ViewMode } from '../core/ViewMode';
import type { ToolType } from '../Game';
import type { AgentUi } from './AgentUi';
import {
  getPanelBridge, getScreen, getMenuPage, isSettingsOpen, getTutorialStatus,
  type MenuPage, type PanelId, type Screen, type TutorialStatus,
} from './registry';

/**
 * 玩家現在在看什麼。
 *
 * ## 為什麼要有這一支
 *
 * AI 在旁邊陪玩的話，開場第一句就要答得出玩家在哪個畫面。在這之前它只能間接猜:
 * 主選單上 `read.city` 會回 `nothing at path read.city` —— 那句話讀起來像是它自己
 * 打錯字，不像「你還沒開始遊戲」。
 *
 * ## 沒有遊戲的時候不要編
 *
 * 主選單與載入中都沒有 `Game`，所以工具、速度、暫停那些欄位**整個不存在**，
 * 而不是 `0` / `'select'` / `false`。回一個假的預設值，AI 會以為遊戲正在跑。
 */

export interface AgentStatus {
  /** 主選單、載入中、遊戲中。 */
  screen: Screen;
  /** 主選單停在哪一頁。不在主選單時是 `null`。 */
  menuPage: MenuPage | null;
  /** 開著哪個面板。UI 還沒起來或沒開就是 `null`。 */
  panel: PanelId | null;
  /** 設定畫面開著嗎。它不走面板橋，所以 `panel` 看不到它。 */
  settingsOpen: boolean;
  /** 新手教程走到哪。沒在跑就是 `null`。 */
  tutorial: TutorialStatus | null;

  // ── 以下只有 `screen === 'game'` 時才有 ──────────────────────────
  tool?: ToolType;
  paused?: boolean;
  speed?: number;
  viewMode?: ViewMode;
  overlay?: OverlayType;
  /** 畫面上那則訊息。 */
  notification?: string | null;
}

/**
 * 拼出現在的狀態。
 *
 * `ui` 是 `null` 代表還沒有 `Game`（主選單、載入中）。
 */
export function buildStatus(ui: AgentUi | null): AgentStatus {
  const screen = getScreen();

  const base: AgentStatus = {
    screen,
    menuPage: screen === 'menu' ? getMenuPage() : null,
    panel: getPanelBridge()?.get() ?? null,
    // UI 還沒起來（單元測試就沒有）就當作沒開、沒在跑教程,不丟例外 ——
    // 否則 status() 會變成一支在測試裡不能用的東西。
    settingsOpen: isSettingsOpen(),
    tutorial: getTutorialStatus(),
  };

  if (screen !== 'game' || !ui) return base;

  return {
    ...base,
    tool: ui.tool(),
    paused: ui.paused(),
    speed: ui.speed(),
    viewMode: ui.viewMode(),
    overlay: ui.overlay(),
    notification: ui.notification(),
  };
}
