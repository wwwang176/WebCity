import { DistrictManager } from './DistrictManager';
import { Policy, PolicyType } from './types';
import { ZoneType } from '../grid/types';

const POLICY_COSTS: Record<PolicyType, number> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 150,
  [PolicyType.ENCOURAGE_RECYCLING]: 100,
  [PolicyType.HIGH_DENSITY_BAN]: 120,
  [PolicyType.ORGANIC_FOOD]: 80,
  [PolicyType.TOURISM]: 200,
};

const POLICY_NAMES: Record<PolicyType, string> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'No Heavy Industry',
  [PolicyType.ENCOURAGE_RECYCLING]: 'Encourage Recycling',
  [PolicyType.HIGH_DENSITY_BAN]: 'High Density Ban',
  [PolicyType.ORGANIC_FOOD]: 'Organic Food',
  [PolicyType.TOURISM]: 'Tourism Promotion',
};

let policyIdCounter = 1;

export class PolicyManager {
  private districtManager: DistrictManager;

  constructor(districtManager: DistrictManager) {
    this.districtManager = districtManager;
  }

  applyPolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtManager.getDistrict(districtId);
    if (!district) return;

    // Don't add duplicate policies
    if (district.policies.some((p) => p.type === policyType)) return;

    const policy: Policy = {
      id: `policy_${policyIdCounter++}`,
      name: POLICY_NAMES[policyType],
      type: policyType,
      cost: POLICY_COSTS[policyType],
      active: true,
    };
    district.policies.push(policy);
  }

  removePolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtManager.getDistrict(districtId);
    if (!district) return;

    district.policies = district.policies.filter((p) => p.type !== policyType);
  }

  isPolicyActive(districtId: string, policyType: PolicyType): boolean {
    const district = this.districtManager.getDistrict(districtId);
    if (!district) return false;

    return district.policies.some((p) => p.type === policyType && p.active);
  }

  getPolicyCost(policyType: PolicyType): number {
    return POLICY_COSTS[policyType];
  }

  canBuildInDistrict(districtId: string, buildingZoneType: ZoneType): boolean {
    const district = this.districtManager.getDistrict(districtId);
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
