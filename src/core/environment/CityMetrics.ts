import { isResidentialZone, type CellData } from '../grid/types';
import { SIMULATION } from '../simulation/SimulationConstants';
import type { Grid } from '../grid/Grid';
import { isActiveZoneCell } from '../building/BuildingQueries';

/**
 * Compute the average of a numeric cell property across residential cells (DRY).
 * Used by getAvgResidentialPollution.
 */
export function avgResidentialMetric(grid: Grid, accessor: (cell: CellData) => number): number {
  let total = 0;
  let count = 0;
  grid.forEachCell((cell) => {
    // Built cells only. noiseLevel is written exclusively by updateLandValue,
    // which returns early on `buildingId === 0`, so an empty zoned cell reports
    // a permanent 0 (or a stale value from a demolished building). Including
    // them diluted the average by the fraction of the district not yet built:
    // paint a large residential zone and getAvgNoise returns roughly 0.3x the
    // real figure while it fills in, so the NOISE_MODIFIERS threshold of 50
    // essentially never trips and highway-side noise stops mattering (BUG-092).
    //
    // isActiveZoneCell rather than `buildingId > 0`: a ruin houses nobody, so
    // it should not weight an average that feeds citizen happiness.
    //
    // (Not, as an earlier version of this comment claimed, because their
    // readings are stale — updateLandValue returns early only on
    // `buildingId === 0`, so a burnt house is refreshed exactly like a live
    // one.)
    if (isActiveZoneCell(cell) && isResidentialZone(cell.zoneType)) {
      total += accessor(cell);
      count++;
    }
  });
  return count > 0 ? total / count : 0;
}

/**
 * Average of a per-position value across BUILT residential cells.
 * Same selection as avgResidentialMetric, but reads from a lookup rather than
 * the grid cache — used where the cached field conflates several quantities.
 */
export function avgResidentialAt(grid: Grid, valueAt: (x: number, y: number) => number): number {
  let total = 0;
  let count = 0;
  grid.forEachCell((cell, x, y) => {
    if (isActiveZoneCell(cell) && isResidentialZone(cell.zoneType)) {
      total += valueAt(x, y);
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
 * Calculate city-wide crime rate based on population and police presence.
 * Crime scales with population, reduced by police station coverage.
 */
export function calculateCrimeRate(population: number, stationCount: number): number {
  const baseCrime = Math.min(SIMULATION.CRIME_BASE_MAX, population * SIMULATION.CRIME_POP_FACTOR);
  if (stationCount === 0) return baseCrime;
  const coverageRatio = Math.min(1, stationCount * SIMULATION.CRIME_COVERAGE_PER_STATION);
  return baseCrime * (1 - coverageRatio * SIMULATION.CRIME_MAX_REDUCTION);
}
