import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { placeInfraOnGrid } from '../../building/InfraPlacement';
import { PowerGrid, INFRA_POWER_CONSUMPTION } from '../PowerGrid';
import { WaterNetwork, INFRA_WATER_CONSUMPTION } from '../WaterNetwork';

/**
 * INFRA_POWER_CONSUMPTION / INFRA_WATER_CONSUMPTION are per-BUILDING rates, but
 * placeInfraOnGrid stamps the same buildingId onto every cell of the footprint,
 * and the demand sweeps visit every cell. A 2x2 police station was billed 4x,
 * a 3x3 university 9x.
 */
describe('multi-cell infrastructure utility demand', () => {
  it('should bill a 2x2 police station once, not once per footprint cell', () => {
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 2, 2, 'police', 0);
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(INFRA_POWER_CONSUMPTION.police);
  });

  it('should bill a 3x3 university once, not nine times', () => {
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 1, 1, 'school_univ', 0);
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(INFRA_POWER_CONSUMPTION.university);
  });

  it('should bill a rotated 2x3 hospital once', () => {
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 1, 1, 'hospital', 90);
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(INFRA_POWER_CONSUMPTION.health);
  });

  it('should bill water for a 2x2 police station once', () => {
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 2, 2, 'police', 0);
    const wn = new WaterNetwork();
    wn.calculateDemand(grid);
    expect(wn.getDemand()).toBe(INFRA_WATER_CONSUMPTION.police);
  });

  it('should charge a power plant no water at all', () => {
    // INFRA_TYPE_TO_KEY mapped `power` to the POLICE water rate with a comment
    // claiming power plants were "excluded above" — but the exclusion covers the
    // WATER plant (253), not the power plant (254).
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 2, 2, 'power', 0);
    const wn = new WaterNetwork();
    wn.calculateDemand(grid);
    expect(wn.getDemand()).toBe(0);
  });

  it('should still bill a 1x1 park exactly once', () => {
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 3, 3, 'park', 0);
    const pg = new PowerGrid();
    pg.calculateDemand(grid);
    expect(pg.getDemand()).toBe(INFRA_POWER_CONSUMPTION.park);
  });
});
