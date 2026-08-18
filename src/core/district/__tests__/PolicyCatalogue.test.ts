import { describe, it, expect } from 'vitest';
import { POLICY_EFFECTS, POLICY_CONFIG, maxLevel, type PolicyEffect } from '../PolicyManager';
import { POLICY_BILLING } from '../PolicyBilling';
import { POLICY_SCOPE } from '../PolicyScope';
import { policyEffectSummary } from '../PolicyPresentation';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CityOrdinances } from '../CityOrdinances';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';

/**
 * 目錄的形狀。個別條例的數字會被平衡調動，所以這裡守的是「加一條條例不能漏掉哪
 * 一張表」與「多級條例的價錢必須逐級變貴」，不是某一個數字。
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
    // 多級條例的單價必須嚴格遞增。持平或倒退的話，高等級會變成「白拿」——
    // 那就不是取捨了。
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      for (let i = 1; i < billing!.perUnit.length; i++) {
        expect(billing!.perUnit[i]!, `${type} 第 ${i + 1} 級沒有比前一級貴`)
          .toBeGreaterThan(billing!.perUnit[i - 1]!);
      }
    }
  });

  it('should carry exactly the catalogue that was designed', () => {
    // 寫死一份清單，不是「至少幾條」。只驗數量的話，刪掉夜間經濟再加一條別的
    // 也會過 —— 而且沒有任何測試直接引用夜間經濟。
    expect(new Set(Object.values(PolicyType))).toEqual(new Set([
      PolicyType.NO_HEAVY_INDUSTRY, PolicyType.HIGH_DENSITY_BAN,
      PolicyType.ENCOURAGE_RECYCLING, PolicyType.ORGANIC_FOOD, PolicyType.TOURISM,
      PolicyType.ENERGY_REGULATION,
      PolicyType.LEGALIZE_GAMBLING, PolicyType.NIGHT_ECONOMY, PolicyType.CURFEW,
      PolicyType.HERITAGE_PRESERVATION, PolicyType.INDUSTRY_SUBSIDY,
      PolicyType.SURVEILLANCE_NETWORK, PolicyType.PAY_AS_YOU_THROW,
      PolicyType.WATER_CONSERVATION, PolicyType.SEWAGE_STANDARDS,
      PolicyType.INDUSTRIAL_EMISSION_CONTROL,
      PolicyType.CHILDCARE_SUBSIDY,
    ]));
  });

  it('should put every policy in the scope it was designed for', () => {
    // 刻意重複一份 POLICY_SCOPE 的內容。分類與一致性測試都是從那張表推導預期再
    // 回頭驗那張表 —— 那守得住「表彼此一致」，守不住「範圍是當初決定的那個」。
    // 這一份是產品契約，不是資料的第二份來源。
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
    };
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_SCOPE[type], `${type} 的範圍跟當初的設計不一樣`).toBe(DESIGNED[type]);
    }
  });
});

/**
 * 逐級的方向。
 *
 * 多數條例只有某一級被個別測到 —— 把第二級的收入改成負的、或把宵禁第二級的犯罪
 * 改成正的，都不會有任何測試轉紅。這一組是跨全表的不變量。
 */
describe('逐級的方向', () => {
  /** 減量型的槓桿:乘數 < 1 是好處，> 1 是代價。 */
  const REDUCERS = ['garbage', 'waterDemand', 'sewageLoad', 'industrialPollution',
    'powerDemand'] as const;

  /**
   * 增量型的槓桿:方向跟 REDUCERS 相反，乘數 > 1 才是好處。
   *
   * 分成兩張表而不是在每個槓桿身上標一個 `goodDirection`:標記會跟效果表分開放，
   * 而漏標的那一條會被當成「沒有這個欄位」靜靜跳過 —— 一條純好處的條例就這樣
   * 從這個不變量底下溜過去了。
   */
  const INCREASERS = ['fertility'] as const;

  const benefits = (e: PolicyEffect): number => {
    let n = 0;
    for (const k of REDUCERS) if (e[k] !== undefined && e[k]! < 1) n++;
    for (const k of INCREASERS) if (e[k] !== undefined && e[k]! > 1) n++;
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
        for (const k of INCREASERS) {
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
    // 而且商業收入的方向也相反 —— 一個把夜生活放出來，一個把它關掉。
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
    // 歷史保存是全區都要付代價的 —— 限高與外觀規範對誰都一樣。
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
    // `calculateLandValue` 是 `value -= crimeRate * CRIME_PENALTY` —— 犯罪率變負
    // 會直接變成地價加成，而且宵禁疊上監視器網路可以一直疊下去。夾值做在
    // SimulationLoop，這條走真的路徑驗它。
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
    // 兩條加起來是 −23，遠超過一座空城的平均犯罪率 —— 沒有夾值的話地價會被推高。
    const plain = build(false);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(build(true), '疊了兩條減犯罪的條例之後地價憑空變高了')
      .toBeLessThanOrEqual(plain);
  });

  it('should bill both of them per resident', () => {
    // 全城條例的 districtCells 恆為 0 —— 用格數計費就等於免費。這條由
    // PolicyBilling.test.ts 的範圍檢查守著，這裡只是把新條例納入它的迴圈。
    for (const t of [PolicyType.SURVEILLANCE_NETWORK, PolicyType.PAY_AS_YOU_THROW]) {
      expect(POLICY_BILLING[t]!.basis, `${t} 不是按人口計費`).toBe('population');
      expect(POLICY_SCOPE[t], `${t} 不是全城條例`).toBe('city');
    }
  });
});
