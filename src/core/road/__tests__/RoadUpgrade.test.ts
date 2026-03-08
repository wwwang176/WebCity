import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../RoadBuilder';
import { RoadNetwork } from '../RoadNetwork';
import { RoadUpgrade } from '../RoadUpgrade';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../types';

describe('RoadUpgrade', () => {
  it('should upgrade TWO_LANE to FOUR_LANE', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 100000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(4, 5);
    expect(cell!.roadType).toBe(RoadType.FOUR_LANE);
  });

  it('should charge the cost difference for upgrade', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 100000);

    const expectedCost = ROAD_CONFIGS[RoadType.FOUR_LANE].cost - ROAD_CONFIGS[RoadType.TWO_LANE].cost;
    expect(result.cost).toBe(expectedCost);
  });

  it('should fail upgrade when insufficient funds', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 10);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
  });

  it('should update maxDensity after upgrade to FOUR_LANE', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 100000);

    const config = ROAD_CONFIGS[RoadType.FOUR_LANE];
    expect(config.maxDensity).toBe('HIGH');
  });

  it('should fail to downgrade FOUR_LANE to TWO_LANE', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.FOUR_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('CANNOT_DOWNGRADE');
  });

  it('should fail to upgrade same type (cost diff = 0)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('CANNOT_DOWNGRADE');
  });

  it('should fail to upgrade non-road cell', () => {
    const grid = new Grid(20, 20);
    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(5, 5, RoadType.FOUR_LANE, 100000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('NO_ROAD');
  });

  it('should upgrade RURAL to FOUR_LANE', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.RURAL, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 100000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(ROAD_CONFIGS[RoadType.FOUR_LANE].cost - ROAD_CONFIGS[RoadType.RURAL].cost);
    expect(grid.getCell(4, 5)!.roadType).toBe(RoadType.FOUR_LANE);
  });

  it('should preserve roadFlags after upgrade', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    const flagsBefore = grid.getCell(4, 5)!.roadFlags;
    expect(flagsBefore & RoadDirection.EAST).toBeTruthy();
    expect(flagsBefore & RoadDirection.WEST).toBeTruthy();

    const upgrade = new RoadUpgrade(grid);
    upgrade.upgradeRoad(4, 5, RoadType.FOUR_LANE, 100000);

    const flagsAfter = grid.getCell(4, 5)!.roadFlags;
    expect(flagsAfter & RoadDirection.EAST).toBeTruthy();
    expect(flagsAfter & RoadDirection.WEST).toBeTruthy();
  });

  it('should upgrade RURAL to TWO_LANE with correct cost', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.RURAL, 100000);

    const upgrade = new RoadUpgrade(grid);
    const result = upgrade.upgradeRoad(4, 5, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(100); // 200 - 100
  });
});
