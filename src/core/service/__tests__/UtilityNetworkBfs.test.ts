import { describe, it, expect } from 'vitest';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from '../NetworkCoverage';
import { Grid } from '../../grid/Grid';
import { toPosKey } from '../../grid/GridHelpers';
import { RoadType } from '../../road/types';

function makeGrid(w: number, h: number): Grid {
  return new Grid(w, h);
}

describe('bfsRoadNetworkFlood', () => {
  it('should flood through connected road cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE });

    const coverage = new Set<string>();
    bfsRoadNetworkFlood(grid, 3, 3, coverage);

    expect(coverage.has(toPosKey(3, 3))).toBe(true);
    expect(coverage.has(toPosKey(4, 3))).toBe(true);
    expect(coverage.has(toPosKey(5, 3))).toBe(true);
  });

  it('should flood through building cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { buildingId: 100 });
    grid.setCell(4, 3, { buildingId: 101 });

    const coverage = new Set<string>();
    bfsRoadNetworkFlood(grid, 3, 3, coverage);

    expect(coverage.has(toPosKey(3, 3))).toBe(true);
    expect(coverage.has(toPosKey(4, 3))).toBe(true);
  });

  it('should not flood through empty cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    // gap at 4,3
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE });

    const coverage = new Set<string>();
    bfsRoadNetworkFlood(grid, 3, 3, coverage);

    expect(coverage.has(toPosKey(3, 3))).toBe(true);
    expect(coverage.has(toPosKey(5, 3))).toBe(false); // disconnected
  });

  it('should flood through infrastructure positions', () => {
    const grid = makeGrid(10, 10);
    const infra = new Set([toPosKey(3, 3), toPosKey(4, 3)]);

    const coverage = new Set<string>();
    bfsRoadNetworkFlood(grid, 3, 3, coverage, infra);

    expect(coverage.has(toPosKey(3, 3))).toBe(true);
    expect(coverage.has(toPosKey(4, 3))).toBe(true);
  });

  it('should accumulate into existing coverage set', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(2, 2, { roadType: RoadType.TWO_LANE });
    grid.setCell(7, 7, { roadType: RoadType.TWO_LANE });

    const coverage = new Set<string>();
    bfsRoadNetworkFlood(grid, 2, 2, coverage);
    bfsRoadNetworkFlood(grid, 7, 7, coverage);

    expect(coverage.has(toPosKey(2, 2))).toBe(true);
    expect(coverage.has(toPosKey(7, 7))).toBe(true);
  });

  it('should skip already-covered cells', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE });

    const coverage = new Set<string>();
    coverage.add(toPosKey(3, 3)); // pre-covered
    bfsRoadNetworkFlood(grid, 3, 3, coverage);

    // Should still have both since start was already covered, it skips immediately
    expect(coverage.size).toBe(1); // only the pre-existing one
  });
});

describe('bfsBudgetDrainFlood', () => {
  it('should mark cells as supplied while draining budget', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });

    const supplied = new Set<string>();
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) return 10;
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand);

    expect(supplied.has(toPosKey(3, 3))).toBe(true);
    expect(supplied.has(toPosKey(4, 3))).toBe(true);
  });

  it('should stop supplying when budget runs out', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });
    grid.setCell(5, 3, { roadType: RoadType.TWO_LANE, buildingId: 101 });

    const supplied = new Set<string>();
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) return 80;
      if (x === 5 && y === 3) return 80;
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand);

    expect(supplied.has(toPosKey(3, 3))).toBe(true);
    expect(supplied.has(toPosKey(4, 3))).toBe(true);
    // 5,3 requires 80 but only 20 left, so not supplied
    expect(supplied.has(toPosKey(5, 3))).toBe(false);
  });

  it('should skip cells already in supplied set', () => {
    const grid = makeGrid(10, 10);
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 3, { roadType: RoadType.TWO_LANE, buildingId: 100 });

    const supplied = new Set<string>();
    supplied.add(toPosKey(4, 3)); // already supplied by another plant

    let demandCalls = 0;
    const getDemand = (x: number, y: number) => {
      if (x === 4 && y === 3) { demandCalls++; return 50; }
      return 0;
    };

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand);

    // Should not drain budget for already-supplied cells
    expect(demandCalls).toBe(0);
  });

  it('should accept infra positions for relay', () => {
    const grid = makeGrid(10, 10);
    const infra = new Set([toPosKey(3, 3), toPosKey(4, 3)]);

    const supplied = new Set<string>();
    const getDemand = () => 0;

    bfsBudgetDrainFlood(grid, { x: 3, y: 3, output: 100 }, supplied, getDemand, infra);

    expect(supplied.has(toPosKey(3, 3))).toBe(true);
    expect(supplied.has(toPosKey(4, 3))).toBe(true);
  });
});
