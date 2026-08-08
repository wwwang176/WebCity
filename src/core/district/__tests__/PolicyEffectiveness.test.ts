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
 * simulation reads it. IMPLEMENTED_POLICY_TYPES is DERIVED — to implement one
 * of the three, add its effect and then register it in POLICY_ZONE_RESTRICTIONS
 * (if it restricts construction) or NON_ZONE_IMPLEMENTED_POLICY_TYPES (if it
 * works some other way). Its cost starts applying from that point.
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

  it('should actually block construction for every zone-restricting policy', () => {
    // Ties "implemented" to observable behaviour rather than to set membership:
    // each restricting policy must reject the zone types it names, and leave
    // the others alone.
    //
    // Iterates POLICY_ZONE_RESTRICTIONS, not IMPLEMENTED_POLICY_TYPES. The
    // first version iterated the latter and did `POLICY_ZONE_RESTRICTIONS[type]!`
    // — which booby-traps the NON_ZONE_IMPLEMENTED_POLICY_TYPES extension point
    // the same commit introduced: registering a policy implemented via
    // pollution or income would make `blocked` undefined and crash the suite
    // with "not iterable" on a perfectly correct change.
    const restricting = Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[];
    expect(restricting.length).toBeGreaterThan(0);

    for (const type of restricting) {
      const district = { id: 'd1', policies: [] as { type: PolicyType; active: boolean }[] };
      const mgr = new PolicyManager({ getDistrict: () => district as never });
      mgr.applyPolicy('d1', type);

      expect(isPolicyImplemented(type)).toBe(true);
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
