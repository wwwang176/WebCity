import type { PollutionSource } from './Pollution';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';

/** Grid-based pollution emission constants (OCP-friendly). */
export const GRID_POLLUTION = {
  INDUSTRIAL_GROUND: 60,
  INDUSTRIAL_GROUND_RADIUS: 4,
  INDUSTRIAL_NOISE: 40,
  INDUSTRIAL_NOISE_RADIUS: 3,
  TRAFFIC_NOISE_MULTIPLIER: 3,
  TRAFFIC_NOISE_RADIUS: 2,
  /** Speed factor per road type — faster roads are noisier. */
  ROAD_SPEED_FACTOR: {
    [RoadType.NONE]: 0,
    [RoadType.RURAL]: 0.8,
    [RoadType.TWO_LANE]: 1.0,
    [RoadType.FOUR_LANE]: 1.5,
    [RoadType.SIX_LANE]: 1.8,
    [RoadType.HIGHWAY]: 2.0,
    [RoadType.ONE_WAY]: 1.2,
  } as Record<number, number>,
} as const;

interface GridLike {
  forEachCell(callback: (cell: { buildingId: number; zoneType: number; roadType: number; trafficDensity: number }, x: number, y: number) => void): void;
}

/** Collect pollution sources from grid cells (industrial buildings + road traffic noise). */
export function getGridPollutionSources(grid: GridLike): PollutionSource[] {
  const sources: PollutionSource[] = [];
  forEachGridPollutionSource(grid, (src) => {
    sources.push(src);
  });
  return sources;
}

/** Visit grid pollution sources without allocating an intermediate array. */
export function forEachGridPollutionSource(
  grid: GridLike,
  emit: (source: PollutionSource) => void,
): void {
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
      emit({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_GROUND, type: 'ground', radius: GRID_POLLUTION.INDUSTRIAL_GROUND_RADIUS });
      emit({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_NOISE, type: 'noise', radius: GRID_POLLUTION.INDUSTRIAL_NOISE_RADIUS });
    }
    if (cell.roadType !== RoadType.NONE && cell.trafficDensity > 0) {
      const speedFactor = GRID_POLLUTION.ROAD_SPEED_FACTOR[cell.roadType] ?? 1;
      const amount = Math.round(cell.trafficDensity * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER * speedFactor);
      if (amount > 0) {
        emit({ x, y, amount, type: 'noise', radius: GRID_POLLUTION.TRAFFIC_NOISE_RADIUS });
      }
    }
  });
}
