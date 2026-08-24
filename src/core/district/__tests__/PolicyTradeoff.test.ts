import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

/**
 * A policy is a trade-off, not a price list.
 *
 * Five policies were almost all pure benefit — recycling cuts refuse, tourism raises tax revenue,
 * organic food raises land value — and affordable meant always on. That is not a decision.
 *
 * A trade of more revenue for more crime could not be expressed because nothing in the simulation
 * could make crime **rise**: `PoliceService` offers only `getCrimeReduction`.
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
    // No policy should be a pure benefit. Restrictive ones, with no POLICY_EFFECTS entry, are
    // excluded: their cost is the opportunity cost of the high-tax buildings the district cannot
    // grow.
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
