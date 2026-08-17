import { describe, it, expect } from 'vitest';
import { POLICY_EFFECTS, POLICY_CONFIG, maxLevel } from '../PolicyManager';
import { POLICY_BILLING } from '../PolicyBilling';
import { POLICY_SCOPE } from '../PolicyScope';
import { policyEffectSummary } from '../PolicyPresentation';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

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
