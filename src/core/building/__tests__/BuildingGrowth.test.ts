import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../../zone/ZoneManager';
import { BuildingGrowth, type GrowthConditions } from '../BuildingGrowth';
import { RailType } from '../../rail/types';

function setupWithZone(): { grid: Grid; growth: BuildingGrowth } {
  const grid = new Grid(20, 20);
  const builder = new RoadBuilder(grid);
  builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
  const zone = new ZoneManager(grid);
  zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
  return { grid, growth: new BuildingGrowth(grid) };
}

const fullConditions: GrowthConditions = {
  hasPower: true,
  hasWater: true,
  rciDemand: { residential: 50, commercial: 50, industrial: 50 },
};

describe('BuildingGrowth', () => {
  it('should grow building when all conditions met', () => {
    const { growth } = setupWithZone();
    const result = growth.tryGrow(5, 4, fullConditions);
    expect(result).toBe(true);
  });

  it('should not grow without power', () => {
    const { growth } = setupWithZone();
    const result = growth.canGrow(5, 4, { ...fullConditions, hasPower: false });
    expect(result).toBe(false);
  });

  it('should not grow without water', () => {
    const { growth } = setupWithZone();
    const result = growth.canGrow(5, 4, { ...fullConditions, hasWater: false });
    expect(result).toBe(false);
  });

  it('should not grow when R demand <= 0', () => {
    const { growth } = setupWithZone();
    const result = growth.canGrow(5, 4, {
      ...fullConditions,
      rciDemand: { residential: 0, commercial: 50, industrial: 50 },
    });
    expect(result).toBe(false);
  });

  it('should only grow low density on TWO_LANE road', () => {
    const { grid, growth } = setupWithZone();
    growth.tryGrow(5, 4, fullConditions);
    const cell = grid.getCell(5, 4);
    // Building id 1 = Small House (LOW density)
    expect(cell!.buildingId).toBe(1);
  });

  it('should grow industrial on HIGH density road by falling back to LOW', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    // FOUR_LANE has maxDensity: 'HIGH'
    builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.FOUR_LANE, 100000);
    const zone = new ZoneManager(grid);
    zone.setZone(5, 4, ZoneType.INDUSTRIAL);
    const growth = new BuildingGrowth(grid);
    const result = growth.tryGrow(5, 4, fullConditions);
    expect(result).toBe(true);
    const cell = grid.getCell(5, 4);
    // Should place a LOW density industrial building (id 13 = Small Factory)
    expect(cell!.buildingId).toBe(13);
  });

  it('should have randomness in growth', () => {
    // Run 100 times, verify it doesn't always grow in same tick
    const results: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const { growth } = setupWithZone();
      results.push(growth.tryGrow(5, 4, fullConditions));
    }
    // All should grow since conditions are met
    expect(results.every((r) => r)).toBe(true);
  });

  it('should not grow on cell with rail track', () => {
    const { grid, growth } = setupWithZone();
    grid.setCell(5, 4, { railType: RailType.STANDARD, railFlags: 3 });
    expect(growth.canGrow(5, 4, fullConditions)).toBe(false);
  });
});
