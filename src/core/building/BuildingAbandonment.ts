import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { DEFAULT_TAX_RATE } from '../economy/Tax';

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
  /** Commercial: supply ratio (0 = no goods, 1 = fully supplied). */
  freightRatio?: number;
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

/** Stress thresholds and pressure constants */
export const ABANDONMENT = {
  STRESS_ABANDON: 100,
  RECOVERY_RATE: 2,
  /** Service score multiplier for stress offset. score × this = stress reduction per tick. */
  SERVICE_OFFSET_MULTIPLIER: 1.5,
  /** Residential tax threshold — no stress at or below this rate */
  RESIDENTIAL_TAX_STRESS_THRESHOLD: 12,
  /** Residential tax pressure multiplier per point above threshold */
  RESIDENTIAL_TAX_PRESSURE_MULTIPLIER: 1.0,
  /** Business tax threshold — no stress at or below this rate */
  BUSINESS_TAX_STRESS_THRESHOLD: DEFAULT_TAX_RATE,
  /** Business tax pressure multiplier per point above threshold */
  BUSINESS_TAX_PRESSURE_MULTIPLIER: 1.5,
  /** Stress from no power */
  NO_POWER_STRESS: 8,
  /** Stress from no water */
  NO_WATER_STRESS: 6,
  /** Crime rate threshold — no stress at or below this */
  CRIME_STRESS_THRESHOLD: 30,
  /** Crime stress multiplier per point above threshold */
  CRIME_STRESS_MULTIPLIER: 0.15,
  /** Pollution threshold — no stress at or below this */
  POLLUTION_STRESS_THRESHOLD: 40,
  /** Pollution stress multiplier per point above threshold */
  POLLUTION_STRESS_MULTIPLIER: 0.1,
  /** Max freight stress for commercial (no goods) or industrial (surplus) */
  FREIGHT_STRESS_MAX: 6,
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
    if (conditions.residentialTaxRate > ABANDONMENT.RESIDENTIAL_TAX_STRESS_THRESHOLD) {
      factors.tax = (conditions.residentialTaxRate - ABANDONMENT.RESIDENTIAL_TAX_STRESS_THRESHOLD) * ABANDONMENT.RESIDENTIAL_TAX_PRESSURE_MULTIPLIER * sens.tax * levelSens;
    }
  } else {
    if (conditions.businessTaxRate > ABANDONMENT.BUSINESS_TAX_STRESS_THRESHOLD) {
      factors.tax = (conditions.businessTaxRate - ABANDONMENT.BUSINESS_TAX_STRESS_THRESHOLD) * ABANDONMENT.BUSINESS_TAX_PRESSURE_MULTIPLIER * sens.tax * levelSens;
    }
  }

  // Power
  if (!conditions.isPowered) factors.power = ABANDONMENT.NO_POWER_STRESS;

  // Water
  if (!conditions.isWatered) factors.water = ABANDONMENT.NO_WATER_STRESS;

  // Crime (per-cell, already adjusted by police coverage)
  if (conditions.crimeRate > ABANDONMENT.CRIME_STRESS_THRESHOLD) {
    factors.crime = (conditions.crimeRate - ABANDONMENT.CRIME_STRESS_THRESHOLD) * ABANDONMENT.CRIME_STRESS_MULTIPLIER * sens.crime;
  }

  // Pollution (per-cell, industrial is immune)
  if (conditions.pollution > ABANDONMENT.POLLUTION_STRESS_THRESHOLD) {
    factors.pollution = (conditions.pollution - ABANDONMENT.POLLUTION_STRESS_THRESHOLD) * ABANDONMENT.POLLUTION_STRESS_MULTIPLIER * sens.pollution;
  }

  // Freight: commercial with insufficient goods, industrial with surplus
  if (isCommercialZone(zoneType) && conditions.freightRatio != null && conditions.freightRatio < 1) {
    factors.freight = (1 - conditions.freightRatio) * ABANDONMENT.FREIGHT_STRESS_MAX;
  }
  if (zoneType === ZoneType.INDUSTRIAL && (conditions.freightSurplusRatio ?? 0) > 0) {
    factors.freight = (conditions.freightSurplusRatio!) * ABANDONMENT.FREIGHT_STRESS_MAX;
  }

  // Service offset: good services reduce stress (distance-based, 0~10 score)
  factors.serviceOffset = conditions.serviceScore * ABANDONMENT.SERVICE_OFFSET_MULTIPLIER;

  const pressure = factors.tax + factors.power + factors.water + factors.crime + factors.pollution + factors.freight;
  const net = pressure - factors.serviceOffset;

  // net > 0: stress increases; net ≤ 0: stress recovers
  const totalDelta = net > 0 ? net : -ABANDONMENT.RECOVERY_RATE;

  return { totalDelta, factors };
}
