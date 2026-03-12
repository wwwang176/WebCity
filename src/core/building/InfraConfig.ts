export type InfraType =
  | 'park' | 'police' | 'fire' | 'school' | 'power' | 'water'
  | 'garbage' | 'sewage' | 'cemetery' | 'hospital' | 'school_high'
  | 'school_univ' | 'bus_stop' | 'metro_station' | 'train_station'
  | 'ferry_dock' | 'airport';

export type Rotation = 0 | 90 | 180 | 270;

export interface InfraConfig {
  type: InfraType;
  buildingId: number;
  name: string;
  width: number;
  height: number;
  cost: number;
}

export const INFRA_CONFIGS: readonly InfraConfig[] = [
  { type: 'park',        buildingId: 248, name: 'Park',               width: 1, height: 1, cost: 200 },
  { type: 'police',      buildingId: 252, name: 'Police Station',     width: 2, height: 2, cost: 800 },
  { type: 'fire',        buildingId: 251, name: 'Fire Station',       width: 2, height: 2, cost: 800 },
  { type: 'school',      buildingId: 249, name: 'Elementary School',  width: 2, height: 2, cost: 800 },
  { type: 'power',       buildingId: 254, name: 'Power Plant',        width: 2, height: 2, cost: 1000 },
  { type: 'water',       buildingId: 253, name: 'Water Plant',        width: 2, height: 2, cost: 600 },
  { type: 'garbage',     buildingId: 247, name: 'Landfill',           width: 2, height: 2, cost: 800 },
  { type: 'sewage',      buildingId: 246, name: 'Sewage Plant',       width: 2, height: 2, cost: 800 },
  { type: 'cemetery',    buildingId: 245, name: 'Cemetery',           width: 2, height: 2, cost: 600 },
  { type: 'hospital',    buildingId: 250, name: 'Hospital',           width: 2, height: 3, cost: 1600 },
  { type: 'school_high', buildingId: 244, name: 'High School',        width: 2, height: 3, cost: 1200 },
  { type: 'school_univ', buildingId: 243, name: 'University',         width: 3, height: 3, cost: 3000 },
  { type: 'airport',     buildingId: 237, name: 'Airport',            width: 4, height: 4, cost: 5000 },
  { type: 'bus_stop',    buildingId: 242, name: 'Bus Stop',           width: 1, height: 1, cost: 100 },
  { type: 'metro_station', buildingId: 241, name: 'Metro Station',   width: 1, height: 1, cost: 3000 },
  { type: 'train_station', buildingId: 239, name: 'Train Station',   width: 1, height: 1, cost: 2000 },
  { type: 'ferry_dock',  buildingId: 238, name: 'Ferry Dock',        width: 1, height: 1, cost: 1500 },
];

const byType = new Map<InfraType, InfraConfig>();
const byId = new Map<number, InfraConfig>();
const infraBuildingIds = new Set<number>();
for (const cfg of INFRA_CONFIGS) {
  byType.set(cfg.type, cfg);
  byId.set(cfg.buildingId, cfg);
  infraBuildingIds.add(cfg.buildingId);
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
