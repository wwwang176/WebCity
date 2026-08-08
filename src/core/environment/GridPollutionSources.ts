import type { PollutionSource } from './Pollution';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import { isActiveZoneCell } from '../building/BuildingQueries';

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
  forEachCell(callback: (cell: { buildingId: number; zoneType: number; roadType: number; trafficDensity: number; reserved?: number }, x: number, y: number) => void): void;
}

/** Visit grid pollution sources (industrial buildings + road traffic noise) without allocating an intermediate array. */
export function forEachGridPollutionSource(
  grid: GridLike,
  emit: (source: PollutionSource) => void,
  /**
   * Road tier of the highest elevated segment at (x, y), or NONE.
   *
   * syncTrafficDensityToGrid deliberately projects elevated flow down onto the
   * ground cell's trafficDensity "for noise pollution calculation" — and this is
   * its only consumer — but the guard below tested the GROUND roadType. Wherever
   * a viaduct crossed undeveloped land or water, the ground tier was NONE and
   * every bit of that projected noise was dropped, so an elevated motorway was
   * silently pollution-free and the land under it kept an inflated land value
   * (BUG-099). Widening the guard to `trafficDensity > 0` alone is not enough:
   * ROAD_SPEED_FACTOR[NONE] is 0, so the amount would come out 0 anyway.
   */
  getElevatedRoadType?: (x: number, y: number) => number,
): void {
  grid.forEachCell((cell, x, y) => {
    // isActiveZoneCell, not `buildingId > 0`: a factory that has burned down
    // has no production and no machinery, but it kept emitting the full 60
    // ground pollution and 40 noise forever — nothing clears cell.pollution, so
    // one fire permanently poisoned the land value around it, and the
    // developer's own 2%-per-tick cleanup of BURNED cells could not undo it.
    // The predicate also excludes infrastructure footprints, which is what an
    // old save restored before BUG-074 still looks like.
    if (isActiveZoneCell(cell) && cell.zoneType === ZoneType.INDUSTRIAL) {
      emit({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_GROUND, type: 'ground', radius: GRID_POLLUTION.INDUSTRIAL_GROUND_RADIUS });
      emit({ x, y, amount: GRID_POLLUTION.INDUSTRIAL_NOISE, type: 'noise', radius: GRID_POLLUTION.INDUSTRIAL_NOISE_RADIUS });
    }
    if (cell.trafficDensity > 0) {
      const roadType = cell.roadType !== RoadType.NONE
        ? cell.roadType
        : (getElevatedRoadType?.(x, y) ?? RoadType.NONE);
      if (roadType === RoadType.NONE) return;
      const speedFactor = GRID_POLLUTION.ROAD_SPEED_FACTOR[roadType] ?? 1;
      const amount = Math.round(cell.trafficDensity * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER * speedFactor);
      if (amount > 0) {
        emit({ x, y, amount, type: 'noise', radius: GRID_POLLUTION.TRAFFIC_NOISE_RADIUS });
      }
    }
  });
}
