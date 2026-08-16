import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, maxLevel, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

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

  it('should never turn an old active:true policy off', () => {
    // 掉成 0 的話，玩家讀檔會發現政策全被關掉了，而畫面上沒有任何東西說明為什麼。
    expect(load({ ...base, active: true })).toBeGreaterThan(0);
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

  it('should land an old policy on the tier that keeps its benefit', () => {
    // 分級之前每條政策只有一組數字。一律轉成 level 1 的話，那組數字剛好不在第一格
    // 的政策就會在讀檔當下靜靜地變弱 —— 回收原本是 garbage 0.65，而 0.65 是新表的
    // 第 2 級。玩家沒有動任何東西，垃圾量卻變差了。
    //
    // 這條只保證**好處**的量級不變。新表每一級都多了代價（回收扣商業收入、觀光
    // 加犯罪、有機食品扣商業收入），那些代價對舊存檔一樣生效 —— 那正是這次改造
    // 的目的:沒有純好處的條例。下一條把那件事寫成斷言。
    // 兩條政策放在不同分區 —— 同一區的話效果會相乘（回收現在也扣商業收入），
    // 量到的就不是「觀光自己有沒有變」了。
    const dm = DistrictManager.fromJSON({
      nextId: 3,
      districts: [
        {
          id: 'district_1', name: 'Green', cells: ['1,1'], specialization: 'NONE',
          policies: [{ id: 'p1', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, cost: 100, active: true }],
        },
        {
          id: 'district_2', name: 'Resort', cells: ['2,2'], specialization: 'NONE',
          policies: [{ id: 'p2', name: 'T', type: PolicyType.TOURISM, cost: 200, active: true }],
        },
      ],
    } as never);
    const pm = new PolicyManager(dm);

    // 分級之前的效果:回收 garbage 0.65、觀光 revenue 1.2。
    expect(pm.getGarbageMultiplier('district_1'), '舊存檔的回收讀進來之後變弱了')
      .toBeCloseTo(0.65, 6);
    expect(pm.getRevenueMultiplier('district_2', ZoneType.COMMERCIAL_LOW), '舊存檔的觀光變了')
      .toBeCloseTo(1.2, 6);
  });

  it('should apply the new downsides to an old save as well', () => {
    // 舊存檔的政策不會被豁免。這是刻意的:條例的重點是取捨，如果讀進來的政策
    // 永遠停在「只有好處」的舊版本，舊城市就會永遠比新城市划算。
    //
    // 寫成斷言而不是留在註解裡，是因為它看起來很像遷移漏掉了東西 —— 沒有這一條，
    // 下一個讀到上面那支測試的人會以為代價沒生效是 bug。
    const dm = DistrictManager.fromJSON({
      nextId: 3,
      districts: [
        {
          id: 'district_1', name: 'Green', cells: ['1,1'], specialization: 'NONE',
          policies: [{ id: 'p1', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, cost: 100, active: true }],
        },
        {
          id: 'district_2', name: 'Resort', cells: ['2,2'], specialization: 'NONE',
          policies: [{ id: 'p2', name: 'T', type: PolicyType.TOURISM, cost: 200, active: true }],
        },
      ],
    } as never);
    const pm = new PolicyManager(dm);

    expect(pm.getRevenueMultiplier('district_1', ZoneType.COMMERCIAL_LOW),
      '舊存檔的回收沒有吃到商業收入的代價').toBeLessThan(1);
    expect(pm.getCrimeBonus('district_2'), '舊存檔的觀光沒有吃到犯罪的代價')
      .toBeGreaterThan(0);
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
