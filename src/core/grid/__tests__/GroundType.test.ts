import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { RoadType } from '../../road/types';
import { isStoneGround } from '../GroundType';

describe('GroundType', () => {
  describe('isStoneGround', () => {
    it('should return false for empty cell', () => {
      const grid = new Grid(10, 10);
      const cell = grid.getCell(5, 5)!;
      expect(isStoneGround(cell)).toBe(false);
    });

    it('should return true for cell with building', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { buildingId: 1 });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return true for cell with road', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { roadType: RoadType.TWO_LANE });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return true for power plant (buildingId 254)', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { buildingId: 254 });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return true for water plant (buildingId 253)', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { buildingId: 253 });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return true for RURAL road', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { roadType: RoadType.RURAL });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return true for FOUR_LANE road', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { roadType: RoadType.FOUR_LANE });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(true);
    });

    it('should return false for zoned cell without building', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { zoneType: 1 }); // RESIDENTIAL_LOW
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(false);
    });

    it('should return false for cell with only elevation', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { elevation: 3 });
      expect(isStoneGround(grid.getCell(5, 5)!)).toBe(false);
    });
  });
});
