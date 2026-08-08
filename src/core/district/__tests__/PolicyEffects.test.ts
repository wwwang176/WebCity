import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import {
  PolicyManager, POLICY_EFFECTS, POLICY_CONFIG,
  IMPLEMENTED_POLICY_TYPES, isPolicyImplemented,
} from '../PolicyManager';
import { PolicyType } from '../types';
import { calculateLandValue } from '../../economy/LandValue';

/**
 * Three of the five policies did nothing at all.
 *
 * A repo-wide search for ENCOURAGE_RECYCLING, ORGANIC_FOOD and TOURISM found
 * only PolicyManager and its tests — GarbageService, Pollution, LandValue,
 * Happiness and the income path all ignored them. They were billed every budget
 * cycle regardless: $380 for nothing, with the district modal advertising the
 * prices as though they bought something (BUG-091). The stopgap was to hide
 * them from the UI; this is the actual implementation.
 *
 * Each is deliberately a small, legible effect on a number the player can
 * already see, so "did that policy do anything?" is answerable by looking.
 */
function districtWith(...policies: PolicyType[]): { policies: PolicyManager; id: string } {
  const districts = new DistrictManager();
  const d = districts.createDistrict('Test');
  const mgr = new PolicyManager(districts);
  for (const p of policies) mgr.applyPolicy(d.id, p);
  return { policies: mgr, id: d.id };
}

describe('every policy the game charges for does something', () => {
  it('should treat all five as implemented', () => {
    for (const type of Object.keys(POLICY_CONFIG) as PolicyType[]) {
      expect(isPolicyImplemented(type), type).toBe(true);
    }
    expect(IMPLEMENTED_POLICY_TYPES.size).toBe(Object.keys(POLICY_CONFIG).length);
  });

  it('should have an effect entry for every non-zoning policy', () => {
    // The derived list is what the modal offers, so a policy in it with no
    // effect anywhere is the exact defect this file exists to prevent.
    for (const type of [PolicyType.ENCOURAGE_RECYCLING, PolicyType.ORGANIC_FOOD, PolicyType.TOURISM]) {
      expect(POLICY_EFFECTS[type], type).toBeDefined();
    }
  });
});

describe('Encourage Recycling cuts what the district throws away', () => {
  it('should reduce garbage production', () => {
    const { policies, id } = districtWith(PolicyType.ENCOURAGE_RECYCLING);
    expect(policies.getGarbageMultiplier(id)).toBeLessThan(1);
    expect(policies.getGarbageMultiplier(id)).toBeGreaterThan(0);
  });

  it('should change nothing without the policy', () => {
    const { policies, id } = districtWith();
    expect(policies.getGarbageMultiplier(id)).toBe(1);
  });

  it('should change nothing outside any district', () => {
    const { policies } = districtWith(PolicyType.ENCOURAGE_RECYCLING);
    expect(policies.getGarbageMultiplier(null)).toBe(1);
    expect(policies.getGarbageMultiplier('no-such-district')).toBe(1);
  });

  it('should stop applying once the policy is removed', () => {
    const { policies, id } = districtWith(PolicyType.ENCOURAGE_RECYCLING);
    policies.removePolicy(id, PolicyType.ENCOURAGE_RECYCLING);
    expect(policies.getGarbageMultiplier(id)).toBe(1);
  });
});

describe('Tourism Promotion raises what the district earns', () => {
  it('should raise the revenue multiplier', () => {
    const { policies, id } = districtWith(PolicyType.TOURISM);
    expect(policies.getRevenueMultiplier(id)).toBeGreaterThan(1);
  });

  it('should change nothing without the policy, or outside a district', () => {
    expect(districtWith().policies.getRevenueMultiplier('any')).toBe(1);
    const { policies } = districtWith(PolicyType.TOURISM);
    expect(policies.getRevenueMultiplier(null)).toBe(1);
  });
});

describe('Organic Food makes the district a nicer place to live', () => {
  it('should add a land value bonus', () => {
    const { policies, id } = districtWith(PolicyType.ORGANIC_FOOD);
    expect(policies.getLandValueBonus(id)).toBeGreaterThan(0);
  });

  it('should change nothing without the policy, or outside a district', () => {
    expect(districtWith().policies.getLandValueBonus('any')).toBe(0);
    const { policies } = districtWith(PolicyType.ORGANIC_FOOD);
    expect(policies.getLandValueBonus(null)).toBe(0);
  });

  it('should actually move the land value it feeds', () => {
    // The bonus is only real if the function that consumes it uses it.
    const base = { serviceCoverage: 5, parkProximity: false, waterfront: false,
                   pollution: 10, noise: 10, crimeRate: 10 };
    const { policies, id } = districtWith(PolicyType.ORGANIC_FOOD);
    expect(calculateLandValue({ ...base, policyBonus: policies.getLandValueBonus(id) }))
      .toBeGreaterThan(calculateLandValue(base));
  });

  it('should not push land value past the ordinary ceiling', () => {
    // Land value is clamped, and the migration weighting is calibrated against
    // that clamp — a policy that broke through it would move the threshold.
    const maxed = { serviceCoverage: 100, parkProximity: true, waterfront: true,
                    pollution: 0, noise: 0, crimeRate: 0, policyBonus: 50 };
    expect(calculateLandValue(maxed)).toBe(calculateLandValue({ ...maxed, policyBonus: 0 }));
  });
});

describe('policies stack per district, not city-wide', () => {
  it('should apply each district its own effects', () => {
    const districts = new DistrictManager();
    const green = districts.createDistrict('Green');
    const resort = districts.createDistrict('Resort');
    const mgr = new PolicyManager(districts);
    mgr.applyPolicy(green.id, PolicyType.ENCOURAGE_RECYCLING);
    mgr.applyPolicy(resort.id, PolicyType.TOURISM);

    expect(mgr.getGarbageMultiplier(green.id)).toBeLessThan(1);
    expect(mgr.getGarbageMultiplier(resort.id)).toBe(1);
    expect(mgr.getRevenueMultiplier(resort.id)).toBeGreaterThan(1);
    expect(mgr.getRevenueMultiplier(green.id)).toBe(1);
  });

  it('should let one district carry several policies at once', () => {
    const { policies, id } = districtWith(
      PolicyType.ENCOURAGE_RECYCLING, PolicyType.TOURISM, PolicyType.ORGANIC_FOOD,
    );
    expect(policies.getGarbageMultiplier(id)).toBeLessThan(1);
    expect(policies.getRevenueMultiplier(id)).toBeGreaterThan(1);
    expect(policies.getLandValueBonus(id)).toBeGreaterThan(0);
  });
});
