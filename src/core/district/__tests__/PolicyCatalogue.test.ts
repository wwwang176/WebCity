import { describe, it, expect } from 'vitest';
import { POLICY_EFFECTS, POLICY_CONFIG, maxLevel } from '../PolicyManager';
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

  it('should offer a meaningful number of policies', () => {
    // 條例數量少的話，這整套機制跟原本的價目表沒有差別。
    expect(Object.values(PolicyType).length, '目錄太小').toBeGreaterThanOrEqual(11);
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
