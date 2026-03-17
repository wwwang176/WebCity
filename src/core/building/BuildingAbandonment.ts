import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';

export interface AbandonmentConditions {
  businessTaxRate: number;
  residentialTaxRate: number;
  isPowered: boolean;
  isWatered: boolean;
  crimeRate: number;
  pollution: number; // ground pollution
  occupancy: number; // 0~1
}

export interface AbandonmentFactors {
  tax: number;
  power: number;
  water: number;
  crime: number;
  pollution: number;
  vacancy: number;
}

export interface AbandonmentResult {
  totalDelta: number;
  factors: AbandonmentFactors;
}

/** Stress thresholds */
export const ABANDONMENT = {
  STRESS_DOWNGRADE: 50,
  STRESS_NO_INCOME: 75,
  STRESS_ABANDON: 100,
  RECOVERY_RATE: 2,
} as const;

/** Zone sensitivity multipliers: [tax, pollution, crime] */
const ZONE_SENSITIVITY: Record<string, { tax: number; pollution: number; crime: number }> = {
  residential: { tax: 0.7, pollution: 1.2, crime: 1.2 },
  commercial: { tax: 1.5, pollution: 1.0, crime: 1.3 },
  industrial: { tax: 1.0, pollution: 0, crime: 0.5 },
  office: { tax: 1.3, pollution: 1.2, crime: 1.0 },
};

function getZoneCategory(zoneType: ZoneType): string {
  if (isResidentialZone(zoneType)) return 'residential';
  if (isCommercialZone(zoneType)) return 'commercial';
  if (zoneType === ZoneType.INDUSTRIAL) return 'industrial';
  if (zoneType === ZoneType.OFFICE) return 'office';
  return 'residential';
}

/**
 * Calculate abandonment stress delta for a building.
 * Returns positive delta (stress increase) or negative (recovery).
 * Pure function — no side effects.
 */
export function calculateAbandonmentStress(
  zoneType: ZoneType,
  conditions: AbandonmentConditions,
): AbandonmentResult {
  const cat = getZoneCategory(zoneType);
  const sens = ZONE_SENSITIVITY[cat]!;

  const factors: AbandonmentFactors = { tax: 0, power: 0, water: 0, crime: 0, pollution: 0, vacancy: 0 };

  // Tax pressure
  if (isResidentialZone(zoneType)) {
    if (conditions.residentialTaxRate > 12) {
      factors.tax = (conditions.residentialTaxRate - 12) * 1.0 * sens.tax;
    }
  } else {
    if (conditions.businessTaxRate > 9) {
      factors.tax = (conditions.businessTaxRate - 9) * 1.5 * sens.tax;
    }
  }

  // Power
  if (!conditions.isPowered) factors.power = 8;

  // Water
  if (!conditions.isWatered) factors.water = 6;

  // Crime
  if (conditions.crimeRate > 30) {
    factors.crime = (conditions.crimeRate - 30) * 0.15 * sens.crime;
  }

  // Pollution (industrial is immune)
  if (conditions.pollution > 40) {
    factors.pollution = (conditions.pollution - 40) * 0.1 * sens.pollution;
  }

  // Vacancy
  if (conditions.occupancy < 0.1) {
    factors.vacancy = 3;
  }

  const sum = factors.tax + factors.power + factors.water + factors.crime + factors.pollution + factors.vacancy;

  // Recovery only when ALL factors are zero
  const totalDelta = sum === 0 ? -ABANDONMENT.RECOVERY_RATE : sum;

  return { totalDelta, factors };
}
