import { describe, it, expect, afterEach } from 'vitest';
import { AgentSession } from '../AgentSession';
import { registerSessionBridge } from '../registry';

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

afterEach(() => registerSessionBridge(null));

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
    let called = false;
    registerSessionBridge({
      newGame: async () => { called = true; },
      load: async () => {},
    });

    expect(await session().newGame()).toMatchObject({ ok: true });
    expect(called).toBe(true);
  });

  it('should pass the map config through', async () => {
    let got: unknown = null;
    registerSessionBridge({
      newGame: async (cfg) => { got = cfg; },
      load: async () => {},
    });

    await session().newGame({ size: 80 });
    expect(got, '地圖設定被吃掉了').toEqual({ size: 80 });
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
