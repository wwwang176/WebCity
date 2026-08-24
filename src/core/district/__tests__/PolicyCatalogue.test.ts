import { describe, it, expect } from 'vitest';
import { POLICY_EFFECTS, POLICY_CONFIG, maxLevel, type PolicyEffect } from '../PolicyManager';
import { POLICY_BILLING, policyCost } from '../PolicyBilling';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { POLICY_SCOPE } from '../PolicyScope';
import { policyEffectSummary } from '../PolicyPresentation';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CityOrdinances } from '../CityOrdinances';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';

/**
 * The catalogue's shape. Individual numbers move with balance, so what is guarded here is that
 * adding a policy cannot miss a table and that a multi-level policy's price rises with each
 * level, rather than any particular figure.
 */

describe('目錄的完整性', () => {
  it('should give every policy a name, a scope and a summary', () => {
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_CONFIG[type]?.name, `${type} 沒有名字`).toBeTruthy();
      expect(POLICY_SCOPE[type], `${type} 沒有範圍`).toBeTruthy();
      for (let lv = 1; lv <= maxLevel(type); lv++) {
        expect(policyEffectSummary(type, lv).length, `${type} 第 ${lv} 級沒有說明`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('should charge more for every step up', () => {
    // A higher level cannot be free. What is checked is the **cost** rather than the unit price:
    // the childcare subsidy's three levels share a unit price and get more expensive because more
    // children are eligible, and comparing unit prices would read that as no dearer than the
    // level below.
    //
    // Every billing basis is given a positive value, or policies on that basis are permanently 0
    // and pass silently.
    const FULL = scaleOf({
      population: 1000, districtCells: 100, districtRoadCells: 40,
      babies: 40, children: 60, teens: 50, clinicPatients: 900, chargedDrivers: 120,
    });
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      for (let lv = 2; lv <= billing!.perUnit.length; lv++) {
        expect(policyCost(type as PolicyType, lv, FULL), `${type} 第 ${lv} 級沒有比前一級貴`)
          .toBeGreaterThan(policyCost(type as PolicyType, lv - 1, FULL));
      }
    }
  });

  it('should carry exactly the catalogue that was designed', () => {
    // A literal list rather than a minimum count. Checking the count alone stays green if the
    // night economy is deleted and something else added, and no test references the night economy
    // directly.
    expect(new Set(Object.values(PolicyType))).toEqual(new Set([
      PolicyType.NO_HEAVY_INDUSTRY, PolicyType.HIGH_DENSITY_BAN,
      PolicyType.ENCOURAGE_RECYCLING, PolicyType.ORGANIC_FOOD, PolicyType.TOURISM,
      PolicyType.ENERGY_REGULATION,
      PolicyType.LEGALIZE_GAMBLING, PolicyType.NIGHT_ECONOMY, PolicyType.CURFEW,
      PolicyType.HERITAGE_PRESERVATION, PolicyType.INDUSTRY_SUBSIDY,
      PolicyType.SURVEILLANCE_NETWORK, PolicyType.PAY_AS_YOU_THROW,
      PolicyType.WATER_CONSERVATION, PolicyType.SEWAGE_STANDARDS,
      PolicyType.INDUSTRIAL_EMISSION_CONTROL,
      PolicyType.CHILDCARE_SUBSIDY, PolicyType.COMPULSORY_EDUCATION,
      PolicyType.FREE_CLINIC, PolicyType.SMOKING_BAN,
      PolicyType.CONGESTION_CHARGE,
    ]));
  });

  it('should put every policy in the scope it was designed for', () => {
    // A deliberate second copy of POLICY_SCOPE's contents. The category and consistency tests
    // derive their expectations from that table and check it against itself, which guards the
    // tables agreeing with each other but not the scopes being the ones that were decided. This
    // copy is the product contract, not a second source of the data.
    const DESIGNED: Record<PolicyType, 'district' | 'city'> = {
      [PolicyType.NO_HEAVY_INDUSTRY]: 'district',
      [PolicyType.HIGH_DENSITY_BAN]: 'district',
      [PolicyType.ENCOURAGE_RECYCLING]: 'district',
      [PolicyType.ORGANIC_FOOD]: 'district',
      [PolicyType.TOURISM]: 'district',
      [PolicyType.LEGALIZE_GAMBLING]: 'district',
      [PolicyType.NIGHT_ECONOMY]: 'district',
      [PolicyType.CURFEW]: 'district',
      [PolicyType.HERITAGE_PRESERVATION]: 'district',
      [PolicyType.INDUSTRY_SUBSIDY]: 'district',
      [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: 'district',
      [PolicyType.ENERGY_REGULATION]: 'city',
      [PolicyType.SURVEILLANCE_NETWORK]: 'city',
      [PolicyType.PAY_AS_YOU_THROW]: 'city',
      [PolicyType.WATER_CONSERVATION]: 'city',
      [PolicyType.SEWAGE_STANDARDS]: 'city',
      [PolicyType.CHILDCARE_SUBSIDY]: 'city',
      [PolicyType.COMPULSORY_EDUCATION]: 'city',
      [PolicyType.FREE_CLINIC]: 'city',
      [PolicyType.SMOKING_BAN]: 'city',
      [PolicyType.CONGESTION_CHARGE]: 'district',
    };
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_SCOPE[type], `${type} 的範圍跟當初的設計不一樣`).toBe(DESIGNED[type]);
    }
  });
});

/**
 * The direction of each level.
 *
 * Most policies have only one level covered individually: making level 2's revenue negative, or
 * the curfew's level 2 crime positive, turns no test red. This group is the invariant across the
 * whole table.
 */
describe('逐級的方向', () => {
  /** Reducing levers, where a multiplier below 1 is a benefit and above 1 a cost. */
  const REDUCERS = ['garbage', 'waterDemand', 'sewageLoad', 'industrialPollution',
    'powerDemand', 'deathRate', 'coveredDeathRate'] as const;

  /**
   * Increasing levers, running the opposite way to REDUCERS: above 1 is the benefit.
   *
   * Two tables rather than a `goodDirection` marker on each lever, because the markers would live
   * apart from the effect table and an unmarked lever would be skipped silently as "no such
   * field", letting a pure-benefit policy slip under this invariant.
   */
  const INCREASERS = ['fertility', 'driveDeterrence'] as const;

  /**
   * Counting levers, whose baseline is 0: above 0 is the benefit, and it has to grow with each
   * level.
   *
   * Separate from INCREASERS because the baseline differs: checking `> 1` would read "reaches
   * primary school", whose value is 1, as no benefit at all.
   */
  const COUNTERS = ['compulsorySchooling'] as const;

  const benefits = (e: PolicyEffect): number => {
    let n = 0;
    for (const k of REDUCERS) if (e[k] !== undefined && e[k]! < 1) n++;
    for (const k of INCREASERS) if (e[k] !== undefined && e[k]! > 1) n++;
    for (const k of COUNTERS) if (e[k] !== undefined && e[k]! > 0) n++;
    if (e.landValue !== undefined && e.landValue > 0) n++;
    if (e.crime !== undefined && e.crime < 0) n++;
    if (e.revenue !== undefined && e.revenue > 1) n++;
    for (const m of Object.values(e.revenueByZone ?? {})) if (m > 1) n++;
    return n;
  };

  const costs = (e: PolicyEffect): number => {
    let n = 0;
    for (const k of REDUCERS) if (e[k] !== undefined && e[k]! > 1) n++;
    for (const k of INCREASERS) if (e[k] !== undefined && e[k]! < 1) n++;
    if (e.landValue !== undefined && e.landValue < 0) n++;
    if (e.crime !== undefined && e.crime > 0) n++;
    if (e.revenue !== undefined && e.revenue < 1) n++;
    for (const m of Object.values(e.revenueByZone ?? {})) if (m < 1) n++;
    return n;
  };

  it('should give every tier both a benefit and a price', () => {
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      tiers!.forEach((tier, i) => {
        expect(benefits(tier), `${type} 第 ${i + 1} 級沒有好處`).toBeGreaterThan(0);
        expect(costs(tier), `${type} 第 ${i + 1} 級沒有代價`).toBeGreaterThan(0);
      });
    }
  });

  it('should never go backwards as the tier goes up', () => {
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (let i = 1; i < tiers!.length; i++) {
        const prev = tiers![i - 1]!;
        const cur = tiers![i]!;
        for (const k of REDUCERS) {
          if (prev[k] === undefined || cur[k] === undefined) continue;
          expect(cur[k]!, `${type} 第 ${i + 1} 級的 ${k} 沒有比前一級更省`)
            .toBeLessThan(prev[k]!);
        }
        for (const k of [...INCREASERS, ...COUNTERS]) {
          if (prev[k] === undefined || cur[k] === undefined) continue;
          expect(cur[k]!, `${type} 第 ${i + 1} 級的 ${k} 沒有比前一級更強`)
            .toBeGreaterThan(prev[k]!);
        }
        if (prev.crime !== undefined && cur.crime !== undefined) {
          expect(Math.sign(cur.crime), `${type} 第 ${i + 1} 級的犯罪方向跟前一級相反`)
            .toBe(Math.sign(prev.crime));
          expect(Math.abs(cur.crime), `${type} 第 ${i + 1} 級的犯罪效果沒有比前一級強`)
            .toBeGreaterThan(Math.abs(prev.crime));
        }
        for (const z of Object.keys(cur.revenueByZone ?? {})) {
          const zone = Number(z) as ZoneType;
          const a = prev.revenueByZone?.[zone];
          const b = cur.revenueByZone![zone]!;
          if (a === undefined) continue;
          expect(Math.sign(b - 1), `${type} 第 ${i + 1} 級對分區類型 ${z} 的收入方向反了`)
            .toBe(Math.sign(a - 1));
          expect(Math.abs(b - 1), `${type} 第 ${i + 1} 級對分區類型 ${z} 的收入效果沒有更強`)
            .toBeGreaterThan(Math.abs(a - 1));
        }
      }
    }
  });
});

describe('賭場與宵禁是一對相反的條例', () => {
  it('should move crime in opposite directions', () => {
    const gambling = POLICY_EFFECTS[PolicyType.LEGALIZE_GAMBLING]![0]!;
    const curfew = POLICY_EFFECTS[PolicyType.CURFEW]![0]!;
    expect(gambling.crime!, '賭場沒有增加犯罪').toBeGreaterThan(0);
    expect(curfew.crime!, '宵禁沒有減少犯罪').toBeLessThan(0);
    // And commercial revenue runs the opposite way: one opens the nightlife up, the other shuts
    // it down.
    expect(gambling.revenueByZone![ZoneType.COMMERCIAL_LOW]!, '賭場沒有加商業收入')
      .toBeGreaterThan(1);
    expect(curfew.revenueByZone![ZoneType.COMMERCIAL_LOW]!, '宵禁沒有扣商業收入')
      .toBeLessThan(1);
  });
});

describe('新條例的分區類型針對性', () => {
  it('should let industry subsidy hit industry only', () => {
    const tier = POLICY_EFFECTS[PolicyType.INDUSTRY_SUBSIDY]![0]!;
    expect(tier.revenueByZone![ZoneType.INDUSTRIAL]!, '產業補貼沒有加工業收入')
      .toBeGreaterThan(1);
    expect(tier.revenueByZone![ZoneType.RESIDENTIAL_LOW], '產業補貼也加到了住宅')
      .toBeUndefined();
    expect(tier.revenue, '產業補貼用了全分區乘數，那會連住宅一起加').toBeUndefined();
  });

  it('should let heritage preservation cost both commerce and housing', () => {
    // Heritage preservation costs the whole district: height limits and appearance rules apply
    // to everyone.
    const tier = POLICY_EFFECTS[PolicyType.HERITAGE_PRESERVATION]![0]!;
    expect(tier.landValue!, '歷史保存沒有加地價').toBeGreaterThan(0);
    for (const z of [ZoneType.COMMERCIAL_LOW, ZoneType.RESIDENTIAL_LOW]) {
      expect(tier.revenueByZone![z]!, `分區類型 ${z} 沒有付代價`).toBeLessThan(1);
    }
  });
});

describe('全城條例', () => {
  it('should let the surveillance network trade privacy for safety', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);
    expect(o.getCrimeBonus(), '監視器沒有降低犯罪').toBeLessThan(0);
    expect(o.getLandValueBonus(), '監視器沒有代價 —— 被監視是有感覺的').toBeLessThan(0);
  });

  it('should let pay-as-you-throw trade convenience for less garbage', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.PAY_AS_YOU_THROW, 2);
    expect(o.getGarbageMultiplier(), '隨袋徵收沒有減少垃圾').toBeLessThan(1);
    expect(o.getLandValueBonus(), '隨袋徵收沒有代價').toBeLessThan(0);
  });

  it('should not let stacked crime reductions create land value out of nothing', () => {
    // `calculateLandValue` is `value -= crimeRate * CRIME_PENALTY`, so a negative crime rate
    // becomes a land value bonus directly, and a curfew stacked with the surveillance network can
    // keep stacking. The clamp lives in SimulationLoop, and this checks it through the real path.
    const build = (stack: boolean) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
      for (let x = 6; x < 14; x++) {
        state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      }
      const d = state.districts.createDistrict('D');
      for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
      if (stack) {
        state.policies.setPolicyLevel(d.id, PolicyType.CURFEW, 2);
        state.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);
      }
      for (let i = 0; i < 6; i++) loop.tick();
      return state.grid.getCell(10, 11)!.landValue;
    };
    // The two together are -23, far past an empty city's average crime rate: unclamped, land
    // value is pushed up.
    const plain = build(false);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(build(true), '疊了兩條減犯罪的條例之後地價憑空變高了')
      .toBeLessThanOrEqual(plain);
  });

  it('should bill both of them per resident', () => {
    // A city ordinance's districtCells is always 0, so billing on cell count makes it free.
    // PolicyBilling.test.ts's scope check guards that; this only brings the new ordinances into
    // its loop.
    for (const t of [PolicyType.SURVEILLANCE_NETWORK, PolicyType.PAY_AS_YOU_THROW]) {
      expect(POLICY_BILLING[t]!.basis, `${t} 不是按人口計費`).toBe('population');
      expect(POLICY_SCOPE[t], `${t} 不是全城條例`).toBe('city');
    }
  });
});
