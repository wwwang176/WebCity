import { listSaves, saveGame, type SaveSlot } from '../core/save/SaveManager';
import { exportSaveToFile, importSaveFromFile } from '../core/save/ImportExport';
import { getScreen, getSessionBridge } from './registry';
import { checkMapConfig } from './mapConfig';
import type { MapConfig } from '../core/config/MapConfig';

/**
 * 主選單那一層:存檔清單、存檔、匯出、載入、開新局。
 *
 * ## 這裡沒有刪除，而且是刻意的
 *
 * `SaveManager` 有 `deleteSave()`，這一層**不包它**。這個遊戲沒有復原功能，存檔是
 * 唯一的檢查點 —— 程式一個迴圈跑錯就把它抹掉，玩家沒有任何救回來的辦法。要刪存檔
 * 請走主選單自己按。
 *
 * ## 「await 完了沒爆」不等於「開起來了」
 *
 * `main.ts` 的 `startGameGuarded` **吞掉**開局過程中的任何例外，然後退回主選單 ——
 * 它不會讓 Promise reject。所以這兩支等完之後一定要再問一次畫面狀態，否則玩家看到
 * 載入畫面閃一下跳回主選單，而 API 回報成功。
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

export interface ImportResult extends SessionResult {
  /** 落在哪一格。 */
  slotId?: number;
  name?: string;
  /** 版本不合等等可以繼續、但值得知道的事。 */
  warnings?: string[];
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

/**
 * 遊戲真的開起來了嗎。
 *
 * `startGameGuarded` 與 `handleLoadGame` 失敗時都是**退回主選單**，不是丟例外 ——
 * 所以只能回頭看畫面停在哪。這跟 `status()` 讀的是同一份狀態，不另外記帳。
 */
function started(reason: string): SessionResult {
  return getScreen() === 'game'
    ? { ok: true }
    : { ok: false, reason: `${reason} — the game is back on the ${getScreen()} screen` };
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
    return started(`could not load slot ${slotId}`);
  }

  /**
   * 匯入一個匯出檔。
   *
   * **不會蓋掉任何東西** —— 它寫到第一個空的格子。slot 0 永遠被自動存檔占著，
   * 所以匯入碰不到它。
   *
   * 匯入完不會自動載入，要玩它得再 `load(slotId)`。
   */
  async importSave(fileContent: string, name?: string): Promise<ImportResult> {
    // 空字串一路送下去只會在 JSON.parse 那裡炸開,而那個訊息跟「檔案是空的」無關。
    if (typeof fileContent !== 'string' || fileContent.trim() === '') {
      return { ok: false, reason: 'the save file is empty' };
    }
    try {
      const r = await importSaveFromFile(fileContent, name ? { customName: name } : undefined);
      if (!r.success) {
        return { ok: false, reason: (r.errors ?? ['import failed']).join('; ') };
      }
      return {
        ok: true,
        ...(r.slotId !== undefined ? { slotId: r.slotId } : {}),
        ...(r.saveName !== undefined ? { name: r.saveName } : {}),
        ...(r.warnings?.length ? { warnings: r.warnings } : {}),
      };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /**
   * 開一局新的。目前這局會被整個丟掉。
   *
   * `mapConfig` 可以只給幾個欄位，其餘補預設;完全不給就用遊戲自己的預設。
   * **不合法的設定會被擋在動手之前** —— 地形產生器不驗，錯的值會讓開局炸在一半
   * 然後退回主選單。
   */
  async newGame(mapConfig?: Partial<MapConfig>): Promise<SessionResult> {
    const bridge = getSessionBridge();
    if (!bridge) return { ok: false, reason: 'session bridge not registered (no UI?)' };

    const checked = checkMapConfig(mapConfig);
    if (!checked.ok) return { ok: false, reason: checked.reason };

    await bridge.newGame(checked.config);
    return started('the game did not start');
  }
}
