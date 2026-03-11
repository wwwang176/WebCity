import { describe, it, expect } from 'vitest';
import { getIncomeLevelMultiplier, getBuildingLevelMultiplier, ECONOMY, INCOME_LEVEL_MULTIPLIERS, BUILDING_LEVEL_MULTIPLIERS } from '../TaxMultipliers';
import { IncomeLevel } from '../../citizen/types';

describe('TaxMultipliers', () => {
  describe('getIncomeLevelMultiplier', () => {
    it('should return 1.0 for LOW income', () => {
      expect(getIncomeLevelMultiplier(IncomeLevel.LOW)).toBe(1.0);
    });

    it('should return 1.5 for MEDIUM income', () => {
      expect(getIncomeLevelMultiplier(IncomeLevel.MEDIUM)).toBe(1.5);
    });

    it('should return 2.0 for HIGH income', () => {
      expect(getIncomeLevelMultiplier(IncomeLevel.HIGH)).toBe(2.0);
    });
  });

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

  describe('INCOME_LEVEL_MULTIPLIERS lookup', () => {
    it('should have entries for all IncomeLevel values', () => {
      expect(INCOME_LEVEL_MULTIPLIERS[IncomeLevel.LOW]).toBe(1.0);
      expect(INCOME_LEVEL_MULTIPLIERS[IncomeLevel.MEDIUM]).toBe(1.5);
      expect(INCOME_LEVEL_MULTIPLIERS[IncomeLevel.HIGH]).toBe(2.0);
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
