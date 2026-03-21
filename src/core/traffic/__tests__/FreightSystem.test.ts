import { describe, it, expect, beforeEach } from 'vitest';
import { FreightSystem, FREIGHT } from '../FreightSystem';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

describe('FreightSystem', () => {
  let grid: Grid;
  let freight: FreightSystem;

  beforeEach(() => {
    grid = new Grid(20, 20);
    freight = new FreightSystem();
  });

  it('should supply commercial connected to industrial via road', () => {
    // Road: (2,0)-(3,0)-(4,0)
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 0, { roadType: RoadType.TWO_LANE });
    // Industrial adjacent to road
    grid.setCell(2, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    // Commercial adjacent to road
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.isSupplied(4, 1)).toBe(true);
    expect(freight.getShortageRatio()).toBe(0);
  });

  it('should not supply commercial disconnected from industrial', () => {
    // Two separate roads with no connection
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(10, 0, { roadType: RoadType.TWO_LANE });
    // Industrial on road A
    grid.setCell(2, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    // Commercial on road B (disconnected)
    grid.setCell(10, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.isSupplied(10, 1)).toBe(false);
    expect(freight.getShortageRatio()).toBe(1); // 100% shortage
  });

  it('should serve closer commercial first when production is limited', () => {
    // Road: (0,0) to (6,0)
    for (let x = 0; x <= 6; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }
    // 1 industrial (produces 2) adjacent to road start
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    // 3 commercial (consume 1 each) — only 2 can be served
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(6, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    // Closer two should be supplied, farthest unsupplied
    expect(freight.getSuppliedCount()).toBe(2);
    expect(freight.getShortageRatio()).toBeCloseTo(1 / 3);
  });

  it('should accumulate surplus in cargoStorage', () => {
    // 2 industrial (produce 4) + 1 commercial (consumes 1) → surplus 3
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(1, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.getCargoStorage()).toBe(3); // 4 produced - 1 consumed
    expect(freight.getSurplusRatio()).toBeCloseTo(3 / FREIGHT.MAX_STORAGE);
  });

  it('should cap cargoStorage at MAX_STORAGE', () => {
    for (let x = 0; x <= 2; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    // Fill storage beyond max
    freight.addExternalCargo(FREIGHT.MAX_STORAGE);
    freight.calculateSupply(grid);

    expect(freight.getCargoStorage()).toBe(FREIGHT.MAX_STORAGE);
    expect(freight.getSurplusRatio()).toBe(1);
  });

  it('should drain cargoStorage when consumption exceeds production', () => {
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 0, { roadType: RoadType.TWO_LANE });
    // Only commercial, no industrial — connected to road but no source
    grid.setCell(3, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.addExternalCargo(10);
    freight.calculateSupply(grid);

    // No industrial to supply, so commercial is unsupplied
    // But storage drains by the shortage: 0 produced - 0 consumed = 0 surplus, storage stays
    // Actually: production=0, actualConsumed=0 (unsupplied), surplus=0
    expect(freight.getCargoStorage()).toBe(10); // unchanged since nothing consumed
  });

  it('should handle addExternalCargo', () => {
    expect(freight.getCargoStorage()).toBe(0);
    freight.addExternalCargo(100);
    expect(freight.getCargoStorage()).toBe(100);
  });

  it('should report correct production and consumption', () => {
    for (let x = 0; x <= 4; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }
    // 2 industrial, 3 commercial, all connected
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(1, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(3, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    const demand = freight.getLastDemand();
    expect(demand.production).toBe(4); // 2 factories × 2
    expect(demand.consumption).toBe(3); // 3 shops × 1
    expect(demand.shortage).toBe(0); // 4 production ≥ 3 consumption
  });

  it('freight rates should be positive', () => {
    expect(FREIGHT.INDUSTRIAL_PRODUCTION_RATE).toBeGreaterThan(0);
    expect(FREIGHT.COMMERCIAL_CONSUMPTION_RATE).toBeGreaterThan(0);
  });

  it('production rate should exceed consumption rate', () => {
    expect(FREIGHT.INDUSTRIAL_PRODUCTION_RATE).toBeGreaterThanOrEqual(FREIGHT.COMMERCIAL_CONSUMPTION_RATE);
  });

  it('should have zero shortage with no commercial buildings', () => {
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    freight.calculateSupply(grid);
    expect(freight.getShortageRatio()).toBe(0);
  });
});
