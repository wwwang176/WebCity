import { describe, it, expect } from 'vitest';
import { policyCost, POLICY_BILLING } from '../PolicyBilling';
import { POLICY_ZONE_RESTRICTIONS, isPolicyImplemented, maxLevel } from '../PolicyManager';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';
import { PolicyType } from '../types';
import { POLICY_SCOPE, isDistrictScoped } from '../PolicyScope';
import { scaleOf } from '../../__tests__/helpers/policyScale';

/**
 * A flat fee is free in a large city: a constraint early on and imperceptible later. Following
 * the scale it serves gives the fee a basis, and "the more successful the policy, the more it
 * costs" is itself a tension the player has to decide when to stop paying.
 */

const SMALL = scaleOf({ population: 100, districtCells: 20 });
const BIG = scaleOf({ population: 10_000, districtCells: 400 });

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
    // A restrictive policy's cost is the opportunity cost of the high-tax buildings the district
    // cannot grow, not money out of the treasury. Charging as well is a double penalty, and that
    // number has no basis.
    const types = Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[];
    expect(types.length, '沒有限制型政策，這條測試等於空轉').toBeGreaterThan(0);
    for (const type of types) {
      expect(POLICY_BILLING[type], `${type} 是限制型卻列了計費基數`).toBeUndefined();
      expect(policyCost(type, 1, BIG)).toBe(0);
    }
  });

  it('should have one perUnit entry per level the effect table offers', () => {
    // If the two tables drift apart, level 3 silently charges level 2's price.
    const entries = Object.entries(POLICY_BILLING);
    expect(entries.length, '計費表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type, billing] of entries) {
      expect(billing!.perUnit.length, `${type} 的計費級數與效果級數對不上`)
        .toBe(maxLevel(type as PolicyType));
    }
  });

  it('should only bill policies the simulation actually reads', () => {
    // ExpenseCalculator once had a separate isPolicyImplemented guard. Removing it turned no
    // test red, because it was redundant: policyCost returns 0 for a type with no billing entry,
    // and every billing entry corresponds to a policy with a real effect. Writing that premise
    // down as an assertion lets the redundant guard go rather than leaving defensive code nobody
    // can show is useful.
    for (const type of Object.keys(POLICY_BILLING) as PolicyType[]) {
      expect(isPolicyImplemented(type), `${type} 收錢卻對模擬沒有效果`).toBe(true);
    }
  });

  it('should bill on the scale that matches its scope', () => {
    // Checking the table's `basis` against the table's own behaviour always holds and stays
    // green with the basis set wrong. What has to be pinned is that the basis matches the scope:
    //
    // - A city ordinance has no district cell count, since the caller always passes 0, so billing
    //   on districtCells makes it free.
    // - A district policy billed by population charges the same for one cell as for a hundred,
    //   and following the scale it serves stops meaning anything.
    //
    // Neither side has a single basis any more: city-wide has population, children and patients,
    // and per-district has total cells and road cells. So what is checked is the **direction**: a
    // city ordinance moves with some city-wide quantity and ignores every district one, and a
    // district policy the reverse.
    const base = scaleOf({
      population: 100, districtCells: 100, districtRoadCells: 100,
      babies: 10, children: 10, teens: 10, clinicPatients: 100, chargedDrivers: 100,
    });
    const biggerCity = scaleOf({
      population: 1000, districtCells: 100, districtRoadCells: 100,
      babies: 100, children: 100, teens: 100, clinicPatients: 1000, chargedDrivers: 100,
    });
    const moreCells = scaleOf({ ...base, districtCells: 1000, districtRoadCells: 1000 });

    const entries = Object.entries(POLICY_BILLING);
    expect(entries.length, '計費表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type] of entries) {
      const t = type as PolicyType;
      const b = policyCost(t, 1, base);
      const p = policyCost(t, 1, biggerCity);
      const c = policyCost(t, 1, moreCells);
      if (POLICY_SCOPE[t] === 'city') {
        expect(p, `${type} 是全城條例卻不隨城市規模變`).toBeGreaterThan(b);
        expect(c, `${type} 是全城條例卻隨分區格數變 —— 全城沒有格數可言`).toBe(b);
      } else {
        expect(c, `${type} 是分區條例卻不隨分區規模變`).toBeGreaterThan(b);
        expect(p, `${type} 是分區條例卻隨城市規模變 —— 畫一格跟畫一百格會收一樣多`).toBe(b);
      }
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
  // Testing policyCost alone stays green with ExpenseCalculator entirely unchanged.
  const districts = [{
    cells: { size: 400 }, roadCells: 400, chargedDrivers: 0,
    policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 as const }],
  }];

  it('should bill exactly what policyCost says', () => {
    expect(calculateDistrictPolicyCost(districts, scaleOf({ population: 10_000 })))
      .toBeCloseTo(policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG), 6);
  });

  it('should charge nothing for a district with no cells', () => {
    // District cell count is a billing basis: no cells means nothing to serve.
    const empty = [{ cells: { size: 0 }, roadCells: 0, chargedDrivers: 0, policies: districts[0]!.policies }];
    expect(calculateDistrictPolicyCost(empty, scaleOf({ population: 10_000 }))).toBe(0);
  });

  it('should charge nothing for any district policy once the cells are gone', () => {
    // The test above covers one policy. Erasing a district's last cell is something the player
    // can do, and the district stays on the list because its policy settings should not vanish
    // because of one erase. Still charging for it puts a line on the bill corresponding to
    // nothing on the map.
    //
    // This is a requirement on **every** district policy: giving one a flat or population basis
    // would start charging silently for empty districts.
    const districtScoped = Object.values(PolicyType).filter(isDistrictScoped);
    expect(districtScoped.length, '一條分區條例都沒有，這條測試在空轉')
      .toBeGreaterThan(5);
    for (const type of districtScoped) {
      for (let level = 1; level <= maxLevel(type); level++) {
        expect(policyCost(type, level, scaleOf({ population: 10_000, babies: 50, children: 50, teens: 50, clinicPatients: 900 })),
          `${type} Lv${level} 在沒有格子的分區上還在收費`).toBe(0);
      }
    }
  });

  it('should charge nothing for a policy that is off', () => {
    const off = [{
      cells: { size: 400 }, roadCells: 400, chargedDrivers: 0,
      policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 0 as const }],
    }];
    expect(calculateDistrictPolicyCost(off, scaleOf({ population: 10_000 }))).toBe(0);
  });
});
