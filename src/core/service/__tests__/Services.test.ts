import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { PowerGrid } from '../PowerGrid';
import { WaterNetwork } from '../WaterNetwork';

describe('PowerGrid', () => {
  it('should power buildings within Euclidean radius of plant', () => {
    const grid = new Grid(30, 30);
    const power = new PowerGrid();
    power.addPlant({ x: 15, y: 15, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Cell at distance 0 (plant itself)
    expect(power.isPowered(15, 15)).toBe(true);
    // Cell at distance 5 (within radius 10)
    expect(power.isPowered(20, 15)).toBe(true);
    // Cell at distance 10 (exactly at radius boundary)
    expect(power.isPowered(25, 15)).toBe(true);
    // Cell at distance ~7.07 (diagonal, within radius)
    expect(power.isPowered(20, 20)).toBe(true);
  });

  it('should NOT power cells beyond Euclidean radius', () => {
    const grid = new Grid(30, 30);
    const power = new PowerGrid();
    power.addPlant({ x: 15, y: 15, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Cell at distance 11 (beyond radius 10)
    expect(power.isPowered(26, 15)).toBe(false);
    // Cell at distance ~14.14 (diagonal corner of bounding box, outside circle)
    expect(power.isPowered(25, 25)).toBe(false);
  });

  it('should produce circular coverage, not diamond/square', () => {
    const grid = new Grid(30, 30);
    const power = new PowerGrid();
    power.addPlant({ x: 15, y: 15, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // In a diamond (Manhattan), (22, 22) would be at distance 14 (outside range 10)
    // In Euclidean, (22, 22) is at distance ~9.9 (inside range 10)
    expect(power.isPowered(22, 22)).toBe(true);

    // Corner of bounding square: (25, 25) is at Euclidean ~14.14 (outside)
    // but in old BFS (Manhattan 10), also outside — this is a sanity check
    expect(power.isPowered(25, 25)).toBe(false);

    // (22, 8) is at Euclidean dist ~9.9 from (15,15) — inside circle
    expect(power.isPowered(22, 8)).toBe(true);
    // (8, 22) is at Euclidean dist ~9.9 from (15,15) — inside circle
    expect(power.isPowered(8, 22)).toBe(true);
  });

  it('should power buildings connected via roads (backward compat)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    grid.setCell(5, 4, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 5, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    expect(power.isPowered(5, 5)).toBe(true);
    expect(power.isPowered(5, 4)).toBe(true);
  });

  it('should NOT power distant disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Distance ~21.2 — well beyond radius 10
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
    // Build road from plant all the way to x=35 (distance 25 from plant)
    builder.buildRoad({ x: 10, y: 5 }, { x: 35, y: 5 }, RoadType.TWO_LANE, 100000);

    const power = new PowerGrid();
    power.addPlant({ x: 10, y: 5, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Within base circle (dist 10)
    expect(power.isPowered(20, 5)).toBe(true);
    // Far beyond circle but on road — relay keeps going
    expect(power.isPowered(25, 5)).toBe(true); // dist 15
    expect(power.isPowered(30, 5)).toBe(true); // dist 20
    expect(power.isPowered(35, 5)).toBe(true); // dist 25
    // Road ends, empty cell 2 beyond road end still covered (range spills over)
    expect(power.isPowered(36, 5)).toBe(true);  // 1 past road end
    // But far past road end — NOT covered
    expect(power.isPowered(38, 5)).toBe(false);
  });

  it('should relay power through buildings beyond base radius', () => {
    const grid = new Grid(30, 30);
    // Continuous building chain from circle edge outward
    for (let x = 20; x <= 28; x++) {
      grid.setCell(x, 15, { buildingId: 1 });
    }

    const power = new PowerGrid();
    power.addPlant({ x: 10, y: 15, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Building at edge (dist 10) — covered by base circle
    expect(power.isPowered(20, 15)).toBe(true);
    // Far buildings — relay through building chain
    expect(power.isPowered(25, 15)).toBe(true); // dist 15
    expect(power.isPowered(28, 15)).toBe(true); // dist 18
    // Empty cell past building chain — covered by range spill
    expect(power.isPowered(29, 15)).toBe(true);
    // Far past chain — NOT covered
    expect(power.isPowered(31, 15)).toBe(false);
  });

  it('should cover cells from multiple plants with union of circles', () => {
    const grid = new Grid(40, 20);
    const power = new PowerGrid();
    power.addPlant({ x: 5, y: 10, output: 100, pollution: 0, type: 'solar' });
    power.addPlant({ x: 30, y: 10, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    // Near first plant
    expect(power.isPowered(5, 10)).toBe(true);
    // Near second plant
    expect(power.isPowered(30, 10)).toBe(true);
    // Midpoint (17,10) — distance 12 from (5,10) and 13 from (30,10), outside both
    expect(power.isPowered(17, 10)).toBe(false);
    // Closer to first plant (distance 9)
    expect(power.isPowered(14, 10)).toBe(true);
  });
});

describe('WaterNetwork', () => {
  it('should supply cells within Euclidean radius of plant', () => {
    const grid = new Grid(30, 30);
    const water = new WaterNetwork();
    water.addPlant({ x: 15, y: 15, output: 100 });
    water.calculateCoverage(grid);

    // Within radius
    expect(water.isSupplied(15, 15)).toBe(true);
    expect(water.isSupplied(20, 15)).toBe(true);
    expect(water.isSupplied(25, 15)).toBe(true);
    // Diagonal within circle
    expect(water.isSupplied(22, 22)).toBe(true);
  });

  it('should NOT supply cells beyond Euclidean radius', () => {
    const grid = new Grid(30, 30);
    const water = new WaterNetwork();
    water.addPlant({ x: 15, y: 15, output: 100 });
    water.calculateCoverage(grid);

    // Beyond radius
    expect(water.isSupplied(26, 15)).toBe(false);
    // Diagonal corner — outside circle
    expect(water.isSupplied(25, 25)).toBe(false);
  });

  it('should produce circular coverage, not diamond/square', () => {
    const grid = new Grid(30, 30);
    const water = new WaterNetwork();
    water.addPlant({ x: 15, y: 15, output: 100 });
    water.calculateCoverage(grid);

    // (22, 22) at Euclidean ~9.9 from (15,15) — inside circle
    expect(water.isSupplied(22, 22)).toBe(true);
    // (25, 25) at Euclidean ~14.14 — outside circle
    expect(water.isSupplied(25, 25)).toBe(false);
  });

  it('should relay water infinitely through continuous roads', () => {
    const grid = new Grid(40, 10);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 10, y: 5 }, { x: 35, y: 5 }, RoadType.TWO_LANE, 100000);

    const water = new WaterNetwork();
    water.addPlant({ x: 10, y: 5, output: 100 });
    water.calculateCoverage(grid);

    // Within base circle (dist 10)
    expect(water.isSupplied(20, 5)).toBe(true);
    // Far beyond circle but on road — relay keeps going
    expect(water.isSupplied(25, 5)).toBe(true); // dist 15
    expect(water.isSupplied(30, 5)).toBe(true); // dist 20
    expect(water.isSupplied(35, 5)).toBe(true); // dist 25
    // 1 past road end — range spill
    expect(water.isSupplied(36, 5)).toBe(true);
    // Far past road end — NOT covered
    expect(water.isSupplied(38, 5)).toBe(false);
  });

  it('should supply buildings connected via roads (backward compat)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    grid.setCell(5, 4, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 5, output: 100 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(5, 4)).toBe(true);
  });

  it('should NOT supply distant disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 0, output: 100 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(15, 15)).toBe(false);
  });
});
