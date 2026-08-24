import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import { DistrictManager } from '../../district/DistrictManager';
import { PolicyManager, POLICY_EFFECTS } from '../../district/PolicyManager';
import { PolicyType } from '../../district/types';
import { calculateBuildingIncome, calculateZoneIncomes } from '../IncomeCalculator';
import { buildIncomeCalcDeps } from '../IncomeCalcAdapter';
import { createGameState } from '../../simulation/GameState';
import { getBuildingType } from '../../building/types';

/**
 * The income multiplier receives only coordinates, so an income penalty spreads evenly over
 * residential, commercial, industrial and office. Most ordinance costs land on one industry:
 * recycling raises handling costs for businesses and leaves households untouched.
 */

/**
 * Temporarily replaces one policy's effect. The subject is the mechanism, not the numbers a
 * particular policy happens to carry; bound to the real entry, tuning those numbers would
 * break this test.
 *
 * `tiers` is one entry per level, matching the shape of `POLICY_EFFECTS`.
 */
function withEffect(type: PolicyType, tiers: unknown[], body: () => void) {
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try { body(); } finally { (POLICY_EFFECTS as Record<string, unknown>)[type] = saved; }
}

describe('收入乘數認得分區類型', () => {
  it('should apply a zone-scoped multiplier only to that zone', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    withEffect(PolicyType.TOURISM, [{ revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.5 } }], () => {
      pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW), '商業沒有被扣').toBe(0.5);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
    });
  });

  it('should still apply a flat multiplier to every zone', () => {
    // `revenue` and `revenueByZone` are independent levers; adding the latter must not
    // disable the former.
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    withEffect(PolicyType.TOURISM, [{ revenue: 1.2 }], () => {
      pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
      for (const z of [ZoneType.COMMERCIAL_LOW, ZoneType.RESIDENTIAL_LOW, ZoneType.INDUSTRIAL]) {
        expect(pm.getRevenueMultiplier(d.id, z), `分區類型 ${z} 沒有吃到全域乘數`).toBeCloseTo(1.2, 6);
      }
    });
  });

  it('should hand the building zone type to the multiplier', () => {
    // This covers the wiring: if the signature changes but the caller stops passing the value,
    // PolicyManager's own unit tests still pass. buildingId 1 is Small House
    // (RESIDENTIAL_LOW), see building/types.ts.
    const HOUSE = 1;
    const expected = getBuildingType(HOUSE)!.zoneType;
    expect(expected, 'buildingId 1 不是住宅建築，這條測試的前提壞了')
      .toBe(ZoneType.RESIDENTIAL_LOW);

    const seen: number[] = [];
    calculateBuildingIncome({
      taxRates: { residential: 10, business: 10 },
      getResidentEducations: () => [],
      getRevenueMultiplier: (_x, _y, zoneType) => { seen.push(zoneType); return 1; },
    }, 3, 4, HOUSE);

    expect(seen, 'getRevenueMultiplier 沒有收到分區類型').toEqual([expected]);
  });

  it('should hand the zone type through for a non-residential building too', () => {
    // Residential and non-residential are separate branches in calculateBuildingIncome, each
    // calling the multiplier once.
    const SHOP = 7;
    const expected = getBuildingType(SHOP)!.zoneType;
    expect(expected, 'buildingId 7 不是商業建築，這條測試的前提壞了')
      .toBe(ZoneType.COMMERCIAL_LOW);

    const seen: number[] = [];
    calculateBuildingIncome({
      taxRates: { residential: 10, business: 10 },
      getResidentEducations: () => [],
      getRevenueMultiplier: (_x, _y, zoneType) => { seen.push(zoneType); return 1; },
    }, 3, 4, SHOP);

    expect(seen, 'getRevenueMultiplier 沒有收到分區類型').toEqual([expected]);
  });
});

describe('adapter 把建築的分區類型接對了', () => {
  it('should pass the building zone type, not a coordinate', () => {
    // `ZoneType` is a numeric enum, so an adapter passing `x` where `zoneType` belongs
    // type-checks cleanly, and testing calculateBuildingIncome alone would not catch it
    // because the callback the test supplies never goes through the adapter. This case runs
    // the whole path.
    const state = createGameState(20, 20);
    // Without power, calculateBuildingIncome returns 0 on its first line and the multiplier
    // is never called.
    state.power.isPowered = () => true;

    const SHOP = 7;
    const X = 11, Y = 13;
    expect(X, 'X 剛好等於分區類型的數值，接錯線也看不出來').not.toBe(ZoneType.COMMERCIAL_LOW);
    expect(Y, 'Y 剛好等於分區類型的數值，接錯線也看不出來').not.toBe(ZoneType.COMMERCIAL_LOW);

    state.grid.setCell(X, Y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    const d = state.districts.createDistrict('D');
    state.districts.addCellToDistrict(d.id, X, Y);

    const seen: number[] = [];
    const real = state.policies.getRevenueMultiplier.bind(state.policies);
    state.policies.getRevenueMultiplier = (id, zt) => { seen.push(zt); return real(id, zt); };

    calculateZoneIncomes(buildIncomeCalcDeps(state));

    expect(seen, 'PolicyManager 收到的不是那棟建築的分區類型')
      .toEqual([ZoneType.COMMERCIAL_LOW]);
  });
});
