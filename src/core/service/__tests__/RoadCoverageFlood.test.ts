import { describe, it, expect } from 'vitest';
import {
  roadTileCost,
  roadFlood,
  expandCoverageToBuildings,
  RoadCoverageMap,
  ROAD_COVERAGE,
} from '../RoadCoverageFlood';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';
import type { ReadableGrid } from '../../grid/GridHelpers';

// ── Test helpers ────────────────────────────────────────────────────

/** Create a simple grid from a 2D array of RoadType values. */
function makeGrid(rows: number[][]): ReadableGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: rows[y]![x]! };
    },
  };
}

const R = RoadType.TWO_LANE;
const H = RoadType.HIGHWAY;
const _ = RoadType.NONE;
const RU = RoadType.RURAL;
const F4 = RoadType.FOUR_LANE;

// ── roadTileCost ────────────────────────────────────────────────────

describe('roadTileCost', () => {
  it('returns Infinity for NONE road type', () => {
    expect(roadTileCost(RoadType.NONE)).toBe(Infinity);
  });

  it('returns finite positive cost for valid road types', () => {
    expect(roadTileCost(RoadType.TWO_LANE)).toBeGreaterThan(0);
    expect(roadTileCost(RoadType.TWO_LANE)).toBeLessThan(Infinity);
  });

  it('highway costs less than two-lane (faster + more lanes)', () => {
    expect(roadTileCost(RoadType.HIGHWAY)).toBeLessThan(roadTileCost(RoadType.TWO_LANE));
  });

  it('rural costs more than two-lane (slower)', () => {
    expect(roadTileCost(RoadType.RURAL)).toBeGreaterThan(roadTileCost(RoadType.TWO_LANE));
  });

  it('four-lane costs less than two-lane (more lanes)', () => {
    expect(roadTileCost(RoadType.FOUR_LANE)).toBeLessThan(roadTileCost(RoadType.TWO_LANE));
  });

  it('cost formula: BASE_COST / (speed * lanes/2)', () => {
    const cfg = ROAD_CONFIGS[RoadType.TWO_LANE];
    const expected = ROAD_COVERAGE.BASE_COST / (cfg.speedLimit * cfg.lanes / 2);
    expect(roadTileCost(RoadType.TWO_LANE)).toBeCloseTo(expected);
  });
});

// ── roadFlood ───────────────────────────────────────────────────────

describe('roadFlood', () => {
  it('returns empty map when no adjacent roads', () => {
    // Facility at (1,1), no roads anywhere
    const grid = makeGrid([
      [_, _, _],
      [_, _, _],
      [_, _, _],
    ]);
    const result = roadFlood(grid, [{ x: 1, y: 1 }], 100);
    expect(result.size).toBe(0);
  });

  it('seeds from adjacent road cells at cost 0', () => {
    // Facility at (1,1), road at (2,1)
    const grid = makeGrid([
      [_, _, _],
      [_, _, R],
      [_, _, _],
    ]);
    const result = roadFlood(grid, [{ x: 1, y: 1 }], 100);
    expect(result.get(toPosKey(2, 1))).toBe(0);
  });

  it('expands along a straight road', () => {
    // Facility at (0,0), road going east: (1,0) (2,0) (3,0) (4,0)
    const grid = makeGrid([
      [_, R, R, R, R],
    ]);
    const result = roadFlood(grid, [{ x: 0, y: 0 }], 100);
    expect(result.has(toPosKey(1, 0))).toBe(true);
    expect(result.has(toPosKey(4, 0))).toBe(true);
    // Cost increases with distance
    expect(result.get(toPosKey(2, 0))!).toBeGreaterThan(result.get(toPosKey(1, 0))!);
  });

  it('budget limits how far flood reaches', () => {
    // Long road, small budget
    const row = [_, ...Array(20).fill(R)] as number[];
    const grid = makeGrid([row]);
    const tileCost = roadTileCost(RoadType.TWO_LANE);
    const budget = tileCost * 3; // only afford ~3 tiles
    const result = roadFlood(grid, [{ x: 0, y: 0 }], budget);
    // Should reach tiles 1-4 (seed at 1 cost 0, then 3 more steps)
    expect(result.has(toPosKey(1, 0))).toBe(true);
    expect(result.has(toPosKey(4, 0))).toBe(true);
    // Should NOT reach tile 5 (that would be 4 steps × tileCost > budget)
    expect(result.has(toPosKey(5, 0))).toBe(false);
  });

  it('highway extends coverage further than rural with same budget', () => {
    const len = 30;
    const ruralRow = [_, ...Array(len).fill(RU)] as number[];
    const hwRow = [_, ...Array(len).fill(H)] as number[];
    const budget = 10;

    const ruralResult = roadFlood(makeGrid([ruralRow]), [{ x: 0, y: 0 }], budget);
    const hwResult = roadFlood(makeGrid([hwRow]), [{ x: 0, y: 0 }], budget);

    expect(hwResult.size).toBeGreaterThan(ruralResult.size);
  });

  it('does not cross gaps in road network', () => {
    // Road — gap — road
    const grid = makeGrid([
      [_, R, R, _, R, R],
    ]);
    const result = roadFlood(grid, [{ x: 0, y: 0 }], 100);
    expect(result.has(toPosKey(1, 0))).toBe(true);
    expect(result.has(toPosKey(2, 0))).toBe(true);
    // Disconnected segment not reachable
    expect(result.has(toPosKey(4, 0))).toBe(false);
    expect(result.has(toPosKey(5, 0))).toBe(false);
  });

  it('handles L-shaped road', () => {
    const grid = makeGrid([
      [_, R, R, R],
      [_, _, _, R],
      [_, _, _, R],
    ]);
    const result = roadFlood(grid, [{ x: 0, y: 0 }], 100);
    expect(result.has(toPosKey(3, 2))).toBe(true);
  });

  it('handles multiple facility cells (2x2 building)', () => {
    // 2x2 facility at (1,1)-(2,2), road at (3,1) and (3,2)
    const grid = makeGrid([
      [_, _, _, _],
      [_, _, _, R],
      [_, _, _, R],
      [_, _, _, _],
    ]);
    const positions = [
      { x: 1, y: 1 }, { x: 2, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const result = roadFlood(grid, positions, 100);
    expect(result.has(toPosKey(3, 1))).toBe(true);
    expect(result.has(toPosKey(3, 2))).toBe(true);
  });

  it('picks cheapest path when multiple routes exist', () => {
    // Two paths from (0,1) to (4,1):
    //   Top:    rural road (expensive)
    //   Bottom: highway (cheap)
    const grid = makeGrid([
      [_, RU, RU, RU, _],
      [_, R,  _,  _, R],
      [_, H,  H,  H, _],
    ]);
    // Facility at (0,1), connect both paths to road at (1,1)
    // Then road at (4,1) reachable via top or bottom
    // Actually let me make a proper grid:
    // Facility at (0,1), adj road at (1,1)
    // (1,1) connects north to (1,0) RU and south to (1,2) H
    // top path: (1,0)→(2,0)→(3,0) all RU
    // bottom: (1,2)→(2,2)→(3,2) all H
    // both converge at (4,1) via R
    const grid2 = makeGrid([
      [_, RU, RU, RU, _],
      [_, R,  _,  R,  _],
      [_, H,  H,  H,  _],
    ]);
    const result = roadFlood(grid2, [{ x: 0, y: 1 }], 100);
    // (3,0) reached via rural: cost = 0 + tileCost(R) + tileCost(RU)*2
    // (3,2) reached via highway: cost = 0 + tileCost(R) + tileCost(H)*2
    // highway should be cheaper
    const costRural = result.get(toPosKey(3, 0))!;
    const costHwy = result.get(toPosKey(3, 2))!;
    expect(costHwy).toBeLessThan(costRural);
  });
});

// ── expandCoverageToBuildings ───────────────────────────────────────

describe('expandCoverageToBuildings', () => {
  it('adds non-road neighbors of covered road cells', () => {
    const grid = makeGrid([
      [_, _, _],
      [_, R, _],
      [_, _, _],
    ]);
    const roadCov = new Map([[toPosKey(1, 1), 0]]);
    const result = expandCoverageToBuildings(grid, roadCov);
    // Road cell itself
    expect(result.has(toPosKey(1, 1))).toBe(true);
    // All 4 non-road neighbors
    expect(result.has(toPosKey(0, 1))).toBe(true);
    expect(result.has(toPosKey(2, 1))).toBe(true);
    expect(result.has(toPosKey(1, 0))).toBe(true);
    expect(result.has(toPosKey(1, 2))).toBe(true);
  });

  it('does not duplicate road cells already in coverage', () => {
    const grid = makeGrid([
      [R, R],
    ]);
    const roadCov = new Map([
      [toPosKey(0, 0), 0],
      [toPosKey(1, 0), 2],
    ]);
    const result = expandCoverageToBuildings(grid, roadCov);
    // Both road cells retain their original cost
    expect(result.get(toPosKey(0, 0))).toBe(0);
    expect(result.get(toPosKey(1, 0))).toBe(2);
  });

  it('picks lowest cost when building is adjacent to multiple road cells', () => {
    // Building at (1,0) adjacent to roads at (0,0) cost 0 and (2,0) cost 5
    const grid = makeGrid([
      [R, _, R],
    ]);
    const roadCov = new Map([
      [toPosKey(0, 0), 0],
      [toPosKey(2, 0), 5],
    ]);
    const result = expandCoverageToBuildings(grid, roadCov);
    expect(result.get(toPosKey(1, 0))).toBe(0); // min of adjacent road costs
  });

  it('does not include out-of-bounds cells', () => {
    const grid = makeGrid([
      [R],
    ]);
    const roadCov = new Map([[toPosKey(0, 0), 0]]);
    const result = expandCoverageToBuildings(grid, roadCov);
    // Only the road cell itself should be present (neighbors are out of bounds)
    expect(result.size).toBe(1);
  });
});

// ── RoadCoverageMap ─────────────────────────────────────────────────

describe('RoadCoverageMap', () => {
  it('hasCoverage returns false before recalculate', () => {
    const map = new RoadCoverageMap();
    expect(map.hasCoverage(0, 0)).toBe(false);
  });

  it('recalculate computes coverage from facilities', () => {
    // Facility at (0,1), road east: (1,1) (2,1) (3,1)
    const grid = makeGrid([
      [_, _, _, _],
      [_, R, R, R],
      [_, _, _, _],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 1 }], grid, 100);
    // Road cells covered
    expect(map.hasCoverage(1, 1)).toBe(true);
    expect(map.hasCoverage(3, 1)).toBe(true);
    // Adjacent non-road cells covered (building slots)
    expect(map.hasCoverage(1, 0)).toBe(true);
    expect(map.hasCoverage(1, 2)).toBe(true);
    // Far away = not covered
    expect(map.hasCoverage(10, 10)).toBe(false);
  });

  it('getCost returns cost for covered cells, Infinity for uncovered', () => {
    const grid = makeGrid([
      [_, R, R],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 0 }], grid, 100);
    expect(map.getCost(1, 0)).toBe(0); // seed
    expect(map.getCost(2, 0)).toBeGreaterThan(0); // 1 step
    expect(map.getCost(99, 99)).toBe(Infinity);
  });

  it('getCoverageCount counts overlapping facilities', () => {
    // Two facilities, both covering (2,0) via road
    const grid = makeGrid([
      [_, R, R, R, _],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      grid, 100,
    );
    expect(map.getCoverageCount(2, 0)).toBe(2);
  });

  it('recalculate with multi-cell facility (2x2)', () => {
    // 2x2 facility at (0,0), road at (2,0) going south
    const grid = makeGrid([
      [_, _, R],
      [_, _, R],
      [_, _, R],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 0 }], grid, 100, 2, 2);
    // (2,0) is adjacent to facility cell (1,0) → covered
    expect(map.hasCoverage(2, 0)).toBe(true);
    expect(map.hasCoverage(2, 2)).toBe(true);
  });

  it('no coverage when facility has no adjacent road', () => {
    const grid = makeGrid([
      [_, _, _],
      [_, _, _],
      [_, _, R],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 0 }], grid, 100);
    // Road exists but not adjacent to facility
    expect(map.hasCoverage(2, 2)).toBe(false);
  });

  it('preview returns coverage for a temporary position', () => {
    const grid = makeGrid([
      [_, R, R, R],
    ]);
    const map = new RoadCoverageMap();
    const preview = map.preview({ x: 0, y: 0 }, grid, 100);
    expect(preview.has(toPosKey(1, 0))).toBe(true);
    expect(preview.has(toPosKey(3, 0))).toBe(true);
    // Main map untouched
    expect(map.hasCoverage(1, 0)).toBe(false);
  });

  it('recalculate clears previous state', () => {
    const grid = makeGrid([
      [_, R, R],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 0 }], grid, 100);
    expect(map.hasCoverage(1, 0)).toBe(true);
    // Recalculate with no facilities
    map.recalculate([], grid, 100);
    expect(map.hasCoverage(1, 0)).toBe(false);
  });
});
