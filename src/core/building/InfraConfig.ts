export type InfraType =
  | 'park' | 'police' | 'fire' | 'school' | 'power' | 'water'
  | 'garbage' | 'sewage' | 'cemetery' | 'hospital' | 'school_high'
  | 'school_univ' | 'bus_stop' | 'metro_station' | 'train_station'
  | 'ferry_dock' | 'airport_s' | 'airport_m' | 'airport_l';

export type Rotation = 0 | 90 | 180 | 270;

export interface InfraConfig {
  type: InfraType;
  buildingId: number;
  name: string;
  width: number;
  height: number;
  cost: number;
  /**
   * Chebyshev distance within which a road must exist for placement and for the
   * facility to count as "connected" in coverage services. Civic services
   * (police/fire/hospital/schools/cemetery) use 2 so they can sit one tile back
   * from a road; utilities and transit use 1 (strictly adjacent).
   * Defaults to 1 when omitted.
   */
  roadReach?: 1 | 2;
}

export const INFRA_CONFIGS: readonly InfraConfig[] = [
  { type: 'park',        buildingId: 248, name: 'Park',               width: 1, height: 1, cost: 200 },
  { type: 'police',      buildingId: 252, name: 'Police Station',     width: 2, height: 2, cost: 800,  roadReach: 2 },
  { type: 'fire',        buildingId: 251, name: 'Fire Station',       width: 2, height: 2, cost: 800,  roadReach: 2 },
  { type: 'school',      buildingId: 249, name: 'Elementary School',  width: 2, height: 2, cost: 800,  roadReach: 2 },
  { type: 'power',       buildingId: 254, name: 'Power Plant',        width: 2, height: 2, cost: 1000 },
  { type: 'water',       buildingId: 253, name: 'Water Plant',        width: 2, height: 2, cost: 600 },
  { type: 'garbage',     buildingId: 247, name: 'Landfill',           width: 2, height: 2, cost: 800 },
  { type: 'sewage',      buildingId: 246, name: 'Sewage Plant',       width: 2, height: 2, cost: 800 },
  { type: 'cemetery',    buildingId: 245, name: 'Cemetery',           width: 2, height: 2, cost: 600,  roadReach: 2 },
  { type: 'hospital',    buildingId: 250, name: 'Hospital',           width: 2, height: 3, cost: 1600, roadReach: 2 },
  { type: 'school_high', buildingId: 244, name: 'High School',        width: 2, height: 3, cost: 1200, roadReach: 2 },
  { type: 'school_univ', buildingId: 243, name: 'University',         width: 3, height: 3, cost: 3000, roadReach: 2 },
  { type: 'airport_s',   buildingId: 237, name: 'Airport (S)',         width: 5, height: 4, cost: 5000 },
  { type: 'airport_m',   buildingId: 236, name: 'Airport (M)',         width: 7, height: 4, cost: 15000 },
  { type: 'airport_l',   buildingId: 235, name: 'Airport (L)',         width: 9, height: 6, cost: 40000 },
  { type: 'bus_stop',    buildingId: 242, name: 'Bus Stop',           width: 1, height: 1, cost: 100 },
  { type: 'metro_station', buildingId: 241, name: 'Metro Station',   width: 1, height: 1, cost: 3000 },
  { type: 'train_station', buildingId: 239, name: 'Train Station',   width: 1, height: 1, cost: 2000 },
  { type: 'ferry_dock',  buildingId: 238, name: 'Ferry Dock',        width: 1, height: 1, cost: 1500 },
];

/** Default road reach when a config doesn't specify one. */
export const DEFAULT_INFRA_ROAD_REACH = 1;

const byType = new Map<InfraType, InfraConfig>();
const byId = new Map<number, InfraConfig>();
const infraBuildingIds = new Set<number>();
for (const cfg of INFRA_CONFIGS) {
  byType.set(cfg.type, cfg);
  byId.set(cfg.buildingId, cfg);
  infraBuildingIds.add(cfg.buildingId);
}

/** Look up the Chebyshev road reach for a given infra type. */
export function getInfraRoadReach(type: InfraType): 1 | 2 {
  return byType.get(type)?.roadReach ?? DEFAULT_INFRA_ROAD_REACH;
}

/** Look up the Chebyshev road reach by buildingId (returns default if unknown). */
export function getInfraRoadReachById(buildingId: number): 1 | 2 {
  return byId.get(buildingId)?.roadReach ?? DEFAULT_INFRA_ROAD_REACH;
}

/** Returns true if the buildingId belongs to an infrastructure building (not a zone building). */
export function isInfrastructureBuilding(buildingId: number): boolean {
  return infraBuildingIds.has(buildingId);
}

/** Returns true if the buildingId belongs to a zone building (residential/commercial/industrial/office). */
export function isZoneBuilding(buildingId: number): boolean {
  return buildingId > 0 && !infraBuildingIds.has(buildingId);
}

export function getInfraConfig(type: InfraType): InfraConfig | undefined {
  return byType.get(type);
}

export function getInfraConfigById(buildingId: number): InfraConfig | undefined {
  return byId.get(buildingId);
}

/** Look up infrastructure buildingId by type name. */
export function getInfraBuildingId(type: InfraType): number {
  return byType.get(type)!.buildingId;
}

/** Check if a string is a valid InfraType. */
export function isInfraType(type: string): type is InfraType {
  return byType.has(type as InfraType);
}

export function getRotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  if (rotation === 90 || rotation === 270) {
    return { w: h, h: w };
  }
  return { w, h };
}
