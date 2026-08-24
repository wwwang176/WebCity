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

/**
 * Each road type's asphalt width in cells, where one cell is 12 metres.
 *
 * In core rather than in the renderer: how wide the road is decides where vehicles drive, which
 * is a simulation fact rather than a drawing choice. There were two identical copies, in
 * `SidewalkGraph` and `RoadStripBuilder`, and core's own copy existed only to avoid a reverse
 * import.
 */
export const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};

/**
 * A lane's width in cells: the half road width for that direction, divided among its lanes.
 *
 * **Derived rather than a constant.** A fixed 0.18, computed independently of `ROAD_WIDTHS`, put
 * three lanes per direction on a six-lane road at 0.54 against a half road width of 0.475, so
 * part of the outermost lane lay off the asphalt with vehicles driving there: a 0.125-wide truck
 * overhangs the kerb by 45cm.
 *
 * A one-way road divides the half width too. All its lanes run the same way and in principle it
 * could use the full width, but `LaneGraph` lays lanes out from the centre line towards the
 * **right of travel**, so the full width would put the outermost lane off the asphalt. A one-way
 * road therefore uses only the right half of its asphalt, leaving the left half empty; that is an
 * anchoring problem rather than a lane width one, and it is recorded in TODO.md.
 */
export function getLaneWidth(roadType: number): number {
  return (ROAD_WIDTHS[roadType] ?? 0.6) / 2 / getLaneCount(roadType);
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
