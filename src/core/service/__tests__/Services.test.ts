import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { PowerGrid } from '../PowerGrid';
import { WaterNetwork } from '../WaterNetwork';

describe('PowerGrid', () => {
  it('should power cells connected via roads from plant', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 5, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // On road — powered
    expect(power.isPowered(0, 5)).toBe(true);
    expect(power.isPowered(5, 5)).toBe(true);
    expect(power.isPowered(10, 5)).toBe(true);
  });

  it('should NOT power cells not connected by road or building', () => {
    const grid = new Grid(20, 20);
    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // No road/building connecting — not powered (even if close)
    expect(power.isPowered(3, 0)).toBe(false);
    expect(power.isPowered(0, 3)).toBe(false);
  });

  it('should power buildings adjacent to road network', () => {
    const grid = new Grid(30, 30);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
    // Building one cell off road
    grid.setCell(10, 4, { buildingId: 1 });
    grid.setCell(10, 6, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 5, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    expect(power.isPowered(10, 4)).toBe(true);
    expect(power.isPowered(10, 6)).toBe(true);
  });

  it('should power buildings connected via roads (backward compat)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    grid.setCell(5, 4, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 5, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    expect(power.isPowered(5, 5)).toBe(true);
    expect(power.isPowered(5, 4)).toBe(true);
  });

  it('should NOT power distant disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    expect(power.isPowered(15, 15)).toBe(false);
  });

  it('should calculate total output', () => {
    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 100, pollution: 0, type: 'coal' });
    power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'nuclear' });
    expect(power.getTotalOutput()).toBe(600);
  });

  it('should relay power infinitely through continuous roads', () => {
    const grid = new Grid(40, 10);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 10, y: 5 }, { x: 35, y: 5 }, RoadType.TWO_LANE, 100000);

    const power = new PowerGrid();
    power.addPlant({ x: 10, y: 5, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // All cells on road — powered via BFS
    expect(power.isPowered(20, 5)).toBe(true);
    expect(power.isPowered(25, 5)).toBe(true);
    expect(power.isPowered(30, 5)).toBe(true);
    expect(power.isPowered(35, 5)).toBe(true);
    // Past road end — no road/building, NOT powered
    expect(power.isPowered(37, 5)).toBe(false);
  });

  it('should relay power through buildings beyond any distance', () => {
    const grid = new Grid(30, 30);
    // Continuous building chain
    for (let x = 1; x <= 28; x++) {
      grid.setCell(x, 15, { buildingId: 1 });
    }

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 15, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // All buildings in chain — powered via BFS through buildings
    expect(power.isPowered(1, 15)).toBe(true);
    expect(power.isPowered(15, 15)).toBe(true);
    expect(power.isPowered(28, 15)).toBe(true);
    // Empty cell past chain — NOT powered
    expect(power.isPowered(29, 15)).toBe(false);
  });

  it('should cover cells from multiple plants on separate road networks', () => {
    const grid = new Grid(40, 20);
    const builder = new RoadBuilder(grid);
    // Two separate road segments
    builder.buildRoad({ x: 0, y: 10 }, { x: 10, y: 10 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 25, y: 10 }, { x: 35, y: 10 }, RoadType.TWO_LANE, 100000);

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 10, output: 500, pollution: 0, type: 'solar' });
    power.addPlant({ x: 25, y: 10, output: 500, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Near first plant — on road
    expect(power.isPowered(5, 10)).toBe(true);
    // Near second plant — on road
    expect(power.isPowered(30, 10)).toBe(true);
    // Gap between — not connected
    expect(power.isPowered(17, 10)).toBe(false);
  });
});

describe('WaterNetwork', () => {
  it('should supply cells connected via roads from plant', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 5, output: 500 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(0, 5)).toBe(true);
    expect(water.isSupplied(5, 5)).toBe(true);
    expect(water.isSupplied(10, 5)).toBe(true);
  });

  it('should NOT supply cells not connected by road or building', () => {
    const grid = new Grid(20, 20);
    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 0, output: 500 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(3, 0)).toBe(false);
  });

  it('should relay water infinitely through continuous roads', () => {
    const grid = new Grid(40, 10);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 10, y: 5 }, { x: 35, y: 5 }, RoadType.TWO_LANE, 100000);

    const water = new WaterNetwork();
    water.addPlant({ x: 10, y: 5, output: 500 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(20, 5)).toBe(true);
    expect(water.isSupplied(30, 5)).toBe(true);
    expect(water.isSupplied(35, 5)).toBe(true);
    // Past road end — not connected
    expect(water.isSupplied(37, 5)).toBe(false);
  });

  it('should supply buildings connected via roads', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    grid.setCell(5, 4, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 5, output: 500 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(5, 4)).toBe(true);
  });

  it('should NOT supply distant disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 0, output: 500 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(15, 15)).toBe(false);
  });

  it('should drain budget per building via BFS', () => {
    const grid = new Grid(20, 20);
    for (let i = 0; i < 15; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(1, 0, { zoneType: 1, buildingId: 1, roadFlags: 1, roadType: 1 }); // near
    grid.setCell(9, 0, { zoneType: 1, buildingId: 1, roadFlags: 1, roadType: 1 }); // far

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 0, output: 0.8 }); // enough for 1 house (demand ~0.525) but not 2
    water.calculateDemand(grid);
    water.calculateCoverage(grid);

    // Near building powered, far building not
    expect(water.isSupplied(1, 0)).toBe(true);
    expect(water.isSupplied(9, 0)).toBe(false);
  });
});
