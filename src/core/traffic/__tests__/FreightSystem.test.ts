import { describe, it, expect, beforeEach } from 'vitest';
import { FreightSystem, INDUSTRIAL_PRODUCTION_RATE, COMMERCIAL_CONSUMPTION_RATE } from '../FreightSystem';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';

describe('FreightSystem', () => {
  let grid: Grid;
  let freight: FreightSystem;

  beforeEach(() => {
    grid = new Grid(20, 20);
    freight = new FreightSystem();
  });

  it('should produce cargo from industrial buildings', () => {
    // Place 3 industrial buildings
    for (let x = 0; x < 3; x++) {
      grid.setCell(x, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 15 });
    }

    const demand = freight.tick(grid);
    expect(demand.production).toBe(6); // 3 buildings * 2 cargo each
    expect(freight.getCargoStorage()).toBe(6); // all stored
  });

  it('should consume cargo at commercial buildings', () => {
    // Place industrial first to build storage
    grid.setCell(0, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 15 });
    freight.tick(grid); // produces 2, storage = 2

    // Now add commercial
    grid.setCell(1, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const demand = freight.tick(grid);

    expect(demand.production).toBe(2);
    expect(demand.consumption).toBe(1);
    expect(demand.shortage).toBe(0); // enough supply
    expect(freight.getCargoStorage()).toBe(3); // 2 stored + 2 produced - 1 consumed
  });

  it('should report shortage when commercial lacks supply', () => {
    // Only commercial, no industrial
    for (let x = 0; x < 5; x++) {
      grid.setCell(x, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    }

    const demand = freight.tick(grid);
    expect(demand.production).toBe(0);
    expect(demand.consumption).toBe(5);
    expect(demand.shortage).toBe(5); // full shortage
    expect(freight.getShortageRatio()).toBe(1); // 100% shortage
  });

  it('should track shortage ratio correctly', () => {
    // 1 industrial (produces 2) + 4 commercial (consume 4)
    grid.setCell(0, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 15 });
    for (let x = 1; x <= 4; x++) {
      grid.setCell(x, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    }

    freight.tick(grid);
    // Production: 2, consumption: 4, storage started at 0
    // Actual consumption: min(4, 2) = 2, shortage = 2
    expect(freight.getShortageRatio()).toBe(0.5); // 50% shortage
  });

  it('should have zero shortage ratio with no commercial buildings', () => {
    grid.setCell(0, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 15 });
    freight.tick(grid);
    expect(freight.getShortageRatio()).toBe(0);
  });

  it('freight rates should be positive', () => {
    expect(INDUSTRIAL_PRODUCTION_RATE).toBeGreaterThan(0);
    expect(COMMERCIAL_CONSUMPTION_RATE).toBeGreaterThan(0);
  });

  it('production rate should exceed consumption rate', () => {
    expect(INDUSTRIAL_PRODUCTION_RATE).toBeGreaterThanOrEqual(COMMERCIAL_CONSUMPTION_RATE);
  });
});
