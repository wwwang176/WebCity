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

export interface Position {
  x: number;
  y: number;
}
