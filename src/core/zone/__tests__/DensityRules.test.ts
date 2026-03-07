import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { getMaxDensity } from '../DensityRules';

describe('DensityRules', () => {
  it('should return LOW density next to TWO_LANE road', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
    expect(getMaxDensity(grid, 5, 4)).toBe('LOW');
  });

  it('should return HIGH density next to FOUR_LANE road', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.FOUR_LANE, 100000);
    expect(getMaxDensity(grid, 5, 4)).toBe('HIGH');
  });

  it('should return NONE density when not adjacent to any road', () => {
    const grid = new Grid(20, 20);
    expect(getMaxDensity(grid, 0, 0)).toBe('NONE');
  });

  it('should update density when road is upgraded', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
    expect(getMaxDensity(grid, 5, 4)).toBe('LOW');

    // Simulate upgrade by changing road type directly
    grid.setCell(5, 5, { roadType: RoadType.FOUR_LANE });
    expect(getMaxDensity(grid, 5, 4)).toBe('HIGH');
  });
});
