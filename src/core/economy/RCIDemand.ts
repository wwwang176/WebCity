export interface RCIState {
  residentialSupply: number;
  commercialSupply: number;
  industrialSupply: number;
  population: number;
  jobOpenings: number;
  exportDemand: number;
  /** Freight shortage ratio (0 = all supplied, 1 = no supply). Reduces commercial demand. */
  freightShortageRatio?: number;
  /** Freight surplus ratio (0 = balanced, 1 = storage full). Reduces industrial demand. */
  freightSurplusRatio?: number;
}

export interface RCIDemandValues {
  residential: number;
  commercial: number;
  industrial: number;
}

export const RCI = {
  /** Each job opening adds this much to residential demand */
  JOB_MULTIPLIER: 2,
  RESIDENTIAL_BASE: 30,
  POPULATION_FACTOR: 0.5,
  COMMERCIAL_BASE: 10,
  COMMERCIAL_TO_INDUSTRIAL: 0.8,
  INDUSTRIAL_BASE: 5,
  DEMAND_MIN: -100,
  DEMAND_MAX: 100,
  /** Max demand penalty from freight shortage on commercial. */
  FREIGHT_SHORTAGE_PENALTY: 10,
  /** Max demand penalty from freight surplus on industrial. */
  FREIGHT_SURPLUS_PENALTY: 10,
} as const;

function clampDemand(value: number): number {
  return Math.min(RCI.DEMAND_MAX, Math.max(RCI.DEMAND_MIN, value));
}

import { DEFAULT_TAX_RATE } from './Tax';

/** Business tax constants for demand penalty. */
export const BUSINESS_TAX = {
  BASELINE: DEFAULT_TAX_RATE,
  PENALTY_PER_POINT: 2,
} as const;

/**
 * Apply business tax penalty to commercial/industrial demand.
 * Taxes above BASELINE reduce C/I demand proportionally.
 */
export function applyBusinessTaxPenalty(
  demand: RCIDemandValues,
  businessTaxRate: number,
): RCIDemandValues {
  if (businessTaxRate <= BUSINESS_TAX.BASELINE) return demand;
  const penalty = (businessTaxRate - BUSINESS_TAX.BASELINE) * BUSINESS_TAX.PENALTY_PER_POINT;
  return {
    residential: demand.residential,
    commercial: Math.max(RCI.DEMAND_MIN, demand.commercial - penalty),
    industrial: Math.max(RCI.DEMAND_MIN, demand.industrial - penalty),
  };
}

export function calculateRCIDemand(state: RCIState): RCIDemandValues {
  const rDemand = clampDemand(
    (state.jobOpenings * RCI.JOB_MULTIPLIER + RCI.RESIDENTIAL_BASE) - state.residentialSupply
  );
  const cDemand = clampDemand(
    (state.population * RCI.POPULATION_FACTOR + RCI.COMMERCIAL_BASE) - state.commercialSupply
    - (state.freightShortageRatio ?? 0) * RCI.FREIGHT_SHORTAGE_PENALTY
  );
  const iDemand = clampDemand(
    (state.commercialSupply * RCI.COMMERCIAL_TO_INDUSTRIAL + state.exportDemand + RCI.INDUSTRIAL_BASE) - state.industrialSupply
    - (state.freightSurplusRatio ?? 0) * RCI.FREIGHT_SURPLUS_PENALTY
  );

  return { residential: rDemand, commercial: cDemand, industrial: iDemand };
}
