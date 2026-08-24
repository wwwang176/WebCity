/**
 * Congestion, derived from **demand**.
 *
 * The input is the per-cell flow field produced by `computeCongestionFlow`: how many
 * citizens' commute routes pass through each cell, divided by that cell's lane count. It is
 * unrelated to how many vehicles are on screen, since vehicle instances are capped and
 * refused by the spawn check — they are a dramatisation, not the simulation.
 *
 * This module turns flow into a congestion level from 0 (clear) to 1 (gridlocked) and offers
 * two questions:
 * - `routeCongestion`: how congested **this trip's** route is. Use it wherever a route is
 *   available.
 * - `cityCongestion`: the network's average load, as the fallback where no route can be asked.
 */

/**
 * Commute routes per lane cell at which it counts as saturated.
 *
 * **A balance knob, not a physical constant.** Calibrated together with
 * `CONGESTION_EXPONENT` so that the 12,280-citizen reference city (60x60 map, 284 road cells)
 * has a median per-citizen commute congestion around 0.55: clearly burdened but not
 * paralysed, with room left to get worse.
 *
 * It is an **absolute** value rather than a share of population, deliberately: the same road
 * should get more congested as more people live on it. Tied to population, a growing city
 * would never get more congested and that feedback loop would be disconnected.
 */
export const FLOW_PER_LANE_SATURATED = 9000;

/**
 * How steeply congestion rises with flow.
 *
 * One more vehicle on an empty road is imperceptible; one more on a nearly full road stalls
 * the whole queue. Linear (exponent 1) treats the two as equal, so clearing a nearly
 * saturated junction rewards the player about as much as widening a road that already flows.
 *
 * Measured on the reference city by doubling the lanes of the most congested tenth of cells:
 *
 * | | linear | fourth power |
 * |---|---|---|
 * | median commute congestion | 0.553 -> 0.405 | 0.553 -> **0.233** |
 * | driving time | x1.55 -> x1.41 (9% faster) | x1.55 -> **x1.23 (21% faster)** |
 *
 * Both were calibrated to the same starting point, so what differs is the **response**, not
 * the level. A fourth power is also the usual shape in traffic engineering for how link
 * travel time rises with flow.
 */
export const CONGESTION_EXPONENT = 4;

/** How congested one cell is. 0 = empty, 1 = gridlocked. */
export function cellCongestion(flowPerLane: number): number {
  if (!(flowPerLane > 0)) return 0;
  const load = flowPerLane / FLOW_PER_LANE_SATURATED;
  return load >= 1 ? 1 : Math.pow(load, CONGESTION_EXPONENT);
}

/**
 * How congested a trip's route is: the mean over the cells it passes through.
 *
 * A mean rather than the worst cell: a commute stuck at one junction and a commute crawling
 * the whole way are different things, and driving time accumulates along the route. Taking
 * the maximum would make everyone passing through the centre equally badly off.
 *
 * Returns `null` when the route has no cells; the caller decides what to fall back to rather
 * than this pretending to know.
 */
export function routeCongestion(
  cells: Iterable<string>,
  flowOf: (cellKey: string) => number,
): number | null {
  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    sum += cellCongestion(flowOf(cell));
    count++;
  }
  return count === 0 ? null : sum / count;
}

/**
 * The network's average load.
 *
 * The denominator is the **city's road cell count**, not the cells currently carrying
 * traffic: empty roads count too, and that is where building a road shows up as having
 * helped. Counting only cells with traffic makes the denominator grow with the city and pins
 * the number at its ceiling.
 */
export function cityCongestion(
  flowMap: ReadonlyMap<string, number>,
  roadCellCount: number,
): number {
  if (roadCellCount <= 0) return 0;
  let sum = 0;
  for (const flow of flowMap.values()) sum += cellCongestion(flow);
  return Math.min(1, sum / roadCellCount);
}
