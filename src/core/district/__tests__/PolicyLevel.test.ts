import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { PolicyType } from '../types';

/**
 * 條例的強度用一個等級欄位表示，不是三個 enum 成員（LIGHT / MEDIUM / HEAVY）。
 *
 * 互斥必須自動成立 —— 分成三個成員的話，「不能同時開輕度和重度」會變成另一份要
 * 手動維護的檢查，而漏掉的那一條不會有任何徵兆。一個欄位只能是一個值。
 */

function fresh() {
  const dm = new DistrictManager();
  const d = dm.createDistrict('D');
  return { dm, pm: new PolicyManager(dm), id: d.id };
}

describe('條例的強度', () => {
  it('should store the level it was set to', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 2);
    expect(pm.getPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING)).toBe(2);
  });

  it('should treat level 0 as off', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 0);
    expect(pm.isPolicyActive(id, PolicyType.ENCOURAGE_RECYCLING)).toBe(false);
  });

  it('should hold only one level per type', () => {
    const { pm, id, dm } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 1);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    const entries = dm.getDistrict(id)!.policies
      .filter(p => p.type === PolicyType.ENCOURAGE_RECYCLING);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe(3);
  });

  it('should report level 0 for a district that does not exist', () => {
    const { pm } = fresh();
    expect(pm.getPolicyLevel('no_such_district', PolicyType.TOURISM)).toBe(0);
    expect(pm.getPolicyLevel(null, PolicyType.TOURISM)).toBe(0);
  });
});

describe('舊存檔的遷移', () => {
  const base = { id: 'p1', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, cost: 100 };

  function load(policy: Record<string, unknown>) {
    const dm = DistrictManager.fromJSON({
      nextId: 2,
      districts: [{
        id: 'district_1', name: 'D', cells: ['1,1'],
        policies: [policy], specialization: 'NONE',
      }],
    } as never);
    return new PolicyManager(dm).getPolicyLevel('district_1', PolicyType.ENCOURAGE_RECYCLING);
  }

  it('should turn an old active:true into level 1', () => {
    // 掉成 0 的話，玩家讀檔會發現政策全被關掉了，而畫面上沒有任何東西說明為什麼。
    expect(load({ ...base, active: true })).toBe(1);
  });

  it('should turn an old active:false into level 0', () => {
    expect(load({ ...base, active: false })).toBe(0);
  });

  it('should clamp a corrupt level from a tampered save', () => {
    // `level` 宣告成 0|1|2|3，而 TypeScript 只在編譯期看得到它。存檔是使用者能
    // 編輯的檔案，讀進來不夾住就會破壞那個不變量。
    expect(load({ ...base, level: 99 }), 'level 99 沒有被夾住').toBe(3);
    expect(load({ ...base, level: -1 }), 'level -1 沒有被夾住').toBe(0);
    expect(load({ ...base, level: 2.7 }), '小數 level 沒有被截斷').toBe(2);
    expect(load({ ...base, level: NaN }), 'NaN 穿過了夾值').toBe(0);
  });

  it('should prefer an explicit level over the legacy flag', () => {
    // 新格式兩個欄位都在時，level 是權威 —— 不然存過一次的檔案會被舊欄位蓋回去。
    expect(load({ ...base, level: 3, active: false })).toBe(3);
  });
});
