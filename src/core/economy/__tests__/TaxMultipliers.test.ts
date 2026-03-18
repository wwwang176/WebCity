import { describe, it, expect } from 'vitest';
import { getBuildingLevelMultiplier, ECONOMY, BUILDING_LEVEL_MULTIPLIERS } from '../TaxMultipliers';

describe('TaxMultipliers', () => {
  describe('getBuildingLevelMultiplier', () => {
    it('should return 1.0 for level 1', () => {
      expect(getBuildingLevelMultiplier(1)).toBe(1.0);
    });

    it('should return 1.5 for level 2', () => {
      expect(getBuildingLevelMultiplier(2)).toBe(1.5);
    });

    it('should return 2.0 for level 3', () => {
      expect(getBuildingLevelMultiplier(3)).toBe(2.0);
    });
  });

  describe('ECONOMY config', () => {
    it('CITIZEN_BASE_INCOME should be 0.5', () => {
      expect(ECONOMY.CITIZEN_BASE_INCOME).toBe(0.5);
    });

    it('ROAD_MAINTENANCE_PER_TILE should be 0.1', () => {
      expect(ECONOMY.ROAD_MAINTENANCE_PER_TILE).toBe(0.1);
    });
  });

  describe('BUILDING_LEVEL_MULTIPLIERS lookup', () => {
    it('should have entries for all building levels', () => {
      expect(BUILDING_LEVEL_MULTIPLIERS[1]).toBe(1.0);
      expect(BUILDING_LEVEL_MULTIPLIERS[2]).toBe(1.5);
      expect(BUILDING_LEVEL_MULTIPLIERS[3]).toBe(2.0);
    });
  });
});
