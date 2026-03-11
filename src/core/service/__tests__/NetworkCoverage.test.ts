import { describe, it, expect } from 'vitest';
import { calculateNetworkCoverage } from '../NetworkCoverage';
import { Grid } from '../../grid/Grid';
import { toPosKey } from '../../grid/GridHelpers';
import { RoadType } from '../../road/types';

function makeGrid(w: number, h: number): Grid {
  return new Grid(w, h);
}

describe('calculateNetworkCoverage', () => {
  it('should cover cells within Euclidean radius', () => {
    const grid = makeGrid(30, 30);
    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 15, 15, 5, 2, coverage);

    // Center should be covered
    expect(coverage.has(toPosKey(15, 15))).toBe(true);
    // Cell at distance 3 should be covered
    expect(coverage.has(toPosKey(18, 15))).toBe(true);
    // Cell at distance 5 (exactly on edge) should be covered
    expect(coverage.has(toPosKey(20, 15))).toBe(true);
  });

  it('should not cover cells outside Euclidean radius without relay', () => {
    const grid = makeGrid(30, 30);
    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 15, 15, 5, 2, coverage);

    // Cell at distance 6 with no road relay should NOT be covered
    expect(coverage.has(toPosKey(21, 15))).toBe(false);
  });

  it('should relay coverage through road cells on the edge', () => {
    const grid = makeGrid(30, 30);
    // Place a road at the circle edge
    grid.setCell(20, 15, { roadType: RoadType.TWO_LANE });
    // And roads extending beyond the edge
    grid.setCell(21, 15, { roadType: RoadType.TWO_LANE });
    grid.setCell(22, 15, { roadType: RoadType.TWO_LANE });

    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 15, 15, 5, 2, coverage);

    // Road relay should extend coverage beyond the radius
    expect(coverage.has(toPosKey(21, 15))).toBe(true);
    expect(coverage.has(toPosKey(22, 15))).toBe(true);
  });

  it('should relay through buildings (non-zero buildingId) on the edge', () => {
    const grid = makeGrid(30, 30);
    // Place a building on the circle edge
    grid.setCell(20, 15, { buildingId: 100 });
    grid.setCell(21, 15, { buildingId: 101 });

    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 15, 15, 5, 2, coverage);

    expect(coverage.has(toPosKey(21, 15))).toBe(true);
  });

  it('should relay through infrastructure positions', () => {
    const grid = makeGrid(30, 30);
    const infra = new Set<string>([toPosKey(20, 15), toPosKey(21, 15)]);

    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 15, 15, 5, 2, coverage, infra);

    expect(coverage.has(toPosKey(21, 15))).toBe(true);
  });

  it('should accumulate coverage across multiple calls', () => {
    const grid = makeGrid(30, 30);
    const coverage = new Set<string>();

    calculateNetworkCoverage(grid, 5, 5, 3, 1, coverage);
    calculateNetworkCoverage(grid, 20, 20, 3, 1, coverage);

    expect(coverage.has(toPosKey(5, 5))).toBe(true);
    expect(coverage.has(toPosKey(20, 20))).toBe(true);
  });

  it('should not cover cells outside grid bounds', () => {
    const grid = makeGrid(10, 10);
    const coverage = new Set<string>();
    calculateNetworkCoverage(grid, 0, 0, 5, 2, coverage);

    // Cells at negative coords should not be in coverage
    expect(coverage.has(toPosKey(-1, 0))).toBe(false);
    expect(coverage.has(toPosKey(0, -1))).toBe(false);
  });
});
