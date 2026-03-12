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

  canBuildInDistrict(districtId: string, buildingZoneType: ZoneType): boolean {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return true;

    // NO_HEAVY_INDUSTRY blocks industrial zones
    if (
      this.isPolicyActive(districtId, PolicyType.NO_HEAVY_INDUSTRY) &&
      buildingZoneType === ZoneType.INDUSTRIAL
    ) {
      return false;
    }

    // HIGH_DENSITY_BAN blocks high density residential and commercial
    if (this.isPolicyActive(districtId, PolicyType.HIGH_DENSITY_BAN)) {
      if (
        buildingZoneType === ZoneType.RESIDENTIAL_HIGH ||
        buildingZoneType === ZoneType.COMMERCIAL_HIGH
      ) {
        return false;
      }
    }

    return true;
  }
}
