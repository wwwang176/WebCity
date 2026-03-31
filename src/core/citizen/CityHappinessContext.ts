import { SIMULATION } from '../simulation/SimulationConstants';
import type { ServiceRatios } from '../service/ServiceCoverageQuery';

/** City-wide factors that affect all citizens' happiness. */
export interface CityHappinessContext {
  employmentRate: number;
  avgPollution: number;
  avgNoise: number;
  avgCrime: number;
  avgCommute: number;
  serviceCoverage: number;
}

export interface CityHappinessInput {
  totalJobs: number;
  adultCount: number;
  avgPollution: number;
  avgNoise: number;
  avgCrime: number;
  residentialBuildingCount: number;
  serviceRatios: ServiceRatios;
}

/** Calculate city-wide happiness context from raw metrics. Pure function. */
export function calculateCityHappinessContext(input: CityHappinessInput): CityHappinessContext {
  const employmentRate = input.adultCount > 0
    ? Math.min(1, input.totalJobs / input.adultCount)
    : 1;

  return {
    employmentRate,
    avgPollution: input.avgPollution,
    avgNoise: input.avgNoise,
    avgCrime: input.avgCrime,
    avgCommute: calculateAvgCommute(input.residentialBuildingCount),
    serviceCoverage: calculateCityServiceCoverage(input.serviceRatios, input.avgPollution),
  };
}

/** Estimate average commute distance from residential building count. */
export function calculateAvgCommute(residentialBuildingCount: number): number {
  if (residentialBuildingCount <= 0) return 3;
  return Math.min(
    SIMULATION.COMMUTE_MAX,
    SIMULATION.COMMUTE_BASE + Math.sqrt(residentialBuildingCount) * SIMULATION.COMMUTE_SPREAD_FACTOR,
  );
}

/** Calculate weighted city service coverage from ratios. */
export function calculateCityServiceCoverage(ratios: ServiceRatios, avgPollution: number): number {
  return Math.round(
    ratios.poweredRatio * SIMULATION.SERVICE_POWER_WEIGHT +
    ratios.wateredRatio * SIMULATION.SERVICE_WATER_WEIGHT +
    ratios.policeRatio + ratios.fireRatio + ratios.garbageRatio +
    ratios.healthRatio + ratios.educationRatio + ratios.deathCareRatio +
    (avgPollution < SIMULATION.LOW_POLLUTION_THRESHOLD ? 1 : 0),
  );
}
