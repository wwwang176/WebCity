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
 * 兩支水電 flood 改成走密集索引之後，**答案要一模一樣**。
 *
 * 這裡釘三件本來沒有東西守著的事:
 *
 * 1. **對照樸素實作。** 兩支 flood 的走訪順序決定了預算用完時誰有電，所以「集合
 *    相同」不夠 —— 參考實作用同一個鄰居順序與 FIFO，答案必須逐格相同。
 * 2. **地面快路徑。** `getCompatibleNeighborKeys` 有一條特化:來源在地面、鄰居
 *    沒有高架時直接判斷「是不是地面道路」。它**只在有掛 roadLookup 時才會走到**，
 *    而在這之前 `src/core/service/__tests__/` 底下沒有任何一個測試掛過 lookup ——
 *    那條路是完全沒有測試的。這裡每座城市都跑兩次:不掛 lookup（通用路徑）與掛
 *    一個沒有高架的 lookup（快路徑），兩者要相同。
 * 3. **高架仍然要算數。** 快路徑的判斷寫錯方向的話，橋就不導電了。
 */

/** mulberry32 —— 每台機器結果相同。 */
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

/** 一座隨機城市:道路、建築、只有分區的空地、以及一些空格。 */
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
        grid.setCell(x, y, { zoneType: ZoneType.INDUSTRIAL });   // 有分區、沒建築:收得到但不轉發
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
 * 樸素版的無預算 flood —— 直接照規則寫，字串鍵、每次都問整格。
 *
 * 刻意跟正式版用**同一個鄰居順序與 FIFO**:兩者的差別只該在資料結構上。
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

/** 樸素版的預算 flood。測資裡沒有多格建築，所以每一格自己結算。 */
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

/** 掛一個**沒有高架**的 lookup —— 那正是地面快路徑會被走到的情形。 */
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
    // 預算刻意調到會在中途用完 —— 全部供得起的話就照不出順序的差別。
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
 * 一條溝把地面切成兩半，只有一座帶匝道的高架橋跨得過去。
 *
 * `y = 5` 那一整列是空的，所以地面走不通。
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
  // 匝道在 y=4 與 y=6 上去/下來，橋身在 y=5。
  em.set(4, 4, 1, seg(withRamps, 0b0010));   // SOUTH 方向爬升
  em.set(4, 5, 1, seg(false, 0));
  em.set(4, 6, 1, seg(withRamps, 0b0001));   // NORTH 方向爬升
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

describe('高架仍然導電', () => {
  it('should not cross the gap on the ground', () => {
    // 前置條件:沒有橋的話兩邊本來就不通。這一條垮掉的話底下兩條什麼都沒驗。
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
    // 地面快路徑的判斷寫反的話，橋就不導電 —— 而全平地的城市一個測試都不會紅。
    const { grid, lookup } = cityWithBridge(true);
    const bits = new CoverageBits();
    bits.reset(12, 12);
    const scratch = new UtilityFloodScratch();
    scratch.beginPass(grid);
    bfsRoadNetworkFlood(grid, 3, 3, bits, scratch, lookup);

    expect(bits.has(5, 7), '有匝道的橋沒有把覆蓋帶過去').toBe(true);
  });

  it('should not carry coverage over a viaduct with no ramps', () => {
    // 沒有匝道就上不去。少了這一條，「把所有高架都當成通路」的實作也會過。
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
 * 電廠自己那一格上面有高架 —— 高架層也是來源。
 *
 * 地面完全孤立，所以唯一的出路是橋。少了「起點的高架層也要入列」那一步，
 * 覆蓋就只有電廠自己那一格，而全平地的城市一個測試都不會紅。
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
  em.set(4, 7, 1, seg(true, 0b0001));   // NORTH 方向爬升，往南下到地面
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
    // 付不起就不能供應、也不能導電 —— 那是 BUG-070 修的那件事。地面那條路有測試
    // 守著（`UtilityNetworkBfs`），高架那條沒有。
    const { grid, lookup } = cityWithBridge(true);
    // 橋中央那一格的地面很貴，剩下的預算付不起。
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
