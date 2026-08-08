import { Policy, PolicyType, type District } from './types';
import { ZoneType } from '../grid/types';

/** Minimal interface for district lookup (DIP). */
export interface DistrictLookup {
  getDistrict(id: string): District | undefined;
}

/** Consolidated per-policy-type configuration (OCP-friendly). */
export interface PolicyTypeConfig {
  name: string;
  cost: number;
}

/** Single source of truth for all policy type parameters. */
export const POLICY_CONFIG: Record<PolicyType, PolicyTypeConfig> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: { name: 'No Heavy Industry', cost: 150 },
  [PolicyType.ENCOURAGE_RECYCLING]: { name: 'Encourage Recycling', cost: 100 },
  [PolicyType.HIGH_DENSITY_BAN]: { name: 'High Density Ban', cost: 120 },
  [PolicyType.ORGANIC_FOOD]: { name: 'Organic Food', cost: 80 },
  [PolicyType.TOURISM]: { name: 'Tourism Promotion', cost: 200 },
};

/**
 * Data-driven zone restrictions per policy type (OCP).
 * Adding a new zone-restricting policy only requires a new entry here.
 */
export const POLICY_ZONE_RESTRICTIONS: Partial<Record<PolicyType, ReadonlySet<ZoneType>>> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: new Set([ZoneType.INDUSTRIAL]),
  [PolicyType.HIGH_DENSITY_BAN]: new Set([ZoneType.RESIDENTIAL_HIGH, ZoneType.COMMERCIAL_HIGH]),
};

/**
 * What each non-zoning policy does, in the units the consumer uses.
 *
 * Three of the five policies did nothing at all: a repo-wide search for
 * ENCOURAGE_RECYCLING, ORGANIC_FOOD and TOURISM found only this file and its
 * tests. They were billed every budget cycle regardless — $380 for nothing,
 * with the district modal advertising the prices as though they bought
 * something (BUG-091). Hiding them from the UI was the stopgap; this table is
 * the implementation.
 *
 * Each is deliberately a small effect on a number the player can already read
 * off a panel, so "did that policy do anything?" is answerable by looking.
 */
export const POLICY_EFFECTS: Partial<Record<PolicyType, {
  /** Multiplier on garbage produced in the district. */
  garbage?: number;
  /** Multiplier on tax revenue from buildings in the district. */
  revenue?: number;
  /** Flat addition to land value before the usual clamp. */
  landValue?: number;
}>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { garbage: 0.65 },
  [PolicyType.TOURISM]: { revenue: 1.2 },
  [PolicyType.ORGANIC_FOOD]: { landValue: 6 },
};

/**
 * Policies implemented by something other than a zone restriction — derived
 * from the effect table, so adding an effect is all it takes to make a policy
 * real, and a policy with no effect can never be offered.
 */
const NON_ZONE_IMPLEMENTED_POLICY_TYPES: readonly PolicyType[] =
  Object.keys(POLICY_EFFECTS) as PolicyType[];

/**
 * Policies the simulation actually reads — DERIVED, not a hand-kept list.
 *
 * A repo-wide search for the other three enum members (ENCOURAGE_RECYCLING,
 * ORGANIC_FOOD, TOURISM) finds only this file and its tests — nothing in
 * GarbageService, Pollution, LandValue, Happiness or the income path consults
 * them. They were still billed every budget cycle, $380 for nothing, while the
 * district modal advertised their prices as though they did something (BUG-091).
 *
 * The first fix wrote the two real policies out by hand, which made this the
 * third list needing manual sync (POLICY_CONFIG and DistrictModal being the
 * others) and made the test that "checked" it a tautology — a subset assertion
 * over a set literally built from those members. Deriving it from the
 * restriction table removes the sync obligation entirely.
 */
export const IMPLEMENTED_POLICY_TYPES: ReadonlySet<PolicyType> = new Set<PolicyType>([
  ...(Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]),
  ...NON_ZONE_IMPLEMENTED_POLICY_TYPES,
]);

/** Does this policy have an effect on the simulation? */
export function isPolicyImplemented(type: PolicyType): boolean {
  return IMPLEMENTED_POLICY_TYPES.has(type);
}

export class PolicyManager {
  private districtLookup: DistrictLookup;
  private nextPolicyId = 1;

  constructor(districtLookup: DistrictLookup) {
    this.districtLookup = districtLookup;
  }

  applyPolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;

    // Don't add duplicate policies
    if (district.policies.some((p) => p.type === policyType)) return;

    const cfg = POLICY_CONFIG[policyType];
    const policy: Policy = {
      id: `policy_${this.nextPolicyId++}`,
      name: cfg.name,
      type: policyType,
      cost: cfg.cost,
      active: true,
    };
    district.policies.push(policy);
  }

  removePolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;

    district.policies = district.policies.filter((p) => p.type !== policyType);
  }

  isPolicyActive(districtId: string, policyType: PolicyType): boolean {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return false;

    return district.policies.some((p) => p.type === policyType && p.active);
  }

  getPolicyCost(policyType: PolicyType): number {
    return POLICY_CONFIG[policyType].cost;
  }

  /**
   * Combined effect of a district's active policies on one quantity.
   *
   * `districtId` is nullable because most callers ask about a CELL, and most
   * cells are in no district at all — those get the identity value rather than
   * a special case at every call site.
   */
  private effect(
    districtId: string | null,
    pick: (e: NonNullable<(typeof POLICY_EFFECTS)[PolicyType]>) => number | undefined,
    identity: number,
    combine: (a: number, b: number) => number,
  ): number {
    if (!districtId) return identity;
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return identity;

    let out = identity;
    for (const policy of district.policies) {
      if (!policy.active) continue;
      const value = pick(POLICY_EFFECTS[policy.type] ?? {});
      if (value !== undefined) out = combine(out, value);
    }
    return out;
  }

  /** Multiplier on garbage produced by buildings in this district. */
  getGarbageMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.garbage, 1, (a, b) => a * b);
  }

  /** Multiplier on tax revenue from buildings in this district. */
  getRevenueMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.revenue, 1, (a, b) => a * b);
  }

  /** Flat land-value bonus for cells in this district. */
  getLandValueBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.landValue, 0, (a, b) => a + b);
  }

  /**
   * Policy objects themselves live on their District, so only the id counter
   * needs persisting here — without it, policies created after a load would
   * reuse ids already present on restored districts (BUG-053).
   */
  toJSON(): { nextPolicyId: number } {
    return { nextPolicyId: this.nextPolicyId };
  }

  restore(data: { nextPolicyId?: number } | undefined): void {
    if (data?.nextPolicyId != null) this.nextPolicyId = data.nextPolicyId;
  }

  canBuildInDistrict(districtId: string, buildingZoneType: ZoneType): boolean {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return true;

    // Data-driven zone restrictions (OCP: adding new policies only needs POLICY_ZONE_RESTRICTIONS entry)
    for (const [policyType, blockedZones] of Object.entries(POLICY_ZONE_RESTRICTIONS)) {
      if (blockedZones!.has(buildingZoneType) && this.isPolicyActive(districtId, policyType as PolicyType)) {
        return false;
      }
    }

    return true;
  }
}
