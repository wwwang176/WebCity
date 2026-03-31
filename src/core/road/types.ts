export enum RoadType {
  NONE = 0,
  RURAL = 1,
  TWO_LANE = 2,
  FOUR_LANE = 3,
  SIX_LANE = 4,
  HIGHWAY = 5,
  ONE_WAY = 6,
}

export enum RoadDirection {
  NORTH = 0b0001,
  SOUTH = 0b0010,
  WEST = 0b0100,
  EAST = 0b1000,
}

const ALL_ROAD_DIRECTIONS = [
  RoadDirection.NORTH, RoadDirection.SOUTH, RoadDirection.WEST, RoadDirection.EAST,
] as const;

/** Count how many of the 4 direction bitflags are set. */
export function countRoadDirections(flags: number): number {
  let count = 0;
  for (const d of ALL_ROAD_DIRECTIONS) {
    if (flags & d) count++;
  }
  return count;
}

export interface RoadConfig {
  type: RoadType;
  lanes: number;
  speedLimit: number;
  capacity: number;
  cost: number;
  maxDensity: 'LOW' | 'HIGH' | 'NONE';
}

export const ROAD_CONFIGS: Record<RoadType, RoadConfig> = {
  [RoadType.NONE]: { type: RoadType.NONE, lanes: 0, speedLimit: 0, capacity: 0, cost: 0, maxDensity: 'NONE' },
  [RoadType.RURAL]: { type: RoadType.RURAL, lanes: 2, speedLimit: 30, capacity: 50, cost: 100, maxDensity: 'LOW' },
  [RoadType.TWO_LANE]: { type: RoadType.TWO_LANE, lanes: 2, speedLimit: 50, capacity: 100, cost: 200, maxDensity: 'LOW' },
  [RoadType.FOUR_LANE]: { type: RoadType.FOUR_LANE, lanes: 4, speedLimit: 50, capacity: 200, cost: 400, maxDensity: 'HIGH' },
  [RoadType.SIX_LANE]: { type: RoadType.SIX_LANE, lanes: 6, speedLimit: 60, capacity: 300, cost: 600, maxDensity: 'HIGH' },
  [RoadType.HIGHWAY]: { type: RoadType.HIGHWAY, lanes: 4, speedLimit: 100, capacity: 400, cost: 800, maxDensity: 'NONE' },
  [RoadType.ONE_WAY]: { type: RoadType.ONE_WAY, lanes: 2, speedLimit: 50, capacity: 150, cost: 250, maxDensity: 'LOW' },
};

export enum IntersectionType {
  NONE = 0,
  T_JUNCTION = 1,
  CROSS = 2,
}

export enum TrafficControl {
  NONE = 0,
  TRAFFIC_LIGHT = 1,
  ROUNDABOUT = 2,
}

/** Get the number of directional lanes for a road type (lanes going one way). */
export function getLaneCount(roadType: number): number {
  const config = ROAD_CONFIGS[roadType as RoadType];
  if (!config || config.lanes === 0) return 1;
  if (roadType === RoadType.ONE_WAY) return config.lanes;
  return Math.max(1, Math.floor(config.lanes / 2));
}

export interface BuildRoadResult {
  success: boolean;
  reason?: string;
  cost?: number;
  /** Cells affected by this operation (for lane graph / cache invalidation). */
  affectedCells?: string[];
  /** Position keys of zone buildings demolished during this operation. */
  demolishedCells?: string[];
}

// Re-export Position from canonical location (DRY)
export type { Position } from '../grid/types';
