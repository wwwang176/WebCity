import type { PollutionSource } from './Pollution';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';

/** Grid-based pollution emission constants (OCP-friendly). */
export const GRID_POLLUTION = {
  INDUSTRIAL_GROUND: 60,
  INDUSTRIAL_NOISE: 40,
  TRAFFIC_NOISE_MULTIPLIER: 10,
} as const;

interface GridLike {
  forEachCell(callback: (cell: { buildingId: number; zoneType: number; roadType: number; trafficDensity: number }, x: number, y: number) => void): void;
}

/** Collect pollution sources from grid cells (industrial buildings + road traffic noise). */
export function getGridPollutionSources(grid: GridLike): PollutionSource[] {
  const sources: PollutionSource[] = [];
  forEachGridPollutionSource(grid, (x, y, amount, type) => {
    sources.push({ x, y, amount, type });
  });
  return sources;
}

/** Visit grid pollution sources without allocating an intermediate array. */
export function forEachGridPollutionSource(
  grid: GridLike,
  emit: (x: number, y: number, amount: number, type: PollutionType) => void,
): void {
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
      emit(x, y, GRID_POLLUTION.INDUSTRIAL_GROUND, 'ground');
      emit(x, y, GRID_POLLUTION.INDUSTRIAL_NOISE, 'noise');
    }
    if (cell.roadType !== RoadType.NONE && cell.trafficDensity > 0) {
      emit(x, y, cell.trafficDensity * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER, 'noise');
    }
  });
}
