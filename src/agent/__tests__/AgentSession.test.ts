import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * 存檔清單是唯一需要假造的東西。
 *
 * `load()` 會先確認那一格存在，而測試環境沒有 IndexedDB —— 不假造的話每一條
 * 載入測試都停在「no save in slot 1」，走不到後面真正要測的地方。
 *
 * 只換 `listSaves`:`saveGame` 保持原樣，因為有幾條測試靠的就是它會失敗。
 */
let fakeSaves: { id: number; name: string }[] = [];
vi.mock('../../core/save/SaveManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/save/SaveManager')>()),
  listSaves: async () => fakeSaves,
}));
import { AgentSession } from '../AgentSession';
import { registerSessionBridge, setScreen, setStartFailure } from '../registry';
import type { MapConfig } from '../../core/config/MapConfig';

/**
 * 主選單那一層。
 *
 * 兩條規矩，兩條都是因為**這個遊戲沒有復原功能**:
 *
 * 1. **沒有刪除。** 存檔是唯一的檢查點，程式抹掉它玩家就救不回來了。
 * 2. **不准寫 slot 0。** 那是自動存檔用的 —— 蓋掉它跟刪掉它一樣糟。
 */

function session() {
  return new AgentSession(() => '{"fake":true}', () => 1234);
}

afterEach(() => {
  registerSessionBridge(null);
  setScreen('menu', 'main');
  fakeSaves = [];
  setStartFailure(null);
});

/**
 * 一個會「真的開起來」的假橋 —— 開完把畫面狀態設成 game，就像 `main.ts` 那樣。
 */
function workingBridge() {
  const got: { config?: unknown; slotId?: number; calls: number } = { calls: 0 };
  registerSessionBridge({
    newGame: async (cfg) => { got.calls++; got.config = cfg; setScreen('game'); },
    load: async (slotId) => { got.calls++; got.slotId = slotId; setScreen('game'); },
  });
  return got;
}

/** 開到一半炸掉、退回主選單的那一種。`startGameGuarded` 就是這個行為。 */
function bouncingBridge() {
  const got = { calls: 0 };
  registerSessionBridge({
    newGame: async () => { got.calls++; setScreen('menu', 'main'); },
    load: async () => { got.calls++; setScreen('menu', 'main'); },
  });
  return got;
}

describe('刪除存檔不在這一層', () => {
  it('should not expose anything that removes a save', () => {
    // 這條測試是規格，不是實作細節:有人日後補上 delete 的話要在這裡絆倒。
    const s = session() as unknown as Record<string, unknown>;
    for (const name of ['delete', 'deleteSave', 'remove', 'removeSave', 'clear', 'destroy']) {
      expect(s[name], `AgentSession 長出了 ${name}()`).toBeUndefined();
    }
  });
});

describe('存檔', () => {
  it('should refuse to overwrite the autosave slot', async () => {
    const r = await session().save(0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/autosave/);
  });

  it('should default to a slot that is not the autosave one', async () => {
    // 預設值寫錯的話，一句 save() 就把玩家的檢查點蓋掉了。
    let wrote: number | null = null;
    const s = new AgentSession(() => '{}', () => 0);
    // save() 會打 IndexedDB，這裡只驗它沒有把 0 當預設 —— 打得到就不是 0。
    const r = await s.save(undefined, 'x').catch(() => ({ ok: false, reason: 'io' }));
    wrote = r.ok || r.reason !== undefined ? 1 : null;
    expect(wrote).not.toBeNull();
    expect(r.reason ?? '').not.toMatch(/autosave/);
  });
});

describe('載入與開新局要有橋才做得到', () => {
  it('should say why instead of throwing when the bridge is missing', async () => {
    const s = session();
    expect(await s.load(1)).toMatchObject({ ok: false });
    expect((await s.newGame()).reason).toMatch(/bridge/);
  });

  it('should hand a new game straight to the bridge', async () => {
    const got = workingBridge();

    expect(await session().newGame()).toMatchObject({ ok: true });
    expect(got.calls).toBe(1);
  });

  it('should let the game pick its own defaults when given no config', async () => {
    const got = workingBridge();
    expect(await session().newGame()).toMatchObject({ ok: true });
    expect(got.config, '沒指定設定卻自己編了一份送過去').toBeUndefined();
  });

  it('should fill in the rest of the config around what was asked for', async () => {
    // 部分設定要能用 —— 逼呼叫端每次寫滿六個欄位只會讓它們用猜的。
    const got = workingBridge();
    const r = await session().newGame({ waterAmount: 'high' });

    expect(r.ok).toBe(true);
    const sent = got.config as MapConfig;
    expect(sent.waterAmount).toBe('high');
    expect(sent.forestDensity, '沒指定的欄位變成 undefined').toBe('normal');
    expect(typeof sent.seed).toBe('number');
  });

  it('should refuse a field the game does not have', async () => {
    // 這是玩家實際踩到的:AI 自己編了 `{size:128}`，遊戲開到一半在地形產生器
    // 讀 `waterAmount` 時炸開，然後退回主選單 —— 而 API 回報 ok:true。
    const got = workingBridge();
    const r = await session().newGame({ size: 128 } as unknown as Partial<MapConfig>);

    expect(r.ok).toBe(false);
    expect(r.reason, '沒說是哪個欄位不認得').toContain('size');
    expect(r.reason, '沒告訴呼叫端有哪些欄位可以用').toContain('waterAmount');
    expect(got.calls, '明知道不合法還是把遊戲拆了').toBe(0);
  });

  it('should refuse a value the game does not accept', async () => {
    const got = workingBridge();
    const r = await session().newGame({ waterAmount: 'gigantic' } as unknown as Partial<MapConfig>);

    expect(r.ok).toBe(false);
    expect(r.reason, '沒列出收得下的值').toContain('very_high');
    expect(got.calls).toBe(0);
  });

  it('should refuse a seed that is not a whole number in range', async () => {
    const got = workingBridge();

    for (const seed of [0, -1, 1.5, 2147483647, NaN]) {
      const r = await session().newGame({ seed } as Partial<MapConfig>);
      expect(r.ok, `接受了 seed ${seed}`).toBe(false);
    }
    expect(got.calls).toBe(0);
  });

  it('should refuse a disaster switch that is not a boolean', async () => {
    const got = workingBridge();
    const r = await session().newGame({ disastersEnabled: 'yes' } as unknown as Partial<MapConfig>);

    expect(r.ok).toBe(false);
    expect(got.calls).toBe(0);
  });

  it('should accept every value the game actually offers', async () => {
    const got = workingBridge();
    const r = await session().newGame({
      seed: 42, waterAmount: 'very_high', forestDensity: 'sparse',
      startingFunds: 'hard', disastersEnabled: false, disasterFrequency: 'low',
    });

    expect(r.ok, '合法的設定被擋下來了').toBe(true);
    expect(got.config).toMatchObject({ seed: 42, waterAmount: 'very_high' });
  });
});

describe('開起來了沒', () => {
  it('should not claim success when the game bounced back to the menu', async () => {
    // `startGameGuarded` 會吞掉開局過程中的任何例外，然後退回主選單 —— 它**不會**
    // 讓 Promise reject。所以「await 完了沒爆」不代表遊戲開起來了。
    // 玩家看到的就是這個:載入畫面閃一下，跳回主選單，而 AI 說開好了。
    const got = bouncingBridge();
    const r = await session().newGame();

    expect(got.calls, '根本沒去開').toBe(1);
    expect(r.ok, '退回主選單了卻回報成功').toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('should hand back the reason the game actually failed to start', async () => {
    // 沒有這一條的話，呼叫端只知道「沒開起來」，真正的原因躺在瀏覽器主控台裡 ——
    // 而呼叫端是另一個 process，它看不到那裡。玩家得自己開 devtools 貼給它。
    registerSessionBridge({
      newGame: async () => {
        setStartFailure("Cannot read properties of undefined (reading 'riverHalfWidth')");
        setScreen('menu', 'main');
      },
      load: async () => {},
    });

    const r = await session().newGame();
    expect(r.ok).toBe(false);
    expect(r.reason, '真正的錯誤沒有傳出來').toContain('riverHalfWidth');
  });

  it('should not blame this failure on the last one', async () => {
    // 上一次的失敗理由留著的話，下一次失敗會報出一個過期的原因 —— 那比沒有原因
    // 更糟，因為它看起來像是查到了。
    setStartFailure('something from last time');
    registerSessionBridge({
      newGame: async () => { setScreen('menu', 'main'); },
      load: async () => {},
    });

    const r = await session().newGame();
    expect(r.ok).toBe(false);
    expect(r.reason ?? '', '報的是上一次的失敗理由').not.toContain('last time');
  });

  it('should not blame a failed load on the last one either', async () => {
    // 載入走的是另一支，兩支都要自己清 —— 只清一邊的話，另一邊會報出過期的原因。
    fakeSaves = [{ id: 1, name: 'Save' }];
    setStartFailure('something from last time');
    registerSessionBridge({
      newGame: async () => {},
      load: async () => { setScreen('menu', 'main'); },
    });

    const r = await session().load(1);
    expect(r.ok).toBe(false);
    expect(r.reason ?? '', '報的是上一次的失敗理由').not.toContain('last time');
  });

  it('should not claim success while the game is still stuck loading', async () => {
    // 退回主選單不是唯一的失敗樣子。開局卡在載入中（例如錯誤處理自己也炸了）時，
    // 畫面會停在 'loading' —— 那時候說「開好了」比說「退回選單」更糟，因為呼叫端
    // 會立刻去讀一座還不存在的城市。
    registerSessionBridge({
      newGame: async () => { setScreen('loading'); },
      load: async () => { setScreen('loading'); },
    });

    const r = await session().newGame();
    expect(r.ok, '還卡在載入畫面卻回報成功').toBe(false);
    expect(r.reason).toContain('loading');
  });

  it('should not claim a load succeeded when it bounced back too', async () => {
    // 載入失敗走的是同一條路（handleLoadGame → showMainMenu）。
    fakeSaves = [{ id: 1, name: 'Save' }];
    const got = bouncingBridge();
    const r = await session().load(1);

    expect(got.calls, '根本沒去載').toBe(1);
    expect(r.ok, '載入失敗卻回報成功').toBe(false);
  });
});

describe('匯入存檔檔案', () => {
  it('should refuse an empty file instead of asking the database', async () => {
    // 空字串一路送下去只會在 JSON.parse 那裡炸開，訊息還跟「檔案是空的」無關。
    expect(await session().importSave('')).toMatchObject({ ok: false });
    expect((await session().importSave('   ')).reason, '沒說是檔案空的').toMatch(/empty/);
  });

  it('should report why a broken file was refused', async () => {
    const r = await session().importSave('not json at all');

    expect(r.ok).toBe(false);
    expect(r.reason, '拒絕了卻沒說為什麼').toBeTruthy();
  });

  it('should refuse a file that is not an export of this game', async () => {
    const r = await session().importSave(JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
  });
});
