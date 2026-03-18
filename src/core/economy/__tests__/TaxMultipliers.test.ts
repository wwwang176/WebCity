import { describe, it, expect } from 'vitest';
import {
  getBuildingLevelMultiplier, getResidentialLevelMultiplier, getEducationSalaryMultiplier,
  ECONOMY, BUILDING_LEVEL_MULTIPLIERS, RESIDENTIAL_LEVEL_MULTIPLIERS, EDUCATION_SALARY_MULTIPLIERS,
} from '../TaxMultipliers';
import { EducationLevel } from '../../citizen/types';

describe('TaxMultipliers', () => {
  describe('getBuildingLevelMultiplier (business)', () => {
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

  describe('getResidentialLevelMultiplier', () => {
    it('should return 1.0 for level 1', () => {
      expect(getResidentialLevelMultiplier(1)).toBe(1.0);
    });

    it('should return 1.15 for level 2', () => {
      expect(getResidentialLevelMultiplier(2)).toBe(1.15);
    });

    it('should return 1.3 for level 3', () => {
      expect(getResidentialLevelMultiplier(3)).toBe(1.3);
    });
  });

  describe('getEducationSalaryMultiplier', () => {
    it('NONE = 1.0', () => {
      expect(getEducationSalaryMultiplier(EducationLevel.NONE)).toBe(1.0);
    });

    it('ELEMENTARY = 1.1', () => {
      expect(getEducationSalaryMultiplier(EducationLevel.ELEMENTARY)).toBe(1.1);
    });

    it('HIGH_SCHOOL = 1.3', () => {
      expect(getEducationSalaryMultiplier(EducationLevel.HIGH_SCHOOL)).toBe(1.3);
    });

    it('UNIVERSITY = 1.5', () => {
      expect(getEducationSalaryMultiplier(EducationLevel.UNIVERSITY)).toBe(1.5);
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

  describe('multiplier tables', () => {
    it('BUILDING_LEVEL_MULTIPLIERS', () => {
      expect(BUILDING_LEVEL_MULTIPLIERS[1]).toBe(1.0);
      expect(BUILDING_LEVEL_MULTIPLIERS[2]).toBe(1.5);
      expect(BUILDING_LEVEL_MULTIPLIERS[3]).toBe(2.0);
    });

    it('RESIDENTIAL_LEVEL_MULTIPLIERS', () => {
      expect(RESIDENTIAL_LEVEL_MULTIPLIERS[1]).toBe(1.0);
      expect(RESIDENTIAL_LEVEL_MULTIPLIERS[2]).toBe(1.15);
      expect(RESIDENTIAL_LEVEL_MULTIPLIERS[3]).toBe(1.3);
    });

    it('EDUCATION_SALARY_MULTIPLIERS', () => {
      expect(EDUCATION_SALARY_MULTIPLIERS[EducationLevel.NONE]).toBe(1.0);
      expect(EDUCATION_SALARY_MULTIPLIERS[EducationLevel.UNIVERSITY]).toBe(1.5);
    });
  });
});
