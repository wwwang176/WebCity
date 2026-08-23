import { describe, it, expect } from 'vitest';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood, calculateZoneDemand, type ZoneConsumptionConfig } from '../NetworkCoverage';
import { CoverageBits } from '../CoverageBits';
import { UtilityFloodScratch } from '../UtilityFloodScratch';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { RoadType } from '../../road/types';

function makeGrid(w: number, h: number): Grid {
  return new Grid(w, h);
}

/** 對好尺寸的空覆蓋圖。 */
function bits(grid: Grid): CoverageBits {
  const b = new CoverageBits();
  b.reset(grid.width, grid.height);
  return b;
}

/** 一輪覆蓋計算的暫存。同一輪的每一座廠共用同一份（已付款的 footprint 靠它跨廠）。 */
function pass(grid: Grid, infra?: Set<string>): UtilityFloodScratch {
  const s = new UtilityFloodScratch();
  s.beginPass(grid, infra);
  return s;
}

describe('bfsRoadNetworkFlood', () => {
  it('should flood through connected road cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE });

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(3, 3)).toBe(true);
    expect(coverage.has(4, 3)).toBe(true);
    expect(coverage.has(5, 3)).toBe(true);
  });

  it('should flood through building cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { buildingId: 100 });
    grid.setCell(4, 3, { buildingId: 101 });

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(3, 3)).toBe(true);
    expect(coverage.has(4, 3)).toBe(true);
  });

  it('should not flood through empty cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    // gap at 4,3
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE });

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(3, 3)).toBe(true);
    expect(coverage.has(5, 3)).toBe(false); // disconnected
  });

  it('should flood through infrastructure positions', () => {
    const grid = makeGrid(10, 10);
    const infra = new Set([toPosKey(3, 3), toPosKey(4, 3)]);

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid, infra));

    expect(coverage.has(3, 3)).toBe(true);
    expect(coverage.has(4, 3)).toBe(true);
  });

  it('should accumulate into existing coverage set', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(2, 2, { roadType: RoadType.TWO_LANE });
    grid.setCell(7, 7, { roadType: RoadType.TWO_LANE });

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 2, 2, coverage, pass(grid));
    bfsRoadNetworkFlood(grid, 7, 7, coverage, pass(grid));

    expect(coverage.has(2, 2)).toBe(true);
    expect(coverage.has(7, 7)).toBe(true);
  });

  it('should cover zoned cells adjacent to road as destinations', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { zoneType: ZoneType.INDUSTRIAL }); // zoned, no road/building

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(3, 3)).toBe(true);
    expect(coverage.has(4, 3)).toBe(true); // zoned cell covered
  });

  it('should not relay through empty zoned cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { zoneType: ZoneType.RESIDENTIAL_LOW }); // zoned, no building
    grid.setCell(5, 3, { zoneType: ZoneType.RESIDENTIAL_LOW }); // behind the zoned cell

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(4, 3)).toBe(true);  // adjacent to road: covered
    expect(coverage.has(5, 3)).toBe(false); // behind empty zone: not covered
  });

  it('should relay through zoned cells that have buildings', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // has building
    grid.setCell(5, 3, { zoneType: ZoneType.RESIDENTIAL_LOW }); // empty behind building

    const coverage = bits(grid);
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    expect(coverage.has(4, 3)).toBe(true); // building: relay
    expect(coverage.has(5, 3)).toBe(true); // adjacent to building: covered
  });

  it('should skip already-covered cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE });

    const coverage = bits(grid);
    coverage.add(3, 3); // pre-covered
    bfsRoadNetworkFlood(grid, 3, 3, coverage, pass(grid));

    // Should still have both since start was already covered, it skips immediately
    expect(coverage.size).toBe(1); // only the pre-existing one
  });
});

describe('bfsBudgetDrainFlood', () => {
  it('should mark cells as supplied while draining budget', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });

    const supplied = bits(grid);
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) return 10;
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, pass(grid));

    expect(supplied.has(3, 3)).toBe(true);
    expect(supplied.has(4, 3)).toBe(true);
  });

  it('should stop supplying when budget runs out', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE, buildingId: 101 });

    const supplied = bits(grid);
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) return 80;
      if (x === 5 && y === 3) return 80;
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, pass(grid));

    expect(supplied.has(3, 3)).toBe(true);
    expect(supplied.has(4, 3)).toBe(true);
    // 5,3 requires 80 but only 20 left, so not supplied
    expect(supplied.has(5, 3)).toBe(false);
  });

  it('should skip cells already in supplied set', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });

    const supplied = bits(grid);
    supplied.add(4, 3); // already supplied by another plant

    let demandCalls = 0;
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) { demandCalls++; return 50; }
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, pass(grid));

    // Should not drain budget for already-supplied cells
    expect(demandCalls).toBe(0);
  });

  it('should supply zoned cells adjacent to road without relay', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { zoneType: ZoneType.INDUSTRIAL }); // zoned, no road/building
    grid.setCell(5, 3, { zoneType: ZoneType.INDUSTRIAL }); // behind the zoned cell

    const supplied = bits(grid);
    const getDemand = () => 0;

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, pass(grid));

    expect(supplied.has(4, 3)).toBe(true);  // adjacent to road: supplied
    expect(supplied.has(5, 3)).toBe(false); // behind empty zone: not supplied
  });

  it('should accept infra positions for relay', () => {
    const grid = makeGrid(10, 10);
    const infra = new Set([toPosKey(3, 3), toPosKey(4, 3)]);

    const supplied = bits(grid);
    const getDemand = () => 0;

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, pass(grid, infra));

    expect(supplied.has(3, 3)).toBe(true);
    expect(supplied.has(4, 3)).toBe(true);
  });
});

describe('calculateZoneDemand', () => {
  const config: ZoneConsumptionConfig = {
    RESIDENTIAL: { base: 1, perCapita: 0.1 },
    COMMERCIAL:  { base: 2, perCapita: 0.2 },
    INDUSTRIAL:  { base: 3, perCapita: 0.3 },
    OFFICE:      { base: 4, perCapita: 0.4 },
  };

  it('residential zone uses residents for perCapita', () => {
    const d = calculateZoneDemand(config, ZoneType.RESIDENTIAL_LOW, 10, 5);
    // base 1 + 0.1 * 10 residents = 2
    expect(d).toBe(2);
  });

  it('residential high also uses residents', () => {
    const d = calculateZoneDemand(config, ZoneType.RESIDENTIAL_HIGH, 20, 0);
    expect(d).toBe(1 + 0.1 * 20);
  });

  it('commercial zone uses workers for perCapita', () => {
    const d = calculateZoneDemand(config, ZoneType.COMMERCIAL_LOW, 0, 8);
    // base 2 + 0.2 * 8 workers = 3.6
    expect(d).toBeCloseTo(3.6);
  });

  it('industrial zone uses workers', () => {
    const d = calculateZoneDemand(config, ZoneType.INDUSTRIAL, 0, 10);
    // base 3 + 0.3 * 10 = 6
    expect(d).toBe(6);
  });

  it('office zone uses workers', () => {
    const d = calculateZoneDemand(config, ZoneType.OFFICE, 0, 5);
    // base 4 + 0.4 * 5 = 6
    expect(d).toBe(6);
  });

  it('returns 0 for NONE zone', () => {
    expect(calculateZoneDemand(config, ZoneType.NONE, 10, 10)).toBe(0);
  });

  it('works with POWER_CONSUMPTION values', () => {
    // Verify it produces same result as the old hardcoded PowerGrid.getZoneDemand
    const powerConfig: ZoneConsumptionConfig = {
      RESIDENTIAL: { base: 0.25, perCapita: 0.025 },
      COMMERCIAL:  { base: 0.5,  perCapita: 0.04 },
      INDUSTRIAL:  { base: 1,    perCapita: 0.06 },
      OFFICE:      { base: 0.5,  perCapita: 0.025 },
    };
    expect(calculateZoneDemand(powerConfig, ZoneType.RESIDENTIAL_LOW, 8, 0)).toBeCloseTo(0.45);
    expect(calculateZoneDemand(powerConfig, ZoneType.INDUSTRIAL, 0, 10)).toBeCloseTo(1.6);
  });

  it('works with WATER_CONSUMPTION values', () => {
    const waterConfig: ZoneConsumptionConfig = {
      RESIDENTIAL: { base: 0.375, perCapita: 0.0375 },
      COMMERCIAL:  { base: 0.2,   perCapita: 0.016 },
      INDUSTRIAL:  { base: 0.8,   perCapita: 0.048 },
      OFFICE:      { base: 0.15,  perCapita: 0.0075 },
    };
    expect(calculateZoneDemand(waterConfig, ZoneType.RESIDENTIAL_HIGH, 8, 0)).toBeCloseTo(0.675);
    expect(calculateZoneDemand(waterConfig, ZoneType.OFFICE, 0, 10)).toBeCloseTo(0.225);
  });
});
