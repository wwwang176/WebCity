export interface RCIState {
  residentialSupply: number;
  commercialSupply: number;
  industrialSupply: number;
  population: number;
  jobOpenings: number;
  exportDemand: number;
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
} as const;

function clampDemand(value: number): number {
  return Math.min(RCI.DEMAND_MAX, Math.max(RCI.DEMAND_MIN, value));
}

export function calculateRCIDemand(state: RCIState): RCIDemandValues {
  const rDemand = clampDemand(
    (state.jobOpenings * RCI.JOB_MULTIPLIER + RCI.RESIDENTIAL_BASE) - state.residentialSupply
  );
  const cDemand = clampDemand(
    (state.population * RCI.POPULATION_FACTOR + RCI.COMMERCIAL_BASE) - state.commercialSupply
  );
  const iDemand = clampDemand(
    (state.commercialSupply * RCI.COMMERCIAL_TO_INDUSTRIAL + state.exportDemand + RCI.INDUSTRIAL_BASE) - state.industrialSupply
  );

  return { residential: rDemand, commercial: cDemand, industrial: iDemand };
}
