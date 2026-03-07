import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../RoadBuilder';
import { RoadNetwork } from '../RoadNetwork';
import { RoadUpgrade } from '../RoadUpgrade';
import { RoadType, ROAD_CONFIGS } from '../types';

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
});
