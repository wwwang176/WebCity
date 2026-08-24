/**
 * Road costs — the **single** source shared by the main thread and the worker.
 *
 * This module is deliberately a leaf, importing only `./types`, so
 * `workplace-distance.worker.ts` can use it directly without pulling the whole service layer into
 * the worker bundle. The worker previously held a hand-copied `roadTileCost`, which drifts as
 * soon as either side is edited.
 *
 * ## Why costs are integers
 *
 * A cell's cost is `BASE_COST / (speedLimit x lanes/2)`. The denominators are 30, 50, 100, 180
 * and 200, whose least common multiple is 1800, so a numerator of 1800 puts all six road types'
 * costs on integers from 9 to 60.
 *
 * This is more than tidiness. Floating-point addition is **not associative**:
 *
 *   10/3 + 10/3 + 10/3 + 2 + 2 === 14
 *   2 + 2 + 10/3 + 10/3 + 10/3 === 14.000000000000002
 *
 * The reverse Dijkstra spreading from a workplace and the forward one spreading from a home walk
 * the same edges in opposite orders, so floating-point costs make bit-identical answers
 * **impossible** — Float64 included, because this is not about precision. Integer addition
 * commutes fully and the two directions necessarily agree.
 *
 * The change to integers is a pure change of units: every budget and threshold was multiplied by
 * 18 with it, so coverage radius, commute scoring and fire response times are all unchanged. See
 * `__tests__/RoadCostInteger.test.ts`.
 */

import { ROAD_CONFIGS, RoadType } from './types';

/** Service coverage and travel budgets, in the same units as `roadTileCost`: the old
 *  floating-point scale x18. */
export const ROAD_COVERAGE = {
  /** The numerator of a cell's cost. 1800 = LCM(30, 50, 100, 180, 200), which puts every cell
   *  cost on an integer. */
  BASE_COST: 1800,
  GARBAGE_BUDGET: 1440,
  POLICE_BUDGET: 540,
  FIRE_BUDGET: 540,
  HEALTH_BUDGET: 720,
  DEATHCARE_BUDGET: 630,
  EDUCATION_ELEMENTARY_BUDGET: 360,
  EDUCATION_HIGHSCHOOL_BUDGET: 540,
  EDUCATION_UNIVERSITY_BUDGET: 810,
} as const;

/**
 * One road cell's cost. Faster and wider roads cost less and so reach further.
 *
 * The return value is always a positive integer. Undrivable `NONE` returns `Infinity`, a sentinel
 * that callers filter out before summing.
 */
export function roadTileCost(roadType: number): number {
  const config = ROAD_CONFIGS[roadType as RoadType];
  if (!config || config.speedLimit === 0) return Infinity;
  const laneFactor = config.lanes / 2; // 2-lane = 1×
  return ROAD_COVERAGE.BASE_COST / (config.speedLimit * laneFactor);
}
