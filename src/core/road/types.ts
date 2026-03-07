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

export interface BuildRoadResult {
  success: boolean;
  reason?: string;
  cost?: number;
}

export interface Position {
  x: number;
  y: number;
}
