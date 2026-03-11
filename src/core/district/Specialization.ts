import { DistrictManager } from './DistrictManager';
import { Specialization } from './types';

export interface SpecializationBonus {
  efficiencyMultiplier: number;
  revenueMultiplier: number;
}

export const SPECIALIZATION_BONUSES: Record<Specialization, SpecializationBonus> = {
  [Specialization.NONE]: { efficiencyMultiplier: 1, revenueMultiplier: 1 },
  [Specialization.FARMING]: { efficiencyMultiplier: 1.3, revenueMultiplier: 1.1 },
  [Specialization.FORESTRY]: { efficiencyMultiplier: 1.25, revenueMultiplier: 1.15 },
  [Specialization.MINING]: { efficiencyMultiplier: 1.4, revenueMultiplier: 1.2 },
  [Specialization.OIL]: { efficiencyMultiplier: 1.5, revenueMultiplier: 1.3 },
  [Specialization.TOURISM]: { efficiencyMultiplier: 1.2, revenueMultiplier: 1.5 },
  [Specialization.HIGH_TECH]: { efficiencyMultiplier: 1.35, revenueMultiplier: 1.4 },
};

export function setSpecialization(
  dm: DistrictManager,
  districtId: string,
  type: Specialization,
): void {
  const district = dm.getDistrict(districtId);
  if (!district) return;
  district.specialization = type;
}

export function getSpecialization(dm: DistrictManager, districtId: string): Specialization {
  const district = dm.getDistrict(districtId);
  if (!district) return Specialization.NONE;
  return district.specialization;
}

export function getSpecializationBonus(type: Specialization): SpecializationBonus {
  return SPECIALIZATION_BONUSES[type];
}
