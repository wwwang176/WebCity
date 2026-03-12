/**
 * Pure-function traffic statistics aggregation (SRP).
 * Extracted from Game.ts — Game should not be responsible for aggregating traffic data.
 */

/** Pre-computed traffic data needed for stats (DIP). */
export interface TrafficStatsContext {
  vehicleCount: number;
  topCongested: { segment: string; density: number }[];
  avgPathLength: number;
  roadTileCount: number;
}

export interface TrafficStatsResult {
  vehicleCount: number;
  topCongested: { segment: string; density: number }[];
  avgPathLength: number;
  totalRoads: number;
}

/** Compute traffic statistics from pre-aggregated context. Pure function. */
export function getTrafficStats(ctx: TrafficStatsContext): TrafficStatsResult {
  return {
    vehicleCount: ctx.vehicleCount,
    topCongested: ctx.topCongested,
    avgPathLength: Math.round(ctx.avgPathLength * 10) / 10,
    totalRoads: ctx.roadTileCount,
  };
}
