import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

/**
 * 條例要是取捨，不是價目表。
 *
 * 原本五條政策幾乎全是純好處 —— 回收減垃圾、觀光加稅收、有機食品加地價 —— 只要
 * 付得起就一定開。那不是決策。
 *
 * 做不出「+收入 +犯罪」這類取捨的原因是整個模擬沒有任何東西能讓犯罪**上升**:
 * `PoliceService` 只提供 `getCrimeReduction`。
 */

describe('條例的取捨', () => {
  it('should let one policy move two numbers in opposite directions', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
    expect(pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW), '觀光沒有加收入')
      .toBeGreaterThan(1);
    expect(pm.getCrimeBonus(d.id), '觀光沒有帶來任何代價').toBeGreaterThan(0);
  });

  it('should give no crime bonus outside any district', () => {
    expect(new PolicyManager(new DistrictManager()).getCrimeBonus(null)).toBe(0);
  });

  it('should give no crime bonus when the policy is off', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
    pm.setPolicyLevel(d.id, PolicyType.TOURISM, 0);
    expect(pm.getCrimeBonus(d.id)).toBe(0);
  });

  it('should have at least one downside on every tier of every policy', () => {
    // 純好處的條例不該存在。限制型（沒有 POLICY_EFFECTS 條目）不在此列 —— 它們的
    // 代價是機會成本:該區長不出高稅收的建築。
    const isDownside = (t: PolicyEffect) =>
      (t.revenue !== undefined && t.revenue < 1)
      || Object.values(t.revenueByZone ?? {}).some(m => m < 1)
      || (t.crime !== undefined && t.crime > 0)
      || (t.landValue !== undefined && t.landValue < 0)
      || (t.garbage !== undefined && t.garbage > 1);

    const checked: string[] = [];
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (const [i, t] of tiers!.entries()) {
        checked.push(`${type}#${i + 1}`);
        expect(isDownside(t), `${type} 第 ${i + 1} 級是純好處，付得起就一定開`).toBe(true);
      }
    }
    expect(checked.length, '效果表是空的，這條測試等於空轉').toBeGreaterThan(0);
  });
});
