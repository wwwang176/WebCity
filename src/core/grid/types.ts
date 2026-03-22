export enum TerrainType {
  PLAIN = 0,
  WATER = 1,
  MOUNTAIN = 2,
  FOREST = 3,
}

export enum ZoneType {
  NONE = 0,
  RESIDENTIAL_LOW = 1,
  RESIDENTIAL_HIGH = 2,
  COMMERCIAL_LOW = 3,
  COMMERCIAL_HIGH = 4,
  INDUSTRIAL = 5,
  OFFICE = 6,
}

export enum NaturalResource {
  NONE = 0,
  ORE = 1,
  OIL = 2,
  FERTILE = 3,
  FOREST = 4,
}

export function isResidentialZone(z: ZoneType): boolean {
  return z === ZoneType.RESIDENTIAL_LOW || z === ZoneType.RESIDENTIAL_HIGH;
}

export function isCommercialZone(z: ZoneType): boolean {
  return z === ZoneType.COMMERCIAL_LOW || z === ZoneType.COMMERCIAL_HIGH;
}

export function isWorkplaceZone(z: ZoneType): boolean {
  return z === ZoneType.COMMERCIAL_LOW || z === ZoneType.COMMERCIAL_HIGH
    || z === ZoneType.INDUSTRIAL || z === ZoneType.OFFICE;
}

export type RCICategory = 'residential' | 'commercial' | 'industrial';

/** Map a zone type to its RCI demand category */
export function zoneToRCI(z: ZoneType): RCICategory | null {
  if (isResidentialZone(z)) return 'residential';
  if (isCommercialZone(z)) return 'commercial';
  if (z === ZoneType.INDUSTRIAL || z === ZoneType.OFFICE) return 'industrial';
  return null;
}

export interface CellData {
  terrainType: TerrainType;
  zoneType: ZoneType;
  buildingId: number;
  roadFlags: number;
  roadType: number;
  trafficDensity: number;
  landValue: number;
  pollution: number;
  noiseLevel: number;
  serviceCoverage: number;
  elevation: number;
  reserved: number;
  railType: number;
  railFlags: number;
}

export const BYTES_PER_CELL = 12;

/** Byte offsets for DataView-backed fields within a cell's binary layout. */
export const CELL_OFFSET = {
  terrainType: 0,
  zoneType: 1,
  buildingId: 2,
  roadFlags: 4,
  roadType: 5,
  trafficDensity: 6,
  landValue: 7,
  pollution: 8,
  noiseLevel: 9,
  serviceCoverage: 10,
  elevation: 11,
} as const;

export const DEFAULT_CELL: CellData = {
  terrainType: TerrainType.PLAIN,
  zoneType: ZoneType.NONE,
  buildingId: 0,
  roadFlags: 0,
  roadType: 0,
  trafficDensity: 0,
  landValue: 0,
  pollution: 0,
  noiseLevel: 0,
  serviceCoverage: 0,
  elevation: 0,
  reserved: 0,
  railType: 0,
  railFlags: 0,
};

/** All serializable CellData property keys — single source of truth */
export const CELL_KEYS: readonly (keyof CellData)[] = Object.keys(DEFAULT_CELL) as (keyof CellData)[];

/** Check if a cell equals the default (all properties match DEFAULT_CELL) */
export function isCellDefault(cell: CellData): boolean {
  return CELL_KEYS.every(k => cell[k] === DEFAULT_CELL[k]);
}

/** Extract only the properties that differ from DEFAULT_CELL */
export function getCellDiff(cell: CellData): Partial<CellData> {
  const diff: Partial<CellData> = {};
  for (const k of CELL_KEYS) {
    if (cell[k] !== DEFAULT_CELL[k]) {
      (diff as Record<string, unknown>)[k] = cell[k];
    }
  }
  return diff;
}

export interface Position {
  x: number;
  y: number;
}
