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
 * 各路型的柏油寬度（格；1 格 = 12 m）。
 *
 * 放在 core 而不是渲染層：路面多寬決定了車開在哪，那是模擬的事實，不是畫法。
 * 原本有兩份一模一樣的拷貝（`SidewalkGraph` 與 `RoadStripBuilder` 各一份），
 * 而 core 的那份還是為了避免反向 import 才複製過去的。
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
 * 一條車道有多寬（格）：把該向的半幅路面平分給它的車道。
 *
 * **算出來而不是一個常數。** 原本是寫死的 0.18，與 `ROAD_WIDTHS` 各算各的
 * —— 六車道每向三條 = 0.54，而路面半寬只有 0.475，最外側那條車道有一部分在
 * 路面外，而車子實際上就開在那裡：一台 0.125 寬的卡車會壓出路緣 45 公分。
 *
 * 單行道也切半幅。它所有車道同向，理論上整幅都能用，但 `LaneGraph` 是從中心線
 * 往**行進方向的右側**排車道的 —— 給它整幅的話，最外側那條會排到路面外。單行道
 * 因此只用到右半邊的柏油，左半邊是空的；那是錨點的問題，不是車道寬的問題，
 * 記在 TODO.md。
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
