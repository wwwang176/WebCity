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


/**
 * The citywide crime rate, before clamping.
 *
 * `calculateCrimeRate` returns only the population-versus-police half; citywide ordinances
 * (surveillance network, casinos and the rest) are added here.
 *
 * Clamping is deliberately left to `effectiveCityCrime`, and happens exactly once. Clamping
 * this half first turns a base of 1 plus the surveillance network's -100 into 0, so a casino's
 * +120 on top reads 120, where clamping after everything gives 21. The same cell would then
 * read 21 on the land-value path and 120 on the abandonment path: two answers to one question.
 */
export function rawCityCrime(
  population: number, stationCount: number, ordinanceBonus: number,
): number {
  return calculateCrimeRate(population, stationCount) + ordinanceBonus;
}

/**
 * The effective citywide crime rate: happiness, migration appeal and abandonment pressure all
 * read this number.
 *
 * ## Why this function exists
 *
 * `calculateCrimeRate` is only half of it. Without the ordinance half, or without the police
 * half, the result is not the number the simulation uses. A local
 * `Math.min(50, population * 0.02)` in the Summary panel is exactly the base value with **no
 * police station at all**, so the panel's penalty stays permanently larger than the
 * simulation's (BUG-358).
 *
 * Clamped at 0: a negative crime rate becomes a bonus downstream (`calculateLandValue` does
 * `value -= crimeRate * CRIME_PENALTY`), paying more the more layers are stacked.
 */
export function effectiveCityCrime(
  population: number, stationCount: number, ordinanceBonus: number,
): number {
  return Math.max(0, rawCityCrime(population, stationCount, ordinanceBonus));
}
