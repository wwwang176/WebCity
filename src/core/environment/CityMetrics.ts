import { isResidentialZone } from '../grid/types';
import { SIMULATION } from '../simulation/SimulationLoop';
import type { Grid } from '../grid/Grid';

/**
 * Average pollution over residential cells only.
 * Industrial pollution far away shouldn't drag down citizen happiness unfairly.
 */
export function getAvgResidentialPollution(grid: Grid): number {
  let total = 0;
  let count = 0;
  grid.forEachCell((cell) => {
    if (isResidentialZone(cell.zoneType)) {
      total += cell.pollution;
      count++;
    }
  });
  return count > 0 ? total / count : 0;
}

/**
 * Average noise over residential cells only (same rationale as pollution).
 */
export function getAvgResidentialNoise(grid: Grid): number {
  let total = 0;
  let count = 0;
  grid.forEachCell((cell) => {
    if (isResidentialZone(cell.zoneType)) {
      total += cell.noiseLevel;
      count++;
    }
  });
  return count > 0 ? total / count : 0;
}

/**
 * Calculate city-wide crime rate based on population and police presence.
 * Crime scales with population, reduced by police station coverage.
 */
export function calculateCrimeRate(population: number, stationCount: number): number {
  const baseCrime = Math.min(SIMULATION.CRIME_BASE_MAX, population * SIMULATION.CRIME_POP_FACTOR);
  if (stationCount === 0) return baseCrime;
  const coverageRatio = Math.min(1, stationCount * SIMULATION.CRIME_COVERAGE_PER_STATION);
  return baseCrime * (1 - coverageRatio * SIMULATION.CRIME_MAX_REDUCTION);
}
