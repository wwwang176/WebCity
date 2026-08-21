import { listSaves, saveGame, type SaveSlot } from '../core/save/SaveManager';
import { exportSaveToFile } from '../core/save/ImportExport';
import { getSessionBridge } from './registry';

/**
 * 主選單那一層:存檔清單、存檔、匯出、載入、開新局。
 *
 * ## 這裡沒有刪除，而且是刻意的
 *
 * `SaveManager` 有 `deleteSave()`，這一層**不包它**。這個遊戲沒有復原功能，存檔是
 * 唯一的檢查點 —— 程式一個迴圈跑錯就把它抹掉，玩家沒有任何救回來的辦法。要刪存檔
 * 請走主選單自己按。
 *
 * ## 載入與開新局會把整個 Game 換掉
 *
 * 那兩件事住在 `main.ts`（它 `new Game` 之後重建 UI）。`window.__game` 與
 * `window.__agent` 都會指向新的實例，**呼叫前抓在手上的參照全部作廢**。
 */

export interface SaveInfo {
  slotId: number;
  name: string;
  /** 存檔當下的人口。舊格式可能沒有。 */
  population?: number;
  /** 位元組。 */
  size: number;
  savedAt?: number;
}

export interface SessionResult {
  ok: boolean;
  reason?: string;
}

function describe(slot: SaveSlot): SaveInfo {
  const s = slot as unknown as Record<string, unknown>;
  return {
    slotId: slot.id,
    name: slot.name,
    ...(typeof s.population === 'number' ? { population: s.population } : {}),
    size: typeof slot.data === 'string' ? slot.data.length : 0,
    ...(typeof s.timestamp === 'number' ? { savedAt: s.timestamp } : {}),
  };
}

export class AgentSession {
  constructor(private readonly serialize: () => string, private readonly population: () => number) {}

  /** 有哪些存檔。 */
  async list(): Promise<SaveInfo[]> {
    return (await listSaves()).map(describe);
  }

  /**
   * 把目前的城市存進某一格。
   *
   * **會蓋掉那一格原本的東西。** 預設寫到 slot 1 而不是 0 —— 0 是自動存檔用的，
   * 蓋掉它等於毀掉玩家唯一的檢查點。
   */
  async save(slotId = 1, name = 'Agent Save'): Promise<SessionResult> {
    if (slotId === 0) {
      return { ok: false, reason: 'slot 0 is the autosave checkpoint; pick another slot' };
    }
    try {
      await saveGame(slotId, name, this.serialize(), this.population());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /** 把某一格存檔匯出成檔案下載。 */
  async export(slotId: number): Promise<SessionResult> {
    const slots = await listSaves();
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return { ok: false, reason: `no save in slot ${slotId}` };
    exportSaveToFile(slot);
    return { ok: true };
  }

  /**
   * 載入某一格存檔。
   *
   * 成功的話目前這局會被整個換掉 —— 沒有存的東西全部不見。
   */
  async load(slotId: number): Promise<SessionResult> {
    const bridge = getSessionBridge();
    if (!bridge) return { ok: false, reason: 'session bridge not registered (no UI?)' };
    const slots = await listSaves();
    if (!slots.some(s => s.id === slotId)) return { ok: false, reason: `no save in slot ${slotId}` };
    await bridge.load(slotId);
    return { ok: true };
  }

  /** 開一局新的。目前這局會被整個丟掉。 */
  async newGame(mapConfig?: unknown): Promise<SessionResult> {
    const bridge = getSessionBridge();
    if (!bridge) return { ok: false, reason: 'session bridge not registered (no UI?)' };
    await bridge.newGame(mapConfig);
    return { ok: true };
  }
}
