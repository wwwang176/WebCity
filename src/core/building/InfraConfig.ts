export type InfraType =
  | 'park' | 'police' | 'fire' | 'school' | 'power' | 'water'
  | 'garbage' | 'sewage' | 'cemetery' | 'hospital' | 'school_high'
  | 'school_univ' | 'airport';

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
];

const byType = new Map<InfraType, InfraConfig>();
const byId = new Map<number, InfraConfig>();
for (const cfg of INFRA_CONFIGS) {
  byType.set(cfg.type, cfg);
  byId.set(cfg.buildingId, cfg);
}

export function getInfraConfig(type: InfraType): InfraConfig | undefined {
  return byType.get(type);
}

export function getInfraConfigById(buildingId: number): InfraConfig | undefined {
  return byId.get(buildingId);
}

export function getRotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  if (rotation === 90 || rotation === 270) {
    return { w: h, h: w };
  }
  return { w, h };
}
