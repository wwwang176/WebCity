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
    expect(POWER_CONSUMPTION.RESIDENTIAL).toEqual({ base: 0.25, perCapita: 0.025 });
    expect(POWER_CONSUMPTION.COMMERCIAL).toEqual({ base: 0.5, perCapita: 0.04 });
    expect(POWER_CONSUMPTION.INDUSTRIAL).toEqual({ base: 1, perCapita: 0.06 });
    expect(POWER_CONSUMPTION.OFFICE).toEqual({ base: 0.5, perCapita: 0.025 });
  });
});

describe('INFRA_POWER_CONSUMPTION', () => {
  it('should define power consumption for civic facilities', () => {
    expect(INFRA_POWER_CONSUMPTION.police).toBe(5);
    expect(INFRA_POWER_CONSUMPTION.fire).toBe(5);
    expect(INFRA_POWER_CONSUMPTION.health).toBe(9);
    expect(INFRA_POWER_CONSUMPTION.elementary).toBe(4);
    expect(INFRA_POWER_CONSUMPTION.highschool).toBe(6);
    expect(INFRA_POWER_CONSUMPTION.university).toBe(8);
    expect(INFRA_POWER_CONSUMPTION.garbage).toBe(8);
    expect(INFRA_POWER_CONSUMPTION.water).toBe(10);
    expect(INFRA_POWER_CONSUMPTION.sewage).toBe(8);
    expect(INFRA_POWER_CONSUMPTION.park).toBe(1.5);
    expect(INFRA_POWER_CONSUMPTION.cemetery).toBe(1.5);
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
    // Small House: id=1, residents=4 → 0.25 + 0.025*4 = 0.35
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(0.35, 5);
  });

  it('should calculate demand for a commercial building', () => {
    const grid = makeGrid();
    // Small Shop: id=7, workers=4 → 0.5 + 0.04*4 = 0.66
    grid.setCell(3, 3, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(0.66, 5);
  });

  it('should calculate demand for an industrial building', () => {
    const grid = makeGrid();
    // Small Factory: id=13, workers=10 → 1 + 0.06*10 = 1.6
    grid.setCell(4, 4, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(1.6, 5);
  });

  it('should calculate demand for an office building', () => {
    const grid = makeGrid();
    // Small Office: id=16, workers=15 → 0.5 + 0.025*15 = 0.875
    grid.setCell(5, 5, { zoneType: ZoneType.OFFICE, buildingId: 16 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(0.875, 5);
  });

  it('should sum demand for mixed zone types', () => {
    const grid = makeGrid();
    // Small House (0.35) + Small Shop (0.66) + Small Factory (1.6) = 2.61
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(2, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(3, 3, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(2.61, 5);
  });

  it('should include infrastructure power consumption', () => {
    const grid = makeGrid();
    // Police Station: buildingId=252, cost=5
    const policeId = getInfraBuildingId('police');
    grid.setCell(1, 1, { buildingId: policeId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(5);
  });

  it('should include multiple infra buildings', () => {
    const grid = makeGrid();
    const policeId = getInfraBuildingId('police'); // 5
    const fireId = getInfraBuildingId('fire');     // 5
    const hospitalId = getInfraBuildingId('hospital'); // 9
    grid.setCell(1, 1, { buildingId: policeId });
    grid.setCell(3, 3, { buildingId: fireId });
    grid.setCell(5, 5, { buildingId: hospitalId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(19); // 5+5+9
  });

  it('should combine zone and infra demand', () => {
    const grid = makeGrid();
    // Small House: 0.35
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    // Police Station: 5
    const policeId = getInfraBuildingId('police');
    grid.setCell(3, 3, { buildingId: policeId });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(5.35, 5);
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
    // High Rise: id=6, residents=320 → 0.25 + 0.025*320 = 8.25
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBeCloseTo(8.25, 5);
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

  it('should return ratio > 1.0 when supply exceeds demand', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Small House: 0.35 demand
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBeCloseTo(500 / 0.35, 1);
  });

  it('should return supply/demand when supply < demand', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 5, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // High Rise: 8.25 demand, supply=5 → ratio = 5/8.25 ≈ 0.606
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBeCloseTo(5 / 8.25, 5);
  });

  it('should return 0 when supply=0 and demand>0', () => {
    const pg = new PowerGrid();
    const grid = makeGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBe(0);
  });

  it('should allow ratio above 1.0 (surplus)', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 10000, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35 demand
    pg.calculateDemand(grid);
    expect(pg.getSupplyRatio()).toBeCloseTo(10000 / 0.35, 1);
  });
});

describe('PowerGrid BFS road-only coverage', () => {
  it('should NOT power buildings separated by empty land (no road/building path)', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Building at (3,0) with empty gap — no road or building connecting
    grid.setCell(3, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(3, 0)).toBe(false);
    expect(pg.isInCoverage(3, 0)).toBe(false);
  });

  it('should power buildings connected via road network', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Road connecting plant to buildings
    for (let i = 0; i < 5; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(2, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // on road
    grid.setCell(4, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 }); // on road
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(2, 0)).toBe(true);
    expect(pg.isPowered(4, 0)).toBe(true);
  });

  it('should power buildings adjacent to road (1 cell off road)', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Road along y=0
    for (let i = 0; i < 5; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    // Building one cell off road at (3, 1)
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(3, 1)).toBe(true);
  });

  it('should power near buildings first via BFS when supply is low', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 0.5, pollution: 50, type: 'coal' });
    const grid = makeGrid(20, 20);
    for (let i = 0; i < 15; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    grid.setCell(9, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    // supply=0.5, first building costs 0.35 → 0.15 left, second costs 0.35 → budget exhausted
    expect(pg.isPowered(1, 0)).toBe(true);
    expect(pg.isPowered(9, 0)).toBe(false);
  });

  it('should drain budget per building demand (heavy building drains faster)', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 5, y: 5, output: 2.5, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Road connecting plant to buildings
    grid.setCell(5, 5, { roadFlags: 1, roadType: 1 });
    grid.setCell(5, 6, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13, roadFlags: 1, roadType: 1 }); // 1.6
    grid.setCell(5, 7, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13, roadFlags: 1, roadType: 1 }); // 1.6
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(5, 6)).toBe(true);
    expect(pg.isPowered(5, 7)).toBe(false);
  });

  it('should keep fullCoverage for all reachable cells regardless of budget', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 0.5, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Road connects all
    for (let i = 0; i < 5; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    grid.setCell(3, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    // Both cells reachable via road (fullCoverage), but only first has power (budget 0.5 < 0.7)
    expect(pg.isInCoverage(1, 0)).toBe(true);
    expect(pg.isInCoverage(3, 0)).toBe(true);
    expect(pg.isPowered(1, 0)).toBe(true);
    expect(pg.isPowered(3, 0)).toBe(false);
  });

  it('multiple plants each have their own budget', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 1, pollution: 50, type: 'coal' });
    pg.addPlant({ x: 9, y: 0, output: 1, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    for (let i = 0; i < 10; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    grid.setCell(8, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    grid.setCell(5, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(1, 0)).toBe(true);
    expect(pg.isPowered(8, 0)).toBe(true);
  });

  it('non-building cells do not drain budget', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 1, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    for (let i = 1; i < 8; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(8, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 0.35
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(8, 0)).toBe(true);
  });

  it('disconnected road segments do not receive power', () => {
    const pg = new PowerGrid();
    pg.addPlant({ x: 0, y: 0, output: 500, pollution: 50, type: 'coal' });
    const grid = makeGrid();
    // Road near plant
    for (let i = 0; i < 3; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    // Gap at (3,0) — no road
    // Disconnected road segment far away
    for (let i = 5; i < 8; i++) grid.setCell(i, 0, { roadFlags: 1, roadType: 1 });
    grid.setCell(6, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    // Connected building gets power
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    expect(pg.isPowered(1, 0)).toBe(true);
    // Disconnected building does not
    expect(pg.isPowered(6, 0)).toBe(false);
  });
});
