import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, maxLevel, type PolicyEffect } from '../PolicyManager';
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

/** 這一級一共扣了多少收入（跨所有分區類型取最重的那一個）。 */
function revenueCost(e: PolicyEffect): number {
  let worst = 1 - (e.revenue ?? 1);
  for (const m of Object.values(e.revenueByZone ?? {})) worst = Math.max(worst, 1 - m);
  return worst;
}

describe('分級的效果', () => {
  it('should get stronger with level', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 1);
    const light = pm.getGarbageMultiplier(id);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    const heavy = pm.getGarbageMultiplier(id);
    expect(heavy, '重度沒有比輕度更能減垃圾').toBeLessThan(light);
  });

  it('should charge an accelerating price for each step', () => {
    // 代價加速上升才有「找得到的最佳點」。線性的話分級只是一根沒有決策的滑桿 ——
    // 最高級永遠是最划算的，那就不是選擇。
    //
    // 用 revenueCost 而不是直接讀 `revenue`，因為代價可能只落在特定分區類型上。
    const tiers = POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!;
    expect(tiers.length, '回收只有一級，這條測試等於空轉').toBeGreaterThan(1);
    const ratios = tiers.map(t => revenueCost(t) / (1 - (t.garbage ?? 1)));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]!, `第 ${i + 1} 級的單位代價（${ratios[i]!.toFixed(3)}）沒有比前一級（${ratios[i - 1]!.toFixed(3)}）高`)
        .toBeGreaterThan(ratios[i - 1]!);
    }
  });

  it('should derive maxLevel from the table, not a hand-kept number', () => {
    // 手寫的那份一定會跟表走散，而走散的那天不會有任何徵兆。
    expect(maxLevel(PolicyType.ENCOURAGE_RECYCLING))
      .toBe(POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!.length);
    expect(maxLevel(PolicyType.TOURISM)).toBe(1);
  });

  it('should clamp a level above what the table offers', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.TOURISM, 3);
    expect(pm.getPolicyLevel(id, PolicyType.TOURISM), '單級條例被設到第 3 級').toBe(1);
  });

  it('should read the tier matching the level, not always the first', () => {
    const { pm, id } = fresh();
    const tiers = POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!;
    for (const [i, tier] of tiers.entries()) {
      pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, i + 1);
      expect(pm.getGarbageMultiplier(id), `第 ${i + 1} 級讀到的不是第 ${i + 1} 格`)
        .toBeCloseTo(tier.garbage ?? 1, 6);
    }
  });
});
