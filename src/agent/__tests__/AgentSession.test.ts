import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The save list is the only thing that needs stubbing.
 *
 * `load()` first confirms the slot exists, and the test environment has no IndexedDB, so
 * without a stub every load test stops at "no save in slot 1" before reaching what it tests.
 *
 * Only `listSaves` is replaced; `saveGame` is left alone because several tests rely on it
 * failing.
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
 * The main menu layer.
 *
 * Two rules, both because **the game has no undo**:
 *
 * 1. **No delete.** Saves are the only checkpoint, and a program erasing one leaves the player
 *    nothing to recover from.
 * 2. **Slot 0 is not written.** It is the autosave, and overwriting it is as bad as deleting it.
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
 * A stub bridge that really starts: it sets the screen to game afterwards, as `main.ts` does.
 */
function workingBridge() {
  const got: { config?: unknown; slotId?: number; calls: number } = { calls: 0 };
  registerSessionBridge({
    newGame: async (cfg) => { got.calls++; got.config = cfg; setScreen('game'); },
    load: async (slotId) => { got.calls++; got.slotId = slotId; setScreen('game'); },
  });
  return got;
}

/** The kind that fails partway and returns to the main menu, as `startGameGuarded` does. */
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
    // This test is the specification, not an implementation detail: anyone adding a delete
    // trips here.
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
    // With the wrong default, a bare save() overwrites the player's checkpoint.
    let wrote: number | null = null;
    const s = new AgentSession(() => '{}', () => 0);
    // save() reaches IndexedDB; all this checks is that the default is not 0, which reaching it
    // at all establishes.
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
    // Partial configs have to work: requiring all six fields every time only makes callers
    // guess.
    const got = workingBridge();
    const r = await session().newGame({ waterAmount: 'high' });

    expect(r.ok).toBe(true);
    const sent = got.config as MapConfig;
    expect(sent.waterAmount).toBe('high');
    expect(sent.forestDensity, '沒指定的欄位變成 undefined').toBe('normal');
    expect(typeof sent.seed).toBe('number');
  });

  it('should refuse a field the game does not have', async () => {
    // An AI invented `{size:128}`, startup failed in the terrain generator reading
    // `waterAmount`, the game returned to the main menu, and the API reported ok: true.
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
    // `startGameGuarded` swallows any exception during startup and returns to the main menu; it
    // **never** rejects the promise. So an await that returned without throwing does not mean
    // the game started. What the player sees is the loading screen flashing back to the menu
    // while the AI says it is ready.
    const got = bouncingBridge();
    const r = await session().newGame();

    expect(got.calls, '根本沒去開').toBe(1);
    expect(r.ok, '退回主選單了卻回報成功').toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('should hand back the reason the game actually failed to start', async () => {
    // Without this the caller only learns that the game did not start, while the real reason
    // sits in the browser console it cannot see, and the player has to open devtools and paste
    // it over.
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
    // A leftover reason makes the next failure report a stale one, which is worse than no
    // reason because it looks like a diagnosis.
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
    // Loading goes through a different method, and both must clear it themselves; clearing only
    // one leaves the other reporting a stale reason.
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
    // Returning to the menu is not the only shape of failure. A startup stuck partway — the
    // error handling itself failing, say — leaves the screen on 'loading', and claiming success
    // there is worse still, because the caller immediately reads a city that does not exist.
    registerSessionBridge({
      newGame: async () => { setScreen('loading'); },
      load: async () => { setScreen('loading'); },
    });

    const r = await session().newGame();
    expect(r.ok, '還卡在載入畫面卻回報成功').toBe(false);
    expect(r.reason).toContain('loading');
  });

  it('should not claim a load succeeded when it bounced back too', async () => {
    // A failed load takes the same path: handleLoadGame to showMainMenu.
    fakeSaves = [{ id: 1, name: 'Save' }];
    const got = bouncingBridge();
    const r = await session().load(1);

    expect(got.calls, '根本沒去載').toBe(1);
    expect(r.ok, '載入失敗卻回報成功').toBe(false);
  });
});

describe('匯入存檔檔案', () => {
  it('should refuse an empty file instead of asking the database', async () => {
    // An empty string passed on would only blow up in JSON.parse, with a message unrelated to
    // the file being empty.
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
