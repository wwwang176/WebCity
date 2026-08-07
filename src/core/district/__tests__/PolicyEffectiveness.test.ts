import { describe, it, expect } from 'vitest';
import { PolicyType } from '../types';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, isPolicyImplemented } from '../PolicyManager';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';

/**
 * Three of the five district policies — ENCOURAGE_RECYCLING, ORGANIC_FOOD and
 * TOURISM — appear in no simulation code at all: a repo-wide search for their
 * enum members finds only PolicyManager itself and its tests. Only
 * NO_HEAVY_INDUSTRY and HIGH_DENSITY_BAN reach canBuildInDistrict and actually
 * restrict growth.
 *
 * calculateDistrictPolicyCost nonetheless summed every active policy's cost, so
 * the three no-ops billed $380 per budget cycle for nothing while the modal
 * advertised their prices as if they did something (BUG-091).
 *
 * These tests pin the honest contract: a policy is charged if and only if the
 * simulation reads it. When one of the three is implemented, add it to
 * IMPLEMENTED_POLICY_TYPES and its cost starts applying.
 */
describe('policies are charged only when they do something', () => {
  it('should mark exactly the policies the simulation reads as implemented', () => {
    expect(isPolicyImplemented(PolicyType.NO_HEAVY_INDUSTRY)).toBe(true);
    expect(isPolicyImplemented(PolicyType.HIGH_DENSITY_BAN)).toBe(true);
    expect(isPolicyImplemented(PolicyType.ENCOURAGE_RECYCLING)).toBe(false);
    expect(isPolicyImplemented(PolicyType.ORGANIC_FOOD)).toBe(false);
    expect(isPolicyImplemented(PolicyType.TOURISM)).toBe(false);
  });

  it('should not bill an active but unimplemented policy', () => {
    const districts = [{
      policies: [
        { active: true, cost: POLICY_CONFIG[PolicyType.TOURISM].cost, type: PolicyType.TOURISM },
        { active: true, cost: POLICY_CONFIG[PolicyType.ORGANIC_FOOD].cost, type: PolicyType.ORGANIC_FOOD },
      ],
    }];

    expect(calculateDistrictPolicyCost(districts)).toBe(0);
  });

  it('should still bill implemented policies', () => {
    const districts = [{
      policies: [
        { active: true, cost: POLICY_CONFIG[PolicyType.NO_HEAVY_INDUSTRY].cost, type: PolicyType.NO_HEAVY_INDUSTRY },
        { active: true, cost: POLICY_CONFIG[PolicyType.HIGH_DENSITY_BAN].cost, type: PolicyType.HIGH_DENSITY_BAN },
      ],
    }];

    expect(calculateDistrictPolicyCost(districts)).toBe(150 + 120);
  });

  it('should not bill an inactive implemented policy', () => {
    const districts = [{
      policies: [{ active: false, cost: 150, type: PolicyType.NO_HEAVY_INDUSTRY }],
    }];

    expect(calculateDistrictPolicyCost(districts)).toBe(0);
  });

  it('should keep IMPLEMENTED_POLICY_TYPES a subset of POLICY_CONFIG', () => {
    for (const t of IMPLEMENTED_POLICY_TYPES) {
      expect(POLICY_CONFIG[t]).toBeDefined();
    }
  });
});
