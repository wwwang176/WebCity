import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadBuilder } from '../RoadBuilder';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../types';

describe('RoadBuilder', () => {
  it('should build a horizontal road between two points', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    for (let x = 2; x <= 6; x++) {
      const cell = grid.getCell(x, 5);
      expect(cell!.roadType).toBe(RoadType.TWO_LANE);
    }
  });

  it('should set correct road flags for middle cells', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    const cell = grid.getCell(3, 5);
    expect(cell!.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.WEST).toBeTruthy();
  });

  it('should set correct road flags for start endpoint', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    const cell = grid.getCell(2, 5);
    expect(cell!.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.WEST).toBeFalsy();
  });

  it('should have correct properties for TWO_LANE road', () => {
    const config = ROAD_CONFIGS[RoadType.TWO_LANE];
    expect(config.lanes).toBe(2);
    expect(config.speedLimit).toBe(50);
  });

  it('should have correct properties for SIX_LANE road', () => {
    const config = ROAD_CONFIGS[RoadType.SIX_LANE];
    expect(config.lanes).toBe(6);
    expect(config.speedLimit).toBe(60);
  });

  it('should fail to build road on water', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { terrainType: TerrainType.WATER });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('WATER_TILE');
  });

  it('should fail when insufficient funds', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
  });

  it('should deduct correct cost on success', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    // 5 cells * 200 cost = 1000
    expect(result.cost).toBe(5 * ROAD_CONFIGS[RoadType.TWO_LANE].cost);
  });

  it('should build a vertical road', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 5, y: 2 }, { x: 5, y: 6 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(5, 4);
    expect(cell!.roadFlags & RoadDirection.NORTH).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.SOUTH).toBeTruthy();
  });
});
