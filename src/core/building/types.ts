import { ZoneType } from '../grid/types';

export enum BuildingStatus {
  NORMAL = 0,
  ABANDONED = 1,
  UNDER_CONSTRUCTION = 2,
  BURNED = 3,
}

export interface BuildingType {
  id: number;
  name: string;
  zoneType: ZoneType;
  density: 'LOW' | 'HIGH';
  level: 1 | 2 | 3;
  residents: number;
  workers: number;
  appearanceId: number;
  companyIncome?: number; // Revenue base for commercial/industrial/office (0 or omitted for residential)
}

export const BUILDING_TYPES: BuildingType[] = [
  // Residential Low (no companyIncome)
  { id: 1, name: 'Small House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 1, residents: 4, workers: 0, appearanceId: 100 },
  { id: 2, name: 'Medium House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 2, residents: 6, workers: 0, appearanceId: 101 },
  { id: 3, name: 'Large House', zoneType: ZoneType.RESIDENTIAL_LOW, density: 'LOW', level: 3, residents: 8, workers: 0, appearanceId: 102 },
  // Residential High (no companyIncome)
  { id: 4, name: 'Small Apartment', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 1, residents: 80, workers: 0, appearanceId: 110 },
  { id: 5, name: 'Medium Apartment', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 2, residents: 160, workers: 0, appearanceId: 111 },
  { id: 6, name: 'High Rise', zoneType: ZoneType.RESIDENTIAL_HIGH, density: 'HIGH', level: 3, residents: 320, workers: 0, appearanceId: 112 },
  // Commercial Low: Lv1=10, Lv2=15, Lv3=20
  { id: 7, name: 'Small Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 1, residents: 0, workers: 4, appearanceId: 200, companyIncome: 10 },
  { id: 8, name: 'Medium Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 2, residents: 0, workers: 8, appearanceId: 201, companyIncome: 15 },
  { id: 9, name: 'Large Shop', zoneType: ZoneType.COMMERCIAL_LOW, density: 'LOW', level: 3, residents: 0, workers: 12, appearanceId: 202, companyIncome: 20 },
  // Commercial High: Lv1=40, Lv2=60, Lv3=80
  { id: 10, name: 'Small Mall', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 1, residents: 0, workers: 80, appearanceId: 210, companyIncome: 40 },
  { id: 11, name: 'Medium Mall', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 2, residents: 0, workers: 160, appearanceId: 211, companyIncome: 60 },
  { id: 12, name: 'Department Store', zoneType: ZoneType.COMMERCIAL_HIGH, density: 'HIGH', level: 3, residents: 0, workers: 320, appearanceId: 212, companyIncome: 80 },
  // Industrial: Lv1=15, Lv2=22, Lv3=30
  { id: 13, name: 'Small Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 1, residents: 0, workers: 10, appearanceId: 300, companyIncome: 15 },
  { id: 14, name: 'Medium Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 2, residents: 0, workers: 20, appearanceId: 301, companyIncome: 22 },
  { id: 15, name: 'Large Factory', zoneType: ZoneType.INDUSTRIAL, density: 'LOW', level: 3, residents: 0, workers: 40, appearanceId: 302, companyIncome: 30 },
  // Office Low: Lv1=20, Lv2=30, Lv3=40
  { id: 16, name: 'Small Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 1, residents: 0, workers: 15, appearanceId: 400, companyIncome: 20 },
  { id: 17, name: 'Medium Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 2, residents: 0, workers: 30, appearanceId: 401, companyIncome: 30 },
  { id: 18, name: 'Large Office', zoneType: ZoneType.OFFICE, density: 'LOW', level: 3, residents: 0, workers: 50, appearanceId: 402, companyIncome: 40 },
  // Office High: Lv1=60, Lv2=90, Lv3=120
  { id: 19, name: 'Office Building', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 1, residents: 0, workers: 160, appearanceId: 403, companyIncome: 60 },
  { id: 20, name: 'Office Complex', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 2, residents: 0, workers: 320, appearanceId: 404, companyIncome: 90 },
  { id: 21, name: 'Office Tower', zoneType: ZoneType.OFFICE, density: 'HIGH', level: 3, residents: 0, workers: 600, appearanceId: 405, companyIncome: 120 },
];

export function getBuildingType(id: number): BuildingType | undefined {
  return BUILDING_TYPES.find((b) => b.id === id);
}

export function getBuildingsForZone(zoneType: ZoneType, density: 'LOW' | 'HIGH', level: 1 | 2 | 3): BuildingType[] {
  return BUILDING_TYPES.filter(
    (b) => b.zoneType === zoneType && b.density === density && b.level === level,
  );
}
