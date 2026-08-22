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
 * 全城的犯罪率,還沒夾值。
 *
 * `calculateCrimeRate` 只回「人口 vs 警力」那一半;全城條例（監視器網路、賭場⋯）
 * 加在這裡。
 *
 * 夾值刻意留給 `effectiveCityCrime` 做,而且只做一次 —— 先夾這一半的話,
 * 基礎 1 加上監視器網路的 −100 會先變成 0,賭場的 +120 再加上去就是 120;
 * 全部加完再夾是 21。同一格在地價那條線看到 21、在棄置那條線看到 120,
 * 兩套系統對同一件事會有兩個答案。
 */
export function rawCityCrime(
  population: number, stationCount: number, ordinanceBonus: number,
): number {
  return calculateCrimeRate(population, stationCount) + ordinanceBonus;
}

/**
 * 全城的有效犯罪率 —— 幸福度、移民吸引力、棄置壓力看的都是這個數字。
 *
 * ## 為什麼這一支要存在
 *
 * `calculateCrimeRate` 只是其中一半。少了條例那一半、或少了警力那一半,算出來的
 * 就不是模擬正在用的數字 —— Summary 面板曾經自己寫了一條
 * `Math.min(50, population * 0.02)`,那正好是**一座警局都沒有**的基礎值,
 * 於是面板扣的分數永遠比模擬扣的多（BUG-358）。
 *
 * 夾在 0 以上:負的犯罪率在下游會變成加分（`calculateLandValue` 是
 * `value -= crimeRate * CRIME_PENALTY`）,疊越多層賺越多。
 */
export function effectiveCityCrime(
  population: number, stationCount: number, ordinanceBonus: number,
): number {
  return Math.max(0, rawCityCrime(population, stationCount, ordinanceBonus));
}
