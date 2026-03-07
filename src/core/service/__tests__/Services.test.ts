import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { PowerGrid } from '../PowerGrid';
import { WaterNetwork } from '../WaterNetwork';

describe('PowerGrid', () => {
  it('should power buildings connected via roads', () => {
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

  it('should NOT power disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 100, pollution: 0, type: 'solar' });
    power.calculateCoverage(grid);

    expect(power.isPowered(15, 15)).toBe(false);
  });

  it('should calculate total output', () => {
    const power = new PowerGrid();
    power.addPlant({ x: 0, y: 0, output: 100, pollution: 0, type: 'coal' });
    power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'nuclear' });
    expect(power.getTotalOutput()).toBe(600);
  });
});

describe('WaterNetwork', () => {
  it('should supply buildings connected via roads', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    grid.setCell(5, 4, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 5, output: 100 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(5, 4)).toBe(true);
  });

  it('should NOT supply disconnected buildings', () => {
    const grid = new Grid(20, 20);
    grid.setCell(15, 15, { buildingId: 1 });

    const water = new WaterNetwork();
    water.addPlant({ x: 0, y: 0, output: 100 });
    water.calculateCoverage(grid);

    expect(water.isSupplied(15, 15)).toBe(false);
  });
});
