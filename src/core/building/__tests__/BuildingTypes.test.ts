import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import { getBuildingType, getBuildingsForZone, BUILDING_TYPES } from '../types';

describe('BuildingTypes', () => {
  it('should find building by id', () => {
    const b = getBuildingType(1);
    expect(b).toBeDefined();
    expect(b!.name).toBe('Small House');
  });

  it('should return residential buildings with residents > 0', () => {
    const b = getBuildingType(1);
    expect(b!.residents).toBeGreaterThan(0);
  });

  it('should return commercial buildings with workers > 0', () => {
    const b = getBuildingType(7);
    expect(b!.workers).toBeGreaterThan(0);
  });

  it('should return industrial buildings with workers > 0', () => {
    const b = getBuildingType(13);
    expect(b!.workers).toBeGreaterThan(0);
  });

  it('should return office buildings as HIGH density only', () => {
    const offices = BUILDING_TYPES.filter((b) => b.zoneType === ZoneType.OFFICE);
    expect(offices.every((b) => b.density === 'HIGH')).toBe(true);
  });

  it('should find buildings for zone+density+level', () => {
    const result = getBuildingsForZone(ZoneType.RESIDENTIAL_LOW, 'LOW', 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
  });
});
