import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { CoverageBits } from '../CoverageBits';
import { UtilityFloodScratch } from '../UtilityFloodScratch';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from '../NetworkCoverage';

/**
 * With both utility floods moved onto dense indices, **the answers must be identical**.
 *
 * Three things are pinned here:
 *
 * 1. **Against a naive implementation.** Traversal order decides who has power when the budget
 *    runs out, so equal sets are not enough. The reference uses the same neighbour order and
 *    FIFO, and the answers must match cell for cell.
 * 2. **The ground fast path.** `getCompatibleNeighborKeys` has a specialisation for a ground
 *    source with no elevated neighbour that simply asks whether the neighbour is a ground road.
 *    It **is only reached when a roadLookup is attached**, and no test under
 *    `src/core/service/__tests__/` attached one, leaving that path untested. Every city here runs
 *    twice — without a lookup (the general path) and with a lookup that has no elevated roads
 *    (the fast path) — and the two must agree.
 * 3. **Elevated roads still count.** With the fast path's condition inverted, bridges stop
 *    conducting.
 */

/** mulberry32, so results are identical on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 18, H = 14;

/** A random city: roads, buildings, zoned-but-empty plots, and some empty cells. */
function randomCity(seed: number): { grid: Grid; infra: Set<string> } {
  const r = rng(seed);
  const grid = new Grid(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const roll = r();
      if (roll < 0.30) {
        grid.setCell(x, y, { roadType: RoadType.TWO_LANE });
      } else if (roll < 0.55) {
        grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      } else if (roll < 0.75) {
        grid.setCell(x, y, { zoneType: ZoneType.INDUSTRIAL });   // zoned, no building: receives but does not relay
      }
    }
  }
  const infra = new Set<string>();
  for (let i = 0; i < 3; i++) {
    infra.add(toPosKey(Math.floor(r() * W), Math.floor(r() * H)));
  }
  return { grid, infra };
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * The naive unbudgeted flood, written straight from the rules with string keys and a full cell
 * lookup each time.
 *
 * Deliberately the **same neighbour order and FIFO** as the production version: the only
 * difference between them should be the data structures.
 */
function naiveNetworkFlood(
  grid: Grid, sx: number, sy: number, infra: Set<string>, coverage: Set<string>,
): void {
  const start = toPosKey(sx, sy);
  if (coverage.has(start)) return;
  const seen = new Set<string>([start]);
  const queue: Array<[number, number]> = [[sx, sy]];
  coverage.add(start);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head]!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      const key = toPosKey(nx, ny);
      if (seen.has(key)) continue;
      if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra.has(key)) {
        seen.add(key);
        coverage.add(key);
        queue.push([nx, ny]);
      } else if (cell.zoneType !== 0) {
        coverage.add(key);
      }
    }
  }
}

/** The naive budgeted flood. The fixtures have no multi-cell buildings, so every cell settles for
 *  itself. */
function naiveBudgetFlood(
  grid: Grid, plant: { x: number; y: number; output: number },
  supplied: Set<string>, getDemand: (x: number, y: number) => number, infra: Set<string>,
): void {
  let budget = plant.output;
  const start = toPosKey(plant.x, plant.y);
  const seen = new Set<string>([start]);
  const queue: Array<[number, number]> = [[plant.x, plant.y]];
  supplied.add(start);

  const trySupply = (x: number, y: number, key: string): boolean => {
    if (supplied.has(key)) return true;
    const demand = getDemand(x, y);
    if (demand > 0) {
      if (budget < demand) return false;
      budget -= demand;
    }
    supplied.add(key);
    return true;
  };

  for (let head = 0; head < queue.length; head++) {
    if (budget <= 0) break;
    const [x, y] = queue[head]!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      const key = toPosKey(nx, ny);
      if (seen.has(key)) continue;
      if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra.has(key)) {
        seen.add(key);
        if (!trySupply(nx, ny, key)) continue;
        queue.push([nx, ny]);
      } else if (cell.zoneType !== 0) {
        seen.add(key);
        trySupply(nx, ny, key);
      }
    }
  }
}

function sortedKeys(bits: CoverageBits): string[] {
  return [...bits.cells()].map(c => toPosKey(c.x, c.y)).sort();
}

/** A lookup with **no elevated roads**, which is exactly when the ground fast path is taken. */
function flatLookup(grid: Grid): UnifiedRoadLookup {
  return new UnifiedRoadLookup(grid, new ElevationManager());
}

const SEEDS = [1, 7, 42, 1234, 99991];
const PLANTS: ReadonlyArray<readonly [number, number]> = [[2, 2], [9, 7], [15, 11]];

describe('水電 flood 的密集版與樸素版逐格相同', () => {
  it.each(SEEDS)('should match the reference network flood (seed %i)', (seed) => {
    const { grid, infra } = randomCity(seed);

    const expected = new Set<string>();
    for (const [px, py] of PLANTS) naiveNetworkFlood(grid, px, py, infra, expected);

    for (const lookup of [null, flatLookup(grid)]) {
      const bits = new CoverageBits();
      bits.reset(W, H);
      const scratch = new UtilityFloodScratch();
      scratch.beginPass(grid, infra);
      for (const [px, py] of PLANTS) {
        bfsRoadNetworkFlood(grid, px, py, bits, scratch, lookup);
      }
      expect(sortedKeys(bits), lookup ? '掛了 lookup 的地面快路徑答案不同' : '不掛 lookup 的通用路徑答案不同')
        .toEqual([...expected].sort());
    }
    expect(expected.size, '這顆種子什麼都沒淹到 —— 測資沒有在驗東西').toBeGreaterThan(30);
  });

  it.each(SEEDS)('should match the reference budget flood (seed %i)', (seed) => {
    const { grid, infra } = randomCity(seed);
    // The budget is deliberately set to run out partway: with everything affordable, ordering
    // differences are invisible.
    const getDemand = (x: number, y: number) =>
      grid.getField(x, y, 'buildingId') > 0 ? 1 : 0;
    const plants = PLANTS.map(([x, y]) => ({ x, y, output: 18 }));

    const expected = new Set<string>();
    for (const p of plants) naiveBudgetFlood(grid, p, expected, getDemand, infra);

    for (const lookup of [null, flatLookup(grid)]) {
      const bits = new CoverageBits();
      bits.reset(W, H);
      const scratch = new UtilityFloodScratch();
      scratch.beginPass(grid, infra);
      for (const p of plants) bfsBudgetDrainFlood(grid, p, bits, getDemand, scratch, lookup);
      expect(sortedKeys(bits), lookup ? '掛了 lookup 的地面快路徑答案不同' : '不掛 lookup 的通用路徑答案不同')
        .toEqual([...expected].sort());
    }
    expect(expected.size, '預算沒有用完 —— 這顆種子照不出順序').toBeLessThan(W * H);
  });
});

/**
 * A gap splits the ground in two, crossed only by a viaduct with ramps.
 *
 * The whole `y = 5` row is empty, so nothing gets across at ground level.
 */
function cityWithBridge(withRamps: boolean): { grid: Grid; lookup: UnifiedRoadLookup } {
  const grid = new Grid(12, 12);
  for (const y of [3, 4, 6, 7]) {
    for (let x = 2; x <= 6; x++) grid.setCell(x, y, { roadType: RoadType.TWO_LANE });
  }
  grid.setCell(4, 7, { roadType: RoadType.TWO_LANE });
  grid.setCell(5, 7, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  const em = new ElevationManager();
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.TWO_LANE, roadFlags: 3, railType: 0, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  // Ramps up and down at y=4 and y=6, with the deck at y=5.
  em.set(4, 4, 1, seg(withRamps, 0b0010));   // ascending southwards
  em.set(4, 5, 1, seg(false, 0));
  em.set(4, 6, 1, seg(withRamps, 0b0001));   // ascending northwards
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

describe('高架仍然導電', () => {
  it('should not cross the gap on the ground', () => {
    // The premise: without a bridge the two sides are already disconnected. If this fails, the
    // two tests below check nothing.
    const grid = new Grid(12, 12);
    for (const y of [3, 4, 6, 7]) {
      for (let x = 2; x <= 6; x++) grid.setCell(x, y, { roadType: RoadType.TWO_LANE });
    }
    grid.setCell(5, 7, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const bits = new CoverageBits();
    bits.reset(12, 12);
    const scratch = new UtilityFloodScratch();
    scratch.beginPass(grid);
    bfsRoadNetworkFlood(grid, 3, 3, bits, scratch, flatLookup(grid));

    expect(bits.has(3, 3)).toBe(true);
    expect(bits.has(5, 7), '沒有橋卻走過去了').toBe(false);
  });

  it('should carry coverage over a viaduct with ramps', () => {
    // With the ground fast path's condition inverted, bridges stop conducting, and no test on a
    // flat city would turn red.
    const { grid, lookup } = cityWithBridge(true);
    const bits = new CoverageBits();
    bits.reset(12, 12);
    const scratch = new UtilityFloodScratch();
    scratch.beginPass(grid);
    bfsRoadNetworkFlood(grid, 3, 3, bits, scratch, lookup);

    expect(bits.has(5, 7), '有匝道的橋沒有把覆蓋帶過去').toBe(true);
  });

  it('should not carry coverage over a viaduct with no ramps', () => {
    // Without ramps there is no way up. Without this test, an implementation treating every
    // elevated road as passable would also pass.
    const { grid, lookup } = cityWithBridge(false);
    const bits = new CoverageBits();
    bits.reset(12, 12);
    const scratch = new UtilityFloodScratch();
    scratch.beginPass(grid);
    bfsRoadNetworkFlood(grid, 3, 3, bits, scratch, lookup);

    expect(bits.has(5, 7), '沒有匝道的橋也導電了').toBe(false);
  });
});

/**
 * An elevated road over the plant's own cell: the elevated level is a source too.
 *
 * The ground is entirely isolated, so the bridge is the only way out. Without seeding the start
 * position's elevated levels, coverage is the plant's own cell alone, and no test on a flat city
 * would turn red.
 */
function plantUnderViaduct(): { grid: Grid; lookup: UnifiedRoadLookup } {
  const grid = new Grid(12, 12);
  grid.setCell(4, 8, { roadType: RoadType.TWO_LANE });
  grid.setCell(5, 8, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  const em = new ElevationManager();
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.TWO_LANE, roadFlags: 3, railType: 0, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  em.set(4, 5, 1, seg(false, 0));
  em.set(4, 6, 1, seg(false, 0));
  em.set(4, 7, 1, seg(true, 0b0001));   // ascending northwards, descending south to the ground
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

describe('高架的兩個邊角', () => {
  it('should treat the elevated road over the plant as a source too', () => {
    const { grid, lookup } = plantUnderViaduct();
    const bits = new CoverageBits();
    bits.reset(12, 12);
    const scratch = new UtilityFloodScratch();
    scratch.beginPass(grid);
    bfsRoadNetworkFlood(grid, 4, 5, bits, scratch, lookup);

    expect(bits.has(4, 5), '前置條件:電廠自己那一格一定有').toBe(true);
    expect(bits.has(5, 8), '電廠頭上的高架沒有被當成來源').toBe(true);
  });

  it('should not relay through a cell it cannot afford, even on a viaduct', () => {
    // A cell that cannot be paid for is neither supplied nor relayed through — what BUG-070
    // fixed. The ground path has a test (`UtilityNetworkBfs`); the elevated one did not.
    const { grid, lookup } = cityWithBridge(true);
    // The cell at the middle of the bridge is expensive and the remaining budget cannot cover it.
    const getDemand = (x: number, y: number) => (x === 4 && y === 5 ? 100 : 0);

    const run = (output: number) => {
      const bits = new CoverageBits();
      bits.reset(12, 12);
      const scratch = new UtilityFloodScratch();
      scratch.beginPass(grid);
      bfsBudgetDrainFlood(grid, { x: 3, y: 3, output }, bits, getDemand, scratch, lookup);
      return bits;
    };

    expect(run(50).has(5, 7), '付不起橋中央那一格，卻還是把電送到對岸').toBe(false);
    expect(run(500).has(5, 7), '前置條件:付得起的時候要送得到').toBe(true);
  });
});
