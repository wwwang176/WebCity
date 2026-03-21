import { describe, it, expect, beforeEach } from 'vitest';
import { FreightSystem, getProductionRate, getConsumptionRate } from '../FreightSystem';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

// Building IDs: Industrial 13(Lv1),14(Lv2),15(Lv3), Commercial Low 7(Lv1),8(Lv2),9(Lv3), Commercial High 10(Lv1),11(Lv2),12(Lv3)

describe('FreightSystem', () => {
  let grid: Grid;
  let freight: FreightSystem;

  beforeEach(() => {
    grid = new Grid(20, 20);
    freight = new FreightSystem();
  });

  it('should supply commercial connected to industrial via road', () => {
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(2, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.isSupplied(4, 1)).toBe(true);
    expect(freight.getShortageRatio()).toBe(0);
  });

  it('should not supply commercial disconnected from industrial', () => {
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(10, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(2, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(10, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.isSupplied(10, 1)).toBe(false);
    expect(freight.getShortageRatio()).toBe(1);
  });

  it('should serve closer commercial first when production is limited', () => {
    for (let x = 0; x <= 6; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }
    // 1 factory Lv1 (produces 3) — can supply 3 small shops (consume 1 each)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    // 4 small shops (consume 1 each) — only 3 can be served
    grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(3, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(5, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(6, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    expect(freight.getSuppliedCount()).toBe(3);
    expect(freight.getShortageRatio()).toBeCloseTo(1 / 4);
  });

  it('should report surplus when production exceeds consumption', () => {
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 3 factories Lv1 (produce 9) + 1 small shop (consumes 1)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(1, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    // surplus = (9-1)/1 = 8, capped at 1
    expect(freight.getSurplusRatio()).toBe(1);
    expect(freight.getShortageRatio()).toBe(0);
  });

  it('should have zero surplus when consumption exceeds production', () => {
    for (let x = 0; x <= 2; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 factory Lv1 (produces 3) + 1 Small Mall (consumes 8)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });

    freight.calculateSupply(grid);

    expect(freight.getSurplusRatio()).toBe(0);
  });

  it('should include external cargo in BFS budget', () => {
    for (let x = 0; x <= 2; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 factory Lv1 (produces 3), 1 Small Mall (consumes 8) — normally can't supply
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });

    // Add enough external cargo to cover the gap
    freight.addExternalCargo(10);
    freight.calculateSupply(grid);

    // budget = 3 (factory) + 10 (external) = 13 ≥ 8 (mall demand)
    expect(freight.isSupplied(2, 1)).toBe(true);
    expect(freight.getShortageRatio()).toBe(0);
  });

  it('should report correct production and consumption with per-building rates', () => {
    for (let x = 0; x <= 4; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }
    // Factory Lv1 (3) + Factory Lv2 (5) = 8 production
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(1, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 14 });
    // Small Shop (1) + Medium Shop (2) = 3 consumption
    grid.setCell(3, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 8 });

    freight.calculateSupply(grid);

    const demand = freight.getLastDemand();
    expect(demand.production).toBe(8);
    expect(demand.consumption).toBe(3);
    expect(demand.shortage).toBe(0);
  });

  it('high density commercial should consume more', () => {
    for (let x = 0; x <= 2; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 factory Lv1 (produces 3) vs 1 Small Mall (consumes 8)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });

    freight.calculateSupply(grid);

    // Factory budget 3 < Mall demand 8 → mall unsupplied
    expect(freight.isSupplied(2, 1)).toBe(false);
    expect(freight.getLastDemand().shortage).toBe(8);
  });

  it('should have zero shortage with no commercial buildings', () => {
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    freight.calculateSupply(grid);
    expect(freight.getShortageRatio()).toBe(0);
  });

  describe('per-building rate lookup', () => {
    it('industrial production rates scale with level', () => {
      expect(getProductionRate(13)).toBe(3);  // Lv1
      expect(getProductionRate(14)).toBe(5);  // Lv2
      expect(getProductionRate(15)).toBe(8);  // Lv3
    });

    it('commercial consumption rates scale with level and density', () => {
      expect(getConsumptionRate(7)).toBe(1);   // CL Lv1
      expect(getConsumptionRate(8)).toBe(2);   // CL Lv2
      expect(getConsumptionRate(9)).toBe(3);   // CL Lv3
      expect(getConsumptionRate(10)).toBe(8);  // CH Lv1
      expect(getConsumptionRate(11)).toBe(14); // CH Lv2
      expect(getConsumptionRate(12)).toBe(20); // CH Lv3
    });

    it('unknown building ID returns 0', () => {
      expect(getProductionRate(999)).toBe(0);
      expect(getConsumptionRate(999)).toBe(0);
    });
  });
});
