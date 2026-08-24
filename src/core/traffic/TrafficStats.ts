/**
 * Pure-function traffic statistics aggregation (SRP).
 * Extracted from Game.ts — Game should not be responsible for aggregating traffic data.
 */

/** Pre-computed traffic data needed for stats (DIP). */
export interface TrafficStatsContext {
  /**
   * How many residents are driving to work, not the total number of vehicles on the road.
   *
   * The road also carries through traffic, freight and service vehicles, none of which reflect
   * a resident's mode choice. The panel uses this card to judge whether a policy moved people
   * onto transit, and mixing the others in hides a real switch to the bus.
   */
  commuteVehicleCount: number;
  topCongested: { segment: string; density: number }[];
  /** Average distance residents drive to work, over the same population as
   *  `commuteVehicleCount`. */
  commuteAvgPathLength: number;
  roadTileCount: number;
}

export interface TrafficStatsResult {
  commuteVehicleCount: number;
  topCongested: { segment: string; density: number }[];
  commuteAvgPathLength: number;
  totalRoads: number;
}

/** Compute traffic statistics from pre-aggregated context. Pure function. */
export function getTrafficStats(ctx: TrafficStatsContext): TrafficStatsResult {
  return {
    commuteVehicleCount: ctx.commuteVehicleCount,
    topCongested: ctx.topCongested,
    commuteAvgPathLength: Math.round(ctx.commuteAvgPathLength * 10) / 10,
    totalRoads: ctx.roadTileCount,
  };
}
