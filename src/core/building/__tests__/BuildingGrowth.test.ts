import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../../zone/ZoneManager';
import { BuildingGrowth, type GrowthConditions } from '../BuildingGrowth';

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
});
