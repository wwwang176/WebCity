import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { placeInfraOnGrid } from '../../building/InfraPlacement';
import { PowerGrid, INFRA_POWER_CONSUMPTION } from '../PowerGrid';
import { WaterNetwork, INFRA_WATER_CONSUMPTION } from '../WaterNetwork';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';

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

/**
 * calculateDemand is only the city-wide total. The other consumer of the same
 * per-cell figure is bfsBudgetDrainFlood, which settles the budget cell by cell
 * as it floods — and there, charging the whole building to its primary cell and
 * nothing to the rest is actively wrong.
 *
 * A plant that cannot afford a 2x2 police station skips the primary cell, but
 * the three secondary cells each report demand 0, so they were supplied for
 * free AND relayed onward. The station showed 3 of its 4 cells powered and
 * passed power through to whatever lay beyond it.
 */
describe('multi-cell infrastructure is supplied all-or-nothing', () => {
  /**
   * The station is the ONLY bridge between the road and the house — anything
   * that reaches (6,1) had to be conducted through the footprint.
   *
   *   (1,1)(2,1)(3,1)   road, from the plant
   *   (4,1)(5,1)        police station, top row  \ 2x2 footprint
   *   (4,2)(5,2)        police station, bottom   /
   *   (6,1)             house, reachable only through the station
   *   (1,2)-(2,3)       power plant, 2x2
   */
  function cityWithStation(output: number): PowerGrid {
    const grid = new Grid(12, 12);
    for (let x = 1; x <= 3; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    placeInfraOnGrid(grid, 1, 2, 'power', 0);
    placeInfraOnGrid(grid, 4, 1, 'police', 0);
    grid.setCell(6, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const pg = new PowerGrid();
    pg.addPlant({ x: 1, y: 2, output, pollution: 0, type: 'coal' });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    return pg;
  }

  const POLICE = INFRA_POWER_CONSUMPTION.police!;
  const STATION_CELLS = [[4, 1], [5, 1], [4, 2], [5, 2]] as const;

  it('should power every cell of the station when the plant can afford it', () => {
    const pg = cityWithStation(POLICE + 50);
    for (const [x, y] of STATION_CELLS) {
      expect(pg.isPowered(x, y), `(${x},${y}) should be powered`).toBe(true);
    }
  });

  it('should power no cell of the station when the plant cannot', () => {
    // Enough to reach the station, not enough to run it. The three secondary
    // cells report demand 0, so they used to come out powered for free.
    const pg = cityWithStation(POLICE - 1);
    for (const [x, y] of STATION_CELLS) {
      expect(pg.isPowered(x, y), `(${x},${y}) must not be powered`).toBe(false);
    }
  });

  it('should not let an unaffordable station relay power past itself', () => {
    const pg = cityWithStation(POLICE - 1);
    expect(pg.isPowered(6, 1)).toBe(false);
  });

  it('should still conduct past a station it can afford', () => {
    // Positive control for the relay: refusing to conduct must be a consequence
    // of the budget, not a blanket block on facility footprints.
    const pg = cityWithStation(POLICE + 50);
    expect(pg.isPowered(6, 1)).toBe(true);
  });

  /**
   * The case above is settled by refusing to relay through an unaffordable
   * cell alone, because the flood happens to arrive at the PRIMARY first.
   * Approach the same station from below and it arrives at a SECONDARY, whose
   * own demand is 0 — free to supply, free to relay, and the primary is then
   * refused on its own. That is the literal 3-of-4-cells-powered symptom, and
   * only the per-footprint charge key rules it out.
   *
   *   (1,3)…(5,3)  road, from the plant
   *   (4,1)(5,1)   police station, top row
   *   (4,2)(5,2)   police station, bottom row — (5,2) is what the road touches
   */
  function stationApproachedFromASecondaryCell(output: number): PowerGrid {
    const grid = new Grid(12, 12);
    for (let x = 1; x <= 5; x++) grid.setCell(x, 3, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    placeInfraOnGrid(grid, 1, 4, 'power', 0);
    placeInfraOnGrid(grid, 4, 1, 'police', 0);

    const pg = new PowerGrid();
    pg.addPlant({ x: 1, y: 4, output, pollution: 0, type: 'coal' });
    pg.calculateDemand(grid);
    pg.calculateCoverage(grid);
    return pg;
  }

  it('should refuse the whole station even when reached via a secondary cell', () => {
    const pg = stationApproachedFromASecondaryCell(POLICE - 1);
    for (const [x, y] of STATION_CELLS) {
      expect(pg.isPowered(x, y), `(${x},${y}) must not be powered`).toBe(false);
    }
  });

  it('should power the whole station when reached via a secondary cell', () => {
    const pg = stationApproachedFromASecondaryCell(POLICE + 50);
    for (const [x, y] of STATION_CELLS) {
      expect(pg.isPowered(x, y), `(${x},${y}) should be powered`).toBe(true);
    }
  });
});
