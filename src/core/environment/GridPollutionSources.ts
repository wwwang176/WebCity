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
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
      sources.push({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_GROUND, type: 'ground' });
      sources.push({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_NOISE, type: 'noise' });
    }
    if (cell.roadType !== RoadType.NONE && cell.trafficDensity > 0) {
      sources.push({ x, y, amount: cell.trafficDensity * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER, type: 'noise' });
    }
  });
  return sources;
}
