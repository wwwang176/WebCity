import { describe, it, expect } from 'vitest';
import { policyCost, POLICY_BILLING } from '../PolicyBilling';
import { POLICY_ZONE_RESTRICTIONS, maxLevel } from '../PolicyManager';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';
import { PolicyType } from '../types';

/**
 * 固定費用在大城市等於免費 —— 早期是限制，後期是無感。改成跟著它服務的規模走，
 * 費用才有來由，而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。
 */

const SMALL = { population: 100, districtCells: 20 };
const BIG = { population: 10_000, districtCells: 400 };

describe('條例的計費', () => {
  it('should cost nothing at level 0', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 0, BIG)).toBe(0);
  });

  it('should scale with the thing it serves', () => {
    const small = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, SMALL);
    const big = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG);
    expect(small, '小分區也不用錢，沒有東西可比').toBeGreaterThan(0);
    expect(big, '大分區付得跟小分區一樣多').toBeGreaterThan(small * 5);
  });

  it('should cost more at a higher level', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 3, BIG))
      .toBeGreaterThan(policyCost(PolicyType.ENCOURAGE_RECYCLING, 1, BIG));
  });

  it('should not bill restriction policies', () => {
    // 限制型的代價是機會成本（該區長不出高稅收的建築），不是市府掏錢。再收一次是
    // 雙重懲罰，而且那個數字沒有來由。
    const types = Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[];
    expect(types.length, '沒有限制型政策，這條測試等於空轉').toBeGreaterThan(0);
    for (const type of types) {
      expect(POLICY_BILLING[type], `${type} 是限制型卻列了計費基數`).toBeUndefined();
      expect(policyCost(type, 1, BIG)).toBe(0);
    }
  });

  it('should have one perUnit entry per level the effect table offers', () => {
    // 兩張表走散的話，第三級會靜靜地用第二級的價錢。
    const entries = Object.entries(POLICY_BILLING);
    expect(entries.length, '計費表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type, billing] of entries) {
      expect(billing!.perUnit.length, `${type} 的計費級數與效果級數對不上`)
        .toBe(maxLevel(type as PolicyType));
    }
  });

  it('should charge a positive price for every level it offers', () => {
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      for (const [i, per] of billing!.perUnit.entries()) {
        expect(per, `${type} 第 ${i + 1} 級的單價不是正數`).toBeGreaterThan(0);
      }
    }
  });
});

describe('預算真的照這張表收錢', () => {
  // 只測 policyCost 的話，ExpenseCalculator 完全沒改也會全綠。
  const districts = [{
    cells: { size: 400 },
    policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 as const }],
  }];

  it('should bill exactly what policyCost says', () => {
    expect(calculateDistrictPolicyCost(districts, 10_000))
      .toBeCloseTo(policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG), 6);
  });

  it('should charge nothing for a district with no cells', () => {
    // 分區格數是計費基數 —— 沒有格子就沒有東西要服務。
    const empty = [{ cells: { size: 0 }, policies: districts[0]!.policies }];
    expect(calculateDistrictPolicyCost(empty, 10_000)).toBe(0);
  });

  it('should charge nothing for a policy that is off', () => {
    const off = [{
      cells: { size: 400 },
      policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 0 as const }],
    }];
    expect(calculateDistrictPolicyCost(off, 10_000)).toBe(0);
  });
});
