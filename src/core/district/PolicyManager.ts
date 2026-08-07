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
 * Policies the simulation actually reads.
 *
 * A repo-wide search for the other three enum members (ENCOURAGE_RECYCLING,
 * ORGANIC_FOOD, TOURISM) finds only this file and its tests — nothing in
 * GarbageService, Pollution, LandValue, Happiness or the income path consults
 * them. They were still billed every budget cycle, $380 for nothing, while the
 * district modal advertised their prices as though they did something (BUG-091).
 *
 * Rather than invent balance numbers for three unspecified mechanics, the charge
 * and the UI now follow what is real. Implementing one is a matter of adding its
 * effect and then adding it to this set — see TODO.md.
 */
export const IMPLEMENTED_POLICY_TYPES: ReadonlySet<PolicyType> = new Set([
  PolicyType.NO_HEAVY_INDUSTRY,
  PolicyType.HIGH_DENSITY_BAN,
]);

/** Does this policy have an effect on the simulation? */
export function isPolicyImplemented(type: PolicyType): boolean {
  return IMPLEMENTED_POLICY_TYPES.has(type);
}

/**
 * Data-driven zone restrictions per policy type (OCP).
 * Adding a new zone-restricting policy only requires a new entry here.
 */
export const POLICY_ZONE_RESTRICTIONS: Partial<Record<PolicyType, ReadonlySet<ZoneType>>> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: new Set([ZoneType.INDUSTRIAL]),
  [PolicyType.HIGH_DENSITY_BAN]: new Set([ZoneType.RESIDENTIAL_HIGH, ZoneType.COMMERCIAL_HIGH]),
};

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
