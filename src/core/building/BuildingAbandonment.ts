import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';

export interface AbandonmentConditions {
  businessTaxRate: number;
  residentialTaxRate: number;
  isPowered: boolean;
  isWatered: boolean;
  /** Per-cell crime rate (0~50, adjusted by local police coverage). */
  crimeRate: number;
  /** Per-cell ground pollution. */
  pollution: number;
  /** Building level (1~3). Higher levels are more tax-sensitive. */
  buildingLevel: number;
  /** Continuous service score (0~10) based on distance to facilities. */
  serviceScore: number;
  /** Commercial: true if this building received freight goods. */
  freightSupplied?: boolean;
  /** Industrial: surplus ratio (0 = balanced, 1 = storage full). */
  freightSurplusRatio?: number;
}

export interface AbandonmentFactors {
  tax: number;
  power: number;
  water: number;
  crime: number;
  pollution: number;
  freight: number;
  serviceOffset: number;
}

export interface AbandonmentResult {
  totalDelta: number;
  factors: AbandonmentFactors;
}

/** Stress thresholds */
export const ABANDONMENT = {
  STRESS_ABANDON: 100,
  RECOVERY_RATE: 2,
  /** Service score multiplier for stress offset. score × this = stress reduction per tick. */
  SERVICE_OFFSET_MULTIPLIER: 1.5,
} as const;

/** Zone sensitivity multipliers: [tax, pollution, crime] */
const ZONE_SENSITIVITY: Record<string, { tax: number; pollution: number; crime: number }> = {
  residential: { tax: 0.7, pollution: 1.2, crime: 1.2 },
  commercial: { tax: 1.5, pollution: 1.0, crime: 1.3 },
  industrial: { tax: 1.0, pollution: 0, crime: 0.5 },
  office: { tax: 1.3, pollution: 1.2, crime: 1.0 },
};

/**
 * Building level makes tax sensitivity higher.
 * Level 1: 1.0x, Level 2: 1.3x, Level 3: 1.6x
 */
const LEVEL_TAX_SENSITIVITY: Record<number, number> = { 1: 1.0, 2: 1.3, 3: 1.6 };

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
  const levelSens = LEVEL_TAX_SENSITIVITY[conditions.buildingLevel] ?? 1.0;

  const factors: AbandonmentFactors = { tax: 0, power: 0, water: 0, crime: 0, pollution: 0, freight: 0, serviceOffset: 0 };

  // Tax pressure (higher level → lower threshold, higher sensitivity)
  if (isResidentialZone(zoneType)) {
    if (conditions.residentialTaxRate > 12) {
      factors.tax = (conditions.residentialTaxRate - 12) * 1.0 * sens.tax * levelSens;
    }
  } else {
    if (conditions.businessTaxRate > 9) {
      factors.tax = (conditions.businessTaxRate - 9) * 1.5 * sens.tax * levelSens;
    }
  }

  // Power
  if (!conditions.isPowered) factors.power = 8;

  // Water
  if (!conditions.isWatered) factors.water = 6;

  // Crime (per-cell, already adjusted by police coverage)
  if (conditions.crimeRate > 30) {
    factors.crime = (conditions.crimeRate - 30) * 0.15 * sens.crime;
  }

  // Pollution (per-cell, industrial is immune)
  if (conditions.pollution > 40) {
    factors.pollution = (conditions.pollution - 40) * 0.1 * sens.pollution;
  }

  // Freight: commercial without goods, industrial with surplus
  if (isCommercialZone(zoneType) && conditions.freightSupplied === false) {
    factors.freight = 6;
  }
  if (zoneType === ZoneType.INDUSTRIAL && (conditions.freightSurplusRatio ?? 0) > 0) {
    factors.freight = (conditions.freightSurplusRatio!) * 6;
  }

  // Service offset: good services reduce stress (distance-based, 0~10 score)
  factors.serviceOffset = conditions.serviceScore * ABANDONMENT.SERVICE_OFFSET_MULTIPLIER;

  const pressure = factors.tax + factors.power + factors.water + factors.crime + factors.pollution + factors.freight;
  const net = pressure - factors.serviceOffset;

  // net > 0: stress increases; net ≤ 0: stress recovers
  const totalDelta = net > 0 ? net : -ABANDONMENT.RECOVERY_RATE;

  return { totalDelta, factors };
}
