import { describe, it, expect } from 'vitest';
import { getIncomeLevelMultiplier, getBuildingLevelMultiplier, CITIZEN_BASE_INCOME, ROAD_MAINTENANCE_PER_TILE } from '../TaxMultipliers';
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

  describe('economy constants', () => {
    it('CITIZEN_BASE_INCOME should be 0.5', () => {
      expect(CITIZEN_BASE_INCOME).toBe(0.5);
    });

    it('ROAD_MAINTENANCE_PER_TILE should be 0.1', () => {
      expect(ROAD_MAINTENANCE_PER_TILE).toBe(0.1);
    });
  });
});
