import { describe, it, expect } from 'vitest';
import { calculatePoliceLoads, calculateFireLoads } from '../PoliceFireLoadCalculator';
import { buildCitizenLocationIndex } from '../../citizen/CitizenLocationIndex';
import { EducationLevel } from '../../citizen/types';
import { ZoneType } from '../../grid/types';

describe('PoliceFireLoadCalculator', () => {
  describe('calculatePoliceLoads', () => {
    it('returns empty array when no citizens', () => {
      const result = calculatePoliceLoads(buildCitizenLocationIndex([]), { getCoverage: () => false }, { getCell: () => null });
      expect(result).toEqual([]);
    });

    it('produces residential demand weighted by education level', () => {
      const citizens = [
        { homeId: '2,3', workplaceId: null, education: EducationLevel.NONE },
      ];
      const police = { getCoverage: (x: number, y: number) => x === 2 && y === 3 };
      const grid = { getCell: () => ({ zoneType: ZoneType.NONE }) };

      const result = calculatePoliceLoads(buildCitizenLocationIndex(citizens), police, grid);
      // NONE education → multiplier 2.0, baseDemand 0.3 → 0.6
      expect(result.length).toBe(1);
      expect(result[0]!.x).toBe(2);
      expect(result[0]!.y).toBe(3);
      expect(result[0]!.weight).toBeCloseTo(0.6);
    });

    it('university education has lower police demand', () => {
      const citizens = [
        { homeId: '1,1', workplaceId: null, education: EducationLevel.UNIVERSITY },
      ];
      const police = { getCoverage: () => true };
      const grid = { getCell: () => ({ zoneType: ZoneType.NONE }) };

      const result = calculatePoliceLoads(buildCitizenLocationIndex(citizens), police, grid);
      // UNIVERSITY → multiplier 0.3, baseDemand 0.3 → 0.09
      expect(result[0]!.weight).toBeCloseTo(0.09);
    });

    it('adds workplace demand weighted by zone type', () => {
      const citizens = [
        { homeId: null, workplaceId: '5,5', education: EducationLevel.HIGH_SCHOOL },
      ];
      const police = { getCoverage: () => true };
      const grid = { getCell: (x: number, y: number) => {
        if (x === 5 && y === 5) return { zoneType: ZoneType.INDUSTRIAL };
        return null;
      }};

      const result = calculatePoliceLoads(buildCitizenLocationIndex(citizens), police, grid);
      // Industrial zone → multiplier 1.5, baseDemand 0.3 → 0.45
      expect(result.length).toBe(1);
      expect(result[0]!.weight).toBeCloseTo(0.45);
    });

    it('skips citizens outside police coverage', () => {
      const citizens = [
        { homeId: '1,1', workplaceId: null, education: EducationLevel.NONE },
      ];
      const police = { getCoverage: () => false };
      const grid = { getCell: () => null };

      const result = calculatePoliceLoads(buildCitizenLocationIndex(citizens), police, grid);
      expect(result).toEqual([]);
    });

    it('combines home + workplace demands for same citizen', () => {
      const citizens = [
        { homeId: '1,1', workplaceId: '2,2', education: EducationLevel.ELEMENTARY },
      ];
      const police = { getCoverage: () => true };
      const grid = { getCell: (_x: number, _y: number) => ({ zoneType: ZoneType.OFFICE }) };

      const result = calculatePoliceLoads(buildCitizenLocationIndex(citizens), police, grid);
      // Home: ELEMENTARY → 1.1 * 0.3 = 0.33
      // Work: OFFICE → 0.5 * 0.3 = 0.15
      expect(result.length).toBe(2);
    });
  });

  describe('calculateFireLoads', () => {
    it('returns empty array when no citizens', () => {
      const result = calculateFireLoads(buildCitizenLocationIndex([]), { getCoverage: () => false }, { getCell: () => null });
      expect(result).toEqual([]);
    });

    it('produces residential fire demand weighted by occupancy ratio', () => {
      // 2 citizens sharing a home with capacity 4 → occupancy 0.5
      const citizens = [
        { homeId: '3,3', workplaceId: null, education: EducationLevel.NONE },
        { homeId: '3,3', workplaceId: null, education: EducationLevel.NONE },
      ];
      const fire = { getCoverage: () => true };
      const grid = { getCell: () => ({ zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }) };
      const getBuildingResidents = (_id: number) => 4;

      const result = calculateFireLoads(buildCitizenLocationIndex(citizens), fire, grid, getBuildingResidents);
      // 每位住戶 baseDemand * (1 + 擠迫) = 0.3 * (1 + 0.5) = 0.45，兩位合成一筆 0.9。
      // 同一棟樓只出一筆是去重的重點 —— 下游對同一格只做加總，總量沒有變。
      expect(result.length, '同一棟樓沒有合成一筆').toBe(1);
      expect(result[0]!.weight).toBeCloseTo(0.9);
    });

    it('adds workplace fire demand weighted by zone type', () => {
      const citizens = [
        { homeId: null, workplaceId: '4,4', education: EducationLevel.NONE },
      ];
      const fire = { getCoverage: () => true };
      const grid = { getCell: () => ({ zoneType: ZoneType.INDUSTRIAL, buildingId: 0 }) };

      const result = calculateFireLoads(buildCitizenLocationIndex(citizens), fire, grid);
      // Industrial zone → 2.0 * 0.3 = 0.6
      expect(result.length).toBe(1);
      expect(result[0]!.weight).toBeCloseTo(0.6);
    });

    it('skips citizens outside fire coverage', () => {
      const citizens = [
        { homeId: '1,1', workplaceId: null, education: EducationLevel.NONE },
      ];
      const fire = { getCoverage: () => false };
      const grid = { getCell: () => null };

      const result = calculateFireLoads(buildCitizenLocationIndex(citizens), fire, grid);
      expect(result).toEqual([]);
    });
  });
});
