import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { placeInfraOnGrid } from '../../building/InfraPlacement';
import { INFRA_CONFIGS, getInfraBuildingId, type InfraType } from '../../building/InfraConfig';
import { PowerGrid } from '../PowerGrid';
import { WaterNetwork } from '../WaterNetwork';

/**
 * Every facility the player can place either produces a utility or consumes
 * one. The consumption tables covered the civic services and left out the
 * entire transport family — airports, bus stops, metro/train stations and
 * ferry docks. A 40000-cost Large Airport drew exactly 0 power and 0 water.
 *
 * The asymmetry was the sharp edge: BaseTransportSystem already runs
 * isFacilityOperational on every stop, so a transit stop STOPS WORKING without
 * power while never appearing in the demand that sizes the power plant. The
 * player could not discover what to build.
 *
 * This walks INFRA_CONFIGS, so a facility added later cannot quietly arrive
 * with no entry.
 */
const PRODUCERS: ReadonlySet<InfraType> = new Set<InfraType>(['power', 'water']);

function demandFor(type: InfraType): { power: number; water: number } {
  const grid = new Grid(24, 24);
  placeInfraOnGrid(grid, 2, 2, type, 0);
  const pg = new PowerGrid();
  pg.calculateDemand(grid);
  const wn = new WaterNetwork();
  wn.calculateDemand(grid);
  return { power: pg.getDemand(), water: wn.getDemand() };
}

describe('every placeable facility draws utilities', () => {
  for (const cfg of INFRA_CONFIGS) {
    if (PRODUCERS.has(cfg.type)) continue;
    it(`should charge power for ${cfg.name}`, () => {
      expect(demandFor(cfg.type).power).toBeGreaterThan(0);
    });
  }

  for (const cfg of INFRA_CONFIGS) {
    if (PRODUCERS.has(cfg.type)) continue;
    it(`should charge water for ${cfg.name}`, () => {
      expect(demandFor(cfg.type).water).toBeGreaterThan(0);
    });
  }

  it('should charge a power plant no power and a water plant no water', () => {
    // Negative controls: a producer must not bill itself for what it makes.
    expect(demandFor('power').power).toBe(0);
    expect(demandFor('water').water).toBe(0);
  });

  it('should scale airport draw with airport size', () => {
    const s = demandFor('airport_s');
    const m = demandFor('airport_m');
    const l = demandFor('airport_l');
    expect(m.power).toBeGreaterThan(s.power);
    expect(l.power).toBeGreaterThan(m.power);
    expect(m.water).toBeGreaterThan(s.water);
    expect(l.water).toBeGreaterThan(m.water);
  });

  it('should still bill a multi-cell airport exactly once', () => {
    // The footprint is up to 9x6; billing per cell would be a 54x error.
    const grid = new Grid(24, 24);
    placeInfraOnGrid(grid, 2, 2, 'airport_l', 0);
    const pg = new PowerGrid();
    pg.calculateDemand(grid);

    const single = new Grid(24, 24);
    single.setCell(2, 2, { buildingId: getInfraBuildingId('airport_l'), reserved: 0 });
    const pgSingle = new PowerGrid();
    pgSingle.calculateDemand(single);

    expect(pg.getDemand()).toBe(pgSingle.getDemand());
  });
});
