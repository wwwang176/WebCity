import { describe, it, expect, beforeEach } from 'vitest';
import { FreightSystem, FreightRouteType, getProductionRate, getConsumptionRate } from '../FreightSystem';
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

  it('should import via BFS from trade facility position', () => {
    // Road: (0,0)-(10,0), factory at left, mall at right, station at right
    for (let x = 0; x <= 10; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 }); // produces 3
    grid.setCell(10, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 }); // consumes 8
    // Station at (10,0) — near the mall

    freight.calculateSupply(grid, {
      importCapacity: 10, exportCapacity: 0,
      tradePositions: [{ x: 10, y: 0 }],
    });

    // Mall gets 3 local + 5 import = 8 total → fully supplied via import top-up
    expect(freight.getSupplyStatus(10, 1).source).toBe('imported');
    expect(freight.getSupplyStatus(10, 1).ratio).toBe(1);
    expect(freight.getLastTrade().imported).toBe(5); // only the import portion
  });

  it('should not import to commercial far from trade facility', () => {
    // Two disconnected roads
    for (let x = 0; x <= 3; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(15, 0, { roadType: RoadType.TWO_LANE });
    // Factory on road A, mall on road B (disconnected)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(15, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });
    // Station on road A — can't reach mall on road B

    freight.calculateSupply(grid, {
      importCapacity: 100, exportCapacity: 0,
      tradePositions: [{ x: 3, y: 0 }],
    });

    expect(freight.getSupplyStatus(15, 1).source).toBe('none');
    expect(freight.getSupplyStatus(15, 1).ratio).toBe(0);
  });

  it('should export only from factories reachable by trade facility', () => {
    // Two disconnected roads
    for (let x = 0; x <= 3; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(15, 0, { roadType: RoadType.TWO_LANE });
    // Factory A on road A (near station), Factory B on road B (no station)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 }); // produces 3
    grid.setCell(15, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 }); // produces 3
    // 1 shop to create some consumption
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 }); // consumes 1
    // Station on road A only

    freight.calculateSupply(grid, {
      importCapacity: 0, exportCapacity: 100,
      tradePositions: [{ x: 3, y: 0 }],
    });

    // Total production 6, consumption 1, surplus 5
    // But only factory A (produces 3) is reachable from station
    // Export = min(surplus=5, exportable=3, capacity=100) = 3
    expect(freight.getLastTrade().exported).toBe(3);
    expect(freight.getIsExporting()).toBe(true);
  });

  it('should partially supply unaffordable commercial and continue BFS', () => {
    // Road: (0,0)-(6,0)
    for (let x = 0; x <= 6; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // Factory produces 3
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    // Big mall (consumes 8) at (3,1) — budget can only partially cover
    grid.setCell(3, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });
    // Small shop (consumes 1) behind the mall at (6,1)
    grid.setCell(6, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    freight.calculateSupply(grid);

    // Mall gets partial supply: 3/8 = 0.375, budget exhausted
    expect(freight.getSupplyStatus(3, 1).ratio).toBeCloseTo(3 / 8);
    expect(freight.isSupplied(3, 1)).toBe(true); // partially supplied counts
    // Shop behind gets nothing (budget = 0)
    expect(freight.isSupplied(6, 1)).toBe(false);
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

  it('high density commercial gets partial supply when production insufficient', () => {
    for (let x = 0; x <= 2; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 factory Lv1 (produces 3) vs 1 Small Mall (consumes 8)
    grid.setCell(0, 1, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });

    freight.calculateSupply(grid);

    // Factory budget 3 < Mall demand 8 → partial supply 3/8
    expect(freight.getSupplyStatus(2, 1).ratio).toBeCloseTo(3 / 8);
    expect(freight.isSupplied(2, 1)).toBe(true); // partial counts as supplied
    expect(freight.getLastDemand().shortage).toBe(5); // 8 - 3 = 5 unmet
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

  describe('FreightRouteType enum', () => {
    it('should have correct string values', () => {
      expect(FreightRouteType.LOCAL).toBe('local');
      expect(FreightRouteType.EXPORT).toBe('export');
      expect(FreightRouteType.IMPORT).toBe('import');
    });
  });
});
