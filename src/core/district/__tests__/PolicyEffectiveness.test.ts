import { describe, it, expect } from 'vitest';
import { PolicyType } from '../types';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, POLICY_ZONE_RESTRICTIONS, isPolicyImplemented, PolicyManager } from '../PolicyManager';
import { ZoneType } from '../../grid/types';
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
/** ZoneType is a numeric enum, so Object.values yields the names too. */
function numericZones(): ZoneType[] {
  return Object.values(ZoneType).filter(z => typeof z === 'number') as ZoneType[];
}

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

  it('should leave construction untouched for every unimplemented policy', () => {
    // The old assertion walked IMPLEMENTED_POLICY_TYPES and checked each member
    // existed in POLICY_CONFIG — true by the enum's type, and true of ANY set
    // of PolicyType values including the empty one. It could not fail.
    //
    // The honest invariant runs the other way: a policy is excluded from
    // billing precisely because applying it changes nothing. Assert that.
    const unimplemented = Object.values(PolicyType).filter(t => !isPolicyImplemented(t));
    expect(unimplemented.length).toBeGreaterThan(0);

    for (const type of unimplemented) {
      const district = { id: 'd1', policies: [] as { type: PolicyType; active: boolean }[] };
      const mgr = new PolicyManager({ getDistrict: () => district as never });
      mgr.applyPolicy('d1', type);
      for (const zone of numericZones()) {
        expect(mgr.canBuildInDistrict('d1', zone)).toBe(true);
      }
    }
  });

  it('should price every policy type, implemented or not', () => {
    // Unimplemented policies still load from old saves and still need a name
    // and a price to be displayed and removed.
    for (const t of Object.values(PolicyType)) {
      expect(POLICY_CONFIG[t]).toBeDefined();
      expect(POLICY_CONFIG[t].cost).toBeGreaterThan(0);
    }
  });

  it('should actually block construction for every implemented policy', () => {
    // Ties "implemented" to observable behaviour rather than to set membership:
    // each implemented policy must reject at least one zone type it is applied
    // to, and leave the others alone.
    for (const type of IMPLEMENTED_POLICY_TYPES) {
      const district = { id: 'd1', policies: [] as { type: PolicyType; active: boolean }[] };
      const mgr = new PolicyManager({ getDistrict: () => district as never });
      mgr.applyPolicy('d1', type);

      const blocked = POLICY_ZONE_RESTRICTIONS[type]!;
      for (const zone of blocked) {
        expect(mgr.canBuildInDistrict('d1', zone)).toBe(false);
      }
      for (const zone of numericZones().filter(z => !blocked.has(z))) {
        expect(mgr.canBuildInDistrict('d1', zone)).toBe(true);
      }
    }
  });
});
