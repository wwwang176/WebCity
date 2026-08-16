import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import { DistrictManager } from '../../district/DistrictManager';
import { PolicyManager, POLICY_EFFECTS } from '../../district/PolicyManager';
import { PolicyType } from '../../district/types';
import { calculateBuildingIncome } from '../IncomeCalculator';
import { getBuildingType } from '../../building/types';

/**
 * 收入乘數只有座標，所以任何「收入代價」都會平均落在住宅、商業、工業、辦公上。
 * 而多數條例的代價本來就落在特定產業:回收增加的是商家的處理成本，跟住戶無關。
 */

/**
 * 暫時把某一條政策的效果換掉。測的是機制，不是某一條政策現在剛好長什麼樣 ——
 * 綁死在真實條目上的話，之後調整那條政策的數字就會誤傷這支測試。
 */
function withEffect(type: PolicyType, effect: unknown, body: () => void) {
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = effect;
  try { body(); } finally { (POLICY_EFFECTS as Record<string, unknown>)[type] = saved; }
}

describe('收入乘數認得分區類型', () => {
  it('should apply a zone-scoped multiplier only to that zone', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    withEffect(PolicyType.TOURISM, { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.5 } }, () => {
      pm.applyPolicy(d.id, PolicyType.TOURISM);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW), '商業沒有被扣').toBe(0.5);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
    });
  });

  it('should still apply a flat multiplier to every zone', () => {
    // `revenue` 與 `revenueByZone` 是兩個獨立的槓桿，加了後者不能讓前者失效。
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    withEffect(PolicyType.TOURISM, { revenue: 1.2 }, () => {
      pm.applyPolicy(d.id, PolicyType.TOURISM);
      for (const z of [ZoneType.COMMERCIAL_LOW, ZoneType.RESIDENTIAL_LOW, ZoneType.INDUSTRIAL]) {
        expect(pm.getRevenueMultiplier(d.id, z), `分區類型 ${z} 沒有吃到全域乘數`).toBeCloseTo(1.2, 6);
      }
    });
  });

  it('should hand the building zone type to the multiplier', () => {
    // 這條抓的是接線:簽章改了但呼叫端沒傳，PolicyManager 的單元測試照樣會過。
    // buildingId 1 是 Small House（RESIDENTIAL_LOW），見 building/types.ts。
    const HOUSE = 1;
    const expected = getBuildingType(HOUSE)!.zoneType;

    const seen: number[] = [];
    calculateBuildingIncome({
      taxRates: { residential: 10, business: 10 },
      getResidentEducations: () => [],
      getRevenueMultiplier: (_x, _y, zoneType) => { seen.push(zoneType); return 1; },
    }, 3, 4, HOUSE);

    expect(seen, 'getRevenueMultiplier 沒有收到分區類型').toEqual([expected]);
  });

  it('should hand the zone type through for a non-residential building too', () => {
    // 住宅與非住宅是 calculateBuildingIncome 裡兩條不同的分支，各自呼叫一次。
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
