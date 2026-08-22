/**
 * 讓 agent 碰得到「不在 Game 上」的兩件事。
 *
 * 面板開關住在 Solid 的 `GameUIRoot` 裡（一個 `openModal` signal），開新局與載入住在
 * `main.ts`（它會整個拆掉 Game 再建一個）。兩者都不是 `Game` 的方法，agent 拿不到。
 *
 * 直接 import 會變成循環相依（main → agent → main）。所以反過來:那兩邊各自把自己的
 * 入口**註冊**進來，agent 從這裡取用。沒註冊就回報「不可用」，而不是丟例外 ——
 * 單元測試不會有 UI。
 */

export type PanelId = 'overview' | 'layers' | 'cityspec' | 'district' | 'transit' | 'debug';

export const PANEL_IDS: readonly PanelId[] = [
  'overview', 'layers', 'cityspec', 'district', 'transit', 'debug',
];

export function isPanelId(v: string): v is PanelId {
  return (PANEL_IDS as readonly string[]).includes(v);
}

export interface PanelBridge {
  get(): PanelId | null;
  set(id: PanelId | null): void;
}

export interface SessionBridge {
  /** 開一局新的。`mapConfig` 省略就用預設地圖。 */
  newGame(mapConfig?: unknown): Promise<void>;
  /** 載入某一格存檔。 */
  load(slotId: number): Promise<void>;
}

let panelBridge: PanelBridge | null = null;
let sessionBridge: SessionBridge | null = null;

export function registerPanelBridge(bridge: PanelBridge | null): void {
  panelBridge = bridge;
}

export function getPanelBridge(): PanelBridge | null {
  return panelBridge;
}

export function registerSessionBridge(bridge: SessionBridge | null): void {
  sessionBridge = bridge;
}

export function getSessionBridge(): SessionBridge | null {
  return sessionBridge;
}

/* ------------------------------------------------------------------ */
/*  玩家在看哪個畫面                                                    */
/* ------------------------------------------------------------------ */

/**
 * 狀態的擁有者有三個，所以分兩種機制。
 *
 * **導覽用推的**（`setScreen`）:畫面與選單分頁很少變，而且每一次都是離散的事件
 * （按了 Load Game、開始載入、載完了）。呼叫端就那幾個地方。
 *
 * **即時狀態用拉的**（`UiStateBridge`）:設定畫面與教程每一幀都可能不一樣，用推的
 * 話每個切換點都得記得通知 —— 漏掉一個不會有任何徵兆，只是靜靜地過時。
 */

export type Screen = 'menu' | 'loading' | 'game';

/** 主選單停在哪一頁。 */
export type MenuPage = 'main' | 'newGame' | 'load';

export interface TutorialStatus {
  active: boolean;
  /** 第幾步，從 1 算起。 */
  step: number;
  total: number;
}

/**
 * 這兩個**各自註冊**，不合成一個 bridge。
 *
 * 設定畫面的開關是 `SettingsMenu` 的模組層級 signal，教程的進度住在
 * `TutorialOverlay` 元件自己身上（每次開局都是新的一份）。合成一個介面會逼出一個
 * 「同時擁有兩者」的假擁有者，而實際上沒有那個東西。
 */
export type SettingsProbe = () => boolean;
export type TutorialProbe = () => TutorialStatus | null;

// 預設是主選單。猜錯的方向很重要:說「在遊戲中」而其實還沒開局，呼叫端會照著一個
// 不存在的城市講話;說「在主選單」最多只是慢一步。
let screen: Screen = 'menu';
let menuPage: MenuPage = 'main';
let settingsProbe: SettingsProbe | null = null;
let tutorialProbe: TutorialProbe | null = null;

/**
 * 換畫面了。
 *
 * `menuPage` 一律跟著寫下去，不必判斷是不是在主選單 —— `buildStatus()` 只有在
 * `screen === 'menu'` 時才讀它，其餘時候回 `null`。多一道「只在主選單時才寫」的
 * 判斷守不住任何看得出來的差別。
 */
export function setScreen(next: Screen, page: MenuPage = 'main'): void {
  screen = next;
  menuPage = page;
}

export function getScreen(): Screen {
  return screen;
}

export function getMenuPage(): MenuPage {
  return menuPage;
}

/**
 * 最後一次開局失敗的原因。
 *
 * 開局失敗走的是「印到主控台然後退回主選單」。呼叫端在**另一個 process**，
 * 它看不到那個主控台 —— 少了這一份，它只知道「沒開起來」，玩家得自己開 devtools
 * 把錯誤貼給它。
 *
 * 開始一次新的嘗試就要清掉:留著上一次的原因，下一次失敗會報出一個過期的答案，
 * 而那比沒有答案更糟 —— 它看起來像是查到了。
 */
let startFailure: string | null = null;

export function setStartFailure(detail: string | null): void {
  startFailure = detail;
}

export function getStartFailure(): string | null {
  return startFailure;
}

export function registerSettingsProbe(probe: SettingsProbe | null): void {
  settingsProbe = probe;
}

export function registerTutorialProbe(probe: TutorialProbe | null): void {
  tutorialProbe = probe;
}

/** 設定畫面開著嗎。UI 還沒起來就當作沒開 —— 單元測試裡沒有 UI。 */
export function isSettingsOpen(): boolean {
  return settingsProbe?.() ?? false;
}

/** 教程走到哪。沒在跑、或 UI 還沒起來，都是 `null`。 */
export function getTutorialStatus(): TutorialStatus | null {
  return tutorialProbe?.() ?? null;
}
