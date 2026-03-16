import { describe, it, expect } from 'vitest';
import { PowerGrid, POWER_CONSUMPTION, INFRA_POWER_CONSUMPTION } from '../PowerGrid';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { getInfraBuildingId } from '../../building/InfraConfig';

function makeGrid(w = 10, h = 10): Grid {
  return new Grid(w, h);
}

describe('POWER_CONSUMPTION constants', () => {
  it('should define consumption for all zone categories', () => {
    expect(POWER_CONSUMPTION.RESIDENTIAL).toEqual({ base: 0.5, perCapita: 0.05 });
    expect(POWER_CONSUMPTION.COMMERCIAL).toEqual({ base: 1, perCapita: 0.08 });
    expect(POWER_CONSUMPTION.INDUSTRIAL).toEqual({ base: 2, perCapita: 0.12 });
    expect(POWER_CONSUMPTION.OFFICE).toEqual({ base: 1, perCapita: 0.05 });
  });
});

describe('INFRA_POWER_CONSUMPTION', () => {
  it('should define power consumption for civic facilities', () => {
    expect(INFRA_POWER_CONSUMPTION.police).toBe(10);
    expect(INFRA_POWER_CONSUMPTION.fire).toBe(10);
    expect(INFRA_POWER_CONSUMPTION.health).toBe(18);
    expect(INFRA_POWER_CONSUMPTION.elementary).toBe(8);
    expect(INFRA_POWER_CONSUMPTION.highschool).toBe(12);
    expect(INFRA_POWER_CONSUMPTION.university).toBe(16);
    expect(INFRA_POWER_CONSUMPTION.garbage).toBe(15);
    expect(INFRA_POWER_CONSUMPTION.water).toBe(20);
    expect(INFRA_POWER_CONSUMPTION.sewage).toBe(15);
    expect(INFRA_POWER_CONSUMPTION.park).toBe(3);
    expect(INFRA_POWER_CONSUMPTION.cemetery).toBe(3);
  });
});

describe('PowerGrid.calculateDemand', () => {
  it('should return 0 demand for empty grid', () => {
    const grid = makeGrid();
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(0);
  });

  it('should calculate demand for a single residential building', () => {
    const grid = makeGrid();
    // Small House: id=1, residents=4 → 0.5 + 0.05*4 = 0.7
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(0.7, 5);
  });

  it('should calculate demand for a commercial building', () => {
    const grid = makeGrid();
    // Small Shop: id=7, workers=4 → 1 + 0.08*4 = 1.32
    grid.setCell(3, 3, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(1.32, 5);
  });

  it('should calculate demand for an industrial building', () => {
    const grid = makeGrid();
    // Small Factory: id=13, workers=10 → 2 + 0.12*10 = 3.2
    grid.setCell(4, 4, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(3.2, 5);
  });

  it('should calculate demand for an office building', () => {
    const grid = makeGrid();
    // Small Office: id=16, workers=15 → 1 + 0.05*15 = 1.75
    grid.setCell(5, 5, { zoneType: ZoneType.OFFICE, buildingId: 16 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(1.75, 5);
  });

  it('should sum demand for mixed zone types', () => {
    const grid = makeGrid();
    // Small House (0.7) + Small Shop (1.32) + Small Factory (3.2) = 5.22
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(2, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(3, 3, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(5.22, 5);
  });

  it('should include infrastructure power consumption', () => {
    const grid = makeGrid();
    // Police Station: buildingId=252, cost=10
    const policeId = getInfraBuildingId('police');
    grid.setCell(1, 1, { buildingId: policeId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(10);
  });

  it('should include multiple infra buildings', () => {
    const grid = makeGrid();
    const policeId = getInfraBuildingId('police'); // 10
    const fireId = getInfraBuildingId('fire');     // 10
    const hospitalId = getInfraBuildingId('hospital'); // 18
    grid.setCell(1, 1, { buildingId: policeId });
    grid.setCell(3, 3, { buildingId: fireId });
    grid.setCell(5, 5, { buildingId: hospitalId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(38); // 10+10+18
  });

  it('should combine zone and infra demand', () => {
    const grid = makeGrid();
    // Small House: 0.7
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    // Police Station: 10
    const policeId = getInfraBuildingId('police');
    grid.setCell(3, 3, { buildingId: policeId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(10.7, 5);
  });

  it('should not count power plants as demand', () => {
    const grid = makeGrid();
    const powerId = getInfraBuildingId('power');
    grid.setCell(1, 1, { buildingId: powerId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(0); // power plants don't consume power
  });

  it('should ignore empty cells and roads', () => {
    const grid = makeGrid();
    grid.setCell(1, 1, { roadFlags: 1, roadType: 1 }); // road
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 }); // zoned but empty
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(0);
  });

  it('should calculate high density residential correctly', () => {
    const grid = makeGrid();
    // High Rise: id=6, residents=320 → 0.5 + 0.05*320 = 16.5
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(16.5, 5);
  });
});

describe('PowerGrid.getSupply', () => {
  it('should return 0 with no plants', () => {
    const pg = new PowerGrid();
    expect(pg.getSupply()).toBe(0);
  });

  it('should return total output of all plants', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    pg.addPlant({ x: 5, y: 5, output: 500, pollution: 50, type: 'coal' });
    expect(pg.getSupply()).toBe(1000);
  });
});

describe('PowerGrid.getSupplyRatio', () => {
  it('should return 1.0 when demand=0 and supply=0 (empty city)', () => {
    const pg = new PowerGrid();
    const grid = makeGrid();
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBe(1.0);
  });

  it('should return 1.0 when supply exceeds demand', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Small House: 0.7 demand
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBe(1.0);
  });

  it('should return supply/demand when supply < demand', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 10, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // High Rise: 16.5 demand, supply=10 → ratio = 10/16.5 ≈ 0.606
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBeCloseTo(10 / 16.5, 5);
  });

  it('should return 0 when supply=0 and demand>0', () => {
    const pg = new PowerGrid();
    const grid = makeGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBe(0);
  });

  it('should cap at 1.0', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 10000, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.7 demand
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBe(1.0);
  });
});

describe('PowerGrid.isPowered with supply ratio', () => {
  it('should power all buildings when supplyRatio >= 1.0', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 5, y: 5, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    grid.setCell(5, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(5, 4, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    pg.calculateCoverage(grid);
    pg.calculateDemand(grid);
    // Both cells are in coverage range and supply is sufficient
    expect(pg.isPowered(5, 6)).toBe(true);
    expect(pg.isPowered(5, 4)).toBe(true);
  });

  it('should mark distant buildings as unpowered when supplyRatio < 1.0', () => {
    const pg = new PowerGrid();
    // Very low output, but coverage still reaches
    pg.addPlant({ x: 0, y: 0, output: 1, pollution: 50, type: 'coal' });
    const grid = makeGrid(20, 20);
    // Place road connections for relay
    for (let i = 0; i < 15; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    // Building near plant and building far from plant
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(9, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    // Must calculateDemand BEFORE calculateCoverage (ratio depends on demand)
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    // supply=1, demand=1.4, ratio<1
    // Near building should be powered, far building should not
    expect(pg.getSupplyRatio()).toBeLessThan(1);
    const near = pg.isPowered(1, 0);
    const far = pg.isPowered(9, 0);
    // Near should be powered before far
    expect(near).toBe(true);
    expect(far).toBe(false);
  });
});
