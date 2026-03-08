import { ZoneType } from '../grid/types';

export enum BuildingStatus {
  NORMAL = 0,
  ABANDONED = 1,
  UNDER_CONSTRUCTION = 2,
}

export interface BuildingType {
  id: number;
  name: string;
  zoneType: ZoneType;
  density: 'LOW' | 'HIGH';
  level: 1 | 2 | 3;
  residents: number;
  workers: number;
  taxRevenue: number;
  appearanceId: number;
}

export const BUILDING_TYPES: BuildingType[] = [
  // Residential Low
  { id: 1, name: 'Small House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 1, residents: 4, workers: 0, taxRevenue: 10, appearanceId: 100 },
  { id: 2, name: 'Medium House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 2, residents: 6, workers: 0, taxRevenue: 18, appearanceId: 101 },
  { id: 3, name: 'Large House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 3, residents: 8, workers: 0, taxRevenue: 28, appearanceId: 102 },
  // Residential High
  { id: 4, name: 'Small Apartment', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 1, residents: 20, workers: 0, taxRevenue: 40, appearanceId: 110 },
  { id: 5, name: 'Medium Apartment', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 2, residents: 40, workers: 0, taxRevenue: 80, appearanceId: 111 },
  { id: 6, name: 'High Rise', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 3, residents: 80, workers: 0, taxRevenue: 150, appearanceId: 112 },
  // Commercial Low
  { id: 7, name: 'Small Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 1, residents: 0, workers: 4, taxRevenue: 15, appearanceId: 200 },
  { id: 8, name: 'Medium Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 2, residents: 0, workers: 8, taxRevenue: 30, appearanceId: 201 },
  { id: 9, name: 'Large Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 3, residents: 0, workers: 12, taxRevenue: 50, appearanceId: 202 },
  // Commercial High
  { id: 10, name: 'Small Mall', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 1, residents: 0, workers: 20, taxRevenue: 50, appearanceId: 210 },
  { id: 11, name: 'Medium Mall', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 2, residents: 0, workers: 40, taxRevenue: 100, appearanceId: 211 },
  { id: 12, name: 'Department Store', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 3, residents: 0, workers: 80, taxRevenue: 180, appearanceId: 212 },
  // Industrial
  { id: 13, name: 'Small Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 1, residents: 0, workers: 10, taxRevenue: 20, appearanceId: 300 },
  { id: 14, name: 'Medium Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 2, residents: 0, workers: 20, taxRevenue: 40, appearanceId: 301 },
  { id: 15, name: 'Large Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 3, residents: 0, workers: 40, taxRevenue: 70, appearanceId: 302 },
  // Office Low
  { id: 16, name: 'Small Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 1, residents: 0, workers: 15, taxRevenue: 30, appearanceId: 400 },
  { id: 17, name: 'Medium Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 2, residents: 0, workers: 30, taxRevenue: 60, appearanceId: 401 },
  { id: 18, name: 'Large Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 3, residents: 0, workers: 50, taxRevenue: 100, appearanceId: 402 },
  // Office High
  { id: 19, name: 'Office Building', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 1, residents: 0, workers: 40, taxRevenue: 80, appearanceId: 403 },
  { id: 20, name: 'Office Complex', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 2, residents: 0, workers: 80, taxRevenue: 160, appearanceId: 404 },
  { id: 21, name: 'Office Tower', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 3, residents: 0, workers: 150, taxRevenue: 280, appearanceId: 405 },
];

export function getBuildingType(id: number): BuildingType | undefined {
  return BUILDING_TYPES.find((b) => b.id === id);
}

export function getBuildingsForZone(zoneType: ZoneType, density: 'LOW' | 'HIGH', level: 1 | 2 | 3): BuildingType[] {
  return BUILDING_TYPES.filter(
    (b) => b.zoneType === zoneType && b.density === density && b.level === level,
  );
}
