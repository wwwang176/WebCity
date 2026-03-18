import { isResidentialZone, type CellData } from '../grid/types';
import { SIMULATION } from '../simulation/SimulationLoop';
import type { Grid } from '../grid/Grid';

/**
 * Compute the average of a numeric cell property across residential cells (DRY).
 * Used by getAvgResidentialPollution and getAvgResidentialNoise.
 */
export function avgResidentialMetric(grid: Grid, accessor: (cell: CellData) => number): number {
  let total = 0;
  let count = 0;
  grid.forEachCell((cell) => {
    if (isResidentialZone(cell.zoneType)) {
      total += accessor(cell);
      count++;
    }
  });
  return count > 0 ? total / count : 0;
}

/**
 * Average pollution over residential cells only.
 * Industrial pollution far away shouldn't drag down citizen happiness unfairly.
 */
export function getAvgResidentialPollution(grid: Grid): number {
  return avgResidentialMetric(grid, cell => cell.pollution);
}

/**
 * Average noise over residential cells only (same rationale as pollution).
 */
export function getAvgResidentialNoise(grid: Grid): number {
  return avgResidentialMetric(grid, cell => cell.noiseLevel);
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
