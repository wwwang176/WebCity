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
