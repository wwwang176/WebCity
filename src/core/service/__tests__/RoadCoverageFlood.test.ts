import { describe, it, expect } from 'vitest';
import {
  roadTileCost,
  roadFlood,
  expandCoverageToBuildings,
  RoadCoverageMap,
  ROAD_COVERAGE,
  roadDistanceToTargets,
} from '../RoadCoverageFlood';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';
import type { SizedGrid } from '../../grid/GridHelpers';

// ── Test helpers ────────────────────────────────────────────────────

/** Create a simple grid from a 2D array of RoadType values. */
function makeGrid(rows: number[][]): SizedGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height,
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

/**
 * 「一定夠用」的預算，給那些不是在測預算上限的案例。
 *
 * 這些測試原本寫死 100（舊浮點成本制下約 50 格二線道）。成本整數化後
 * （見 core/road/roadCost.ts）同樣的涵蓋範圍是 100 × 18 —— 尺度換算，
 * 每一條測試的語意都沒變。
 */
const AMPLE_BUDGET = 1800;

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
    const result = roadFlood(grid, [{ x: 1, y: 1 }], AMPLE_BUDGET);
    expect(result.size).toBe(0);
  });

  it('seeds from adjacent road cells at cost 0', () => {
    // Facility at (1,1), road at (2,1)
    const grid = makeGrid([
      [_, _, _],
      [_, _, R],
      [_, _, _],
    ]);
    const result = roadFlood(grid, [{ x: 1, y: 1 }], AMPLE_BUDGET);
    expect(result.get(toPosKey(2, 1))).toBe(0);
  });

  it('expands along a straight road', () => {
    // Facility at (0,0), road going east: (1,0) (2,0) (3,0) (4,0)
    const grid = makeGrid([
      [_, R, R, R, R],
    ]);
    const result = roadFlood(grid, [{ x: 0, y: 0 }], AMPLE_BUDGET);
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
    const budget = 180; // 舊制 10 × 18

    const ruralResult = roadFlood(makeGrid([ruralRow]), [{ x: 0, y: 0 }], budget);
    const hwResult = roadFlood(makeGrid([hwRow]), [{ x: 0, y: 0 }], budget);

    expect(hwResult.size).toBeGreaterThan(ruralResult.size);
  });

  it('does not cross gaps in road network', () => {
    // Road — gap — road
    const grid = makeGrid([
      [_, R, R, _, R, R],
    ]);
    const result = roadFlood(grid, [{ x: 0, y: 0 }], AMPLE_BUDGET);
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
    const result = roadFlood(grid, [{ x: 0, y: 0 }], AMPLE_BUDGET);
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
    const result = roadFlood(grid, positions, AMPLE_BUDGET);
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
    const result = roadFlood(grid2, [{ x: 0, y: 1 }], AMPLE_BUDGET);
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

  it('covers the inner ring (2 tiles from a road) by default', () => {
    // Road at (2,2) in a 5x5 grid. Default reach=ZONE_ROAD_REACH (=2) covers
    // every non-road cell within the 5×5 Chebyshev box around the road tile.
    const grid = makeGrid([
      [_, _, _, _, _],
      [_, _, _, _, _],
      [_, _, R, _, _],
      [_, _, _, _, _],
      [_, _, _, _, _],
    ]);
    const roadCov = new Map([[toPosKey(2, 2), 0]]);
    const result = expandCoverageToBuildings(grid, roadCov);
    // Chebyshev 2 includes the outer corners of the 5x5 box
    expect(result.has(toPosKey(0, 0))).toBe(true);
    expect(result.has(toPosKey(4, 4))).toBe(true);
    // And the orthogonally-adjacent cells (reach 1)
    expect(result.has(toPosKey(2, 3))).toBe(true);
    expect(result.has(toPosKey(3, 2))).toBe(true);
    // Total = 5×5 = 25 cells (1 road + 24 buildings)
    expect(result.size).toBe(25);
  });

  it('reach=1 override recovers legacy Chebyshev-1 behaviour', () => {
    // Same road tile, but with reach=1 we only pick up the 3×3 box.
    const grid = makeGrid([
      [_, _, _, _, _],
      [_, _, _, _, _],
      [_, _, R, _, _],
      [_, _, _, _, _],
      [_, _, _, _, _],
    ]);
    const roadCov = new Map([[toPosKey(2, 2), 0]]);
    const result = expandCoverageToBuildings(grid, roadCov, 1);
    expect(result.has(toPosKey(1, 1))).toBe(true); // diagonal at reach 1
    expect(result.has(toPosKey(0, 0))).toBe(false); // reach 2 — excluded
    expect(result.size).toBe(9); // 3×3 box: 1 road + 8 buildings
  });

  it('inner-ring cells inherit the minimum cost across all reaching road tiles', () => {
    // Two road tiles 2 cells apart. The building between them at Chebyshev 1
    // from each should take the lower of the two costs.
    const grid = makeGrid([
      [_, _, _, _, _],
      [_, R, _, R, _],
      [_, _, _, _, _],
    ]);
    const roadCov = new Map([
      [toPosKey(1, 1), 10],
      [toPosKey(3, 1), 3],
    ]);
    const result = expandCoverageToBuildings(grid, roadCov);
    expect(result.get(toPosKey(2, 1))).toBe(3); // min of 10 and 3
    expect(result.get(toPosKey(2, 0))).toBe(3); // both reach via Chebyshev 2
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
    map.recalculate([{ x: 0, y: 1 }], grid, AMPLE_BUDGET);
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
    map.recalculate([{ x: 0, y: 0 }], grid, AMPLE_BUDGET);
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
      grid, AMPLE_BUDGET,
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
    map.recalculate([{ x: 0, y: 0 }], grid, AMPLE_BUDGET, 2, 2);
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
    map.recalculate([{ x: 0, y: 0 }], grid, AMPLE_BUDGET);
    // Road exists but not adjacent to facility
    expect(map.hasCoverage(2, 2)).toBe(false);
  });

  it('preview returns coverage for a temporary position', () => {
    const grid = makeGrid([
      [_, R, R, R],
    ]);
    const map = new RoadCoverageMap();
    const preview = map.preview({ x: 0, y: 0 }, grid, AMPLE_BUDGET);
    expect(preview.has(toPosKey(1, 0))).toBe(true);
    expect(preview.has(toPosKey(3, 0))).toBe(true);
    // Main map untouched
    expect(map.hasCoverage(1, 0)).toBe(false);
  });

  it('previewMerged merges new preview with existing coverage', () => {
    // Road: (1,0) (2,0) (3,0) (4,0) (5,0)
    const grid = makeGrid([
      [_, R, R, R, R, R, _],
    ]);
    const map = new RoadCoverageMap();
    // Existing facility at (0,0) covers left part of road
    map.recalculate([{ x: 0, y: 0 }], grid, AMPLE_BUDGET);
    expect(map.hasCoverage(1, 0)).toBe(true);

    // Preview new facility at (6,0) — covers right part of road
    const merged = map.previewMerged({ x: 6, y: 0 }, grid, AMPLE_BUDGET);
    // Should include existing coverage
    expect(merged.has(toPosKey(1, 0))).toBe(true);
    // Should include new preview coverage
    expect(merged.has(toPosKey(5, 0))).toBe(true);
    // Should take min cost where both overlap (e.g. middle cell)
    const existingCost = map.getCost(3, 0);
    expect(merged.get(toPosKey(3, 0))!).toBeLessThanOrEqual(existingCost);
    // Main map internal state untouched (getCoverageCount unchanged)
    expect(map.getCoverageCount(1, 0)).toBe(1);
  });

  it('recalculate clears previous state', () => {
    const grid = makeGrid([
      [_, R, R],
    ]);
    const map = new RoadCoverageMap();
    map.recalculate([{ x: 0, y: 0 }], grid, AMPLE_BUDGET);
    expect(map.hasCoverage(1, 0)).toBe(true);
    // Recalculate with no facilities
    map.recalculate([], grid, AMPLE_BUDGET);
    expect(map.hasCoverage(1, 0)).toBe(false);
  });

  it('recalculate with top-left matches preview for 2x2 facility', () => {
    // 2x2 facility at top-left (1,1), road along row 0
    //   R R R R R
    //   _ F F _ _
    //   _ F F _ _
    const grid = makeGrid([
      [R, R, R, R, R],
      [_, _, _, _, _],
      [_, _, _, _, _],
    ]);
    const map = new RoadCoverageMap();
    const topLeft = { x: 1, y: 1 };
    const budget = ROAD_COVERAGE.POLICE_BUDGET;

    // preview uses top-left (as Game.ts passes mouse position)
    const previewCov = map.preview(topLeft, grid, budget, 2, 2);

    // recalculate also uses top-left (after the fix)
    map.recalculate([topLeft], grid, budget, 2, 2);
    const recalcCov = map.getCoveredCells();

    // Both should produce equivalent coverage maps (quantization may introduce small rounding)
    expect(recalcCov.size).toBe(previewCov.size);
    for (const [key, cost] of previewCov) {
      expect(recalcCov.get(key)).toBeCloseTo(cost, 0);
    }
  });

  it('recalculate with center (old bug) gives DIFFERENT coverage than preview', () => {
    // Demonstrates the bug: if we stored center instead of top-left,
    // expandFootprint would shift the flood origin
    const grid = makeGrid([
      [R, R, R, R, R],
      [_, _, _, _, _],
      [_, _, _, _, _],
    ]);
    const map = new RoadCoverageMap();
    const topLeft = { x: 1, y: 1 };
    const center = { x: 2, y: 2 }; // getInfraCenter for 2x2 = topLeft + (1,1)
    const budget = ROAD_COVERAGE.POLICE_BUDGET;

    const previewCov = map.preview(topLeft, grid, budget, 2, 2);
    map.recalculate([center], grid, budget, 2, 2);
    const centerCov = map.getCoveredCells();

    // Center-based coverage is different (the old bug)
    // Center (2,2) expands to (2,2)(3,2)(2,3)(3,3) — row 0 road only adjacent to column 2,3
    // vs top-left (1,1) expands to (1,1)(2,1)(1,2)(2,2) — row 0 road adjacent to column 1,2
    expect(centerCov.size).not.toBe(previewCov.size);
  });
});

// ── roadDistanceToTargets ─────────────────────────────────────────

describe('roadDistanceToTargets', () => {
  it('home and target sharing a road segment within reach have cost 0 (inner-ring model)', () => {
    // Home at (0,0), target at (3,0), road: (1,0) (2,0).
    // Under the Chebyshev-2 inner-ring model both endpoints attach directly to
    // the same road segment, so no traversal is needed and cost = 0.
    const grid = makeGrid([
      [_, R, R, _],
    ]);
    const result = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(['3,0']), AMPLE_BUDGET);
    expect(result.has('3,0')).toBe(true);
    expect(result.get('3,0')!).toBe(0);
  });

  it('returns Dijkstra traversal cost when home and target attach to different road segments', () => {
    // Home at (1,1), road along y=1 from x=3 to x=4, target building at (6,1).
    // Home's Chebyshev-2 seed reaches (3,1); Dijkstra walks one hop to (4,1);
    // checkNeighbors at (4,1) picks up target (6,1) via Chebyshev 2 ⇒ 1 road hop.
    const grid = makeGrid([
      [_, _, _, _, _, _, _],
      [_, _, _, R, R, _, _],
      [_, _, _, _, _, _, _],
    ]);
    const result = roadDistanceToTargets(grid, { x: 1, y: 1 }, new Set(['6,1']), AMPLE_BUDGET);
    expect(result.has('6,1')).toBe(true);
    expect(result.get('6,1')!).toBeCloseTo(roadTileCost(R), 5);
  });

  it('returns empty for unreachable target (road gap)', () => {
    // Home at (0,0), road at (1,0), gap at (2,0), road at (3,0), target at (4,0)
    const grid = makeGrid([
      [_, R, _, R, _],
    ]);
    const result = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(['4,0']), AMPLE_BUDGET);
    expect(result.has('4,0')).toBe(false);
  });

  it('budget limits reachable targets', () => {
    // Long road, tight budget
    const row = [_, ...Array(20).fill(R), _] as number[];
    const grid = makeGrid([row]);
    const tileCost = roadTileCost(R);
    const budget = tileCost * 3; // afford ~3 tiles of expansion
    // Near target at col 4 (3 road steps) vs far target at col 20
    const result = roadDistanceToTargets(
      grid, { x: 0, y: 0 },
      new Set([toPosKey(4, 0), toPosKey(21, 0)]),
      budget,
    );
    expect(result.has(toPosKey(4, 0))).toBe(true);
    expect(result.has(toPosKey(21, 0))).toBe(false);
  });

  it('highway costs less than rural for a long traversal', () => {
    // Long road so seed-pickup can't collapse to 0 — home seeds x≤2, target
    // picks up from road cells near x=10, forcing Dijkstra across the whole span.
    const mkRow = (rt: number) =>
      [_, rt, rt, rt, rt, rt, rt, rt, rt, rt, rt, _] as number[];
    const ruralGrid = makeGrid([mkRow(RU)]);
    const hwGrid = makeGrid([mkRow(H)]);
    const target = new Set(['11,0']);
    const ruralResult = roadDistanceToTargets(ruralGrid, { x: 0, y: 0 }, target, 1000);
    const hwResult = roadDistanceToTargets(hwGrid, { x: 0, y: 0 }, target, 1000);
    expect(ruralResult.get('11,0')!).toBeGreaterThan(0);
    expect(hwResult.get('11,0')!).toBeGreaterThan(0);
    expect(hwResult.get('11,0')!).toBeLessThan(ruralResult.get('11,0')!);
  });

  it('home not on road — seeds from adjacent road cells', () => {
    // Home at (1,1) surrounded by roads
    const grid = makeGrid([
      [_, R, _],
      [R, _, R],
      [_, R, _],
    ]);
    const result = roadDistanceToTargets(grid, { x: 1, y: 1 }, new Set(['0,0']), AMPLE_BUDGET);
    // (0,0) is not a road and not adjacent to a covered road... let's use a reachable target
    // Actually (0,0) is _ and adjacent to (1,0)=R and (0,1)=R, so it IS reachable as a building neighbor
    expect(result.has('0,0')).toBe(true);
  });

  it('target not on road — found via adjacent road cell', () => {
    // Road from (1,0) to (3,0), target building at (4,0) not on road
    const grid = makeGrid([
      [_, R, R, R, _],
    ]);
    const result = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(['4,0']), AMPLE_BUDGET);
    expect(result.has('4,0')).toBe(true);
  });

  it('stops early when all targets found', () => {
    // Two close targets, should not need to explore entire grid
    const grid = makeGrid([
      [_, R, R, R, R, R, R, R, R, R],
    ]);
    const targets = new Set([toPosKey(2, 0), toPosKey(3, 0)]);
    const result = roadDistanceToTargets(grid, { x: 0, y: 0 }, targets, 1000);
    expect(result.size).toBe(2);
    expect(result.has(toPosKey(2, 0))).toBe(true);
    expect(result.has(toPosKey(3, 0))).toBe(true);
  });

  it('returns empty map for empty targets', () => {
    const grid = makeGrid([[_, R, R]]);
    const result = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(), AMPLE_BUDGET);
    expect(result.size).toBe(0);
  });
});
