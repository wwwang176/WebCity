import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { roadDistanceToTargets } from '../RoadCoverageFlood';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * 目標現在會被摺成格子索引（`y * width + x`）再比對。**摺之前不擋界外的話，
 * 界外的座標會別名到另一格上** —— 寬 10 的地圖問 `"10,0"`，索引是 10，那是
 * `(0,1)`。於是查詢會把 `(0,1)` 當成目標，可能提早收工，而且回傳的鍵是
 * `"0,1)"` 那一格 —— 一個根本沒有人問的位置。
 *
 * 今天的呼叫端（工作地候選、市民的 workplaceId）都是從網格掃出來的，不會界外;
 * 這一組守的是壞掉的存檔與未來的呼叫端。
 */
const W = 10, H = 10;
const EW = RoadDirection.EAST | RoadDirection.WEST;

function city(): { grid: Grid; lookup: UnifiedRoadLookup } {
  const grid = new Grid(W, H);
  for (let x = 0; x < W; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  return { grid, lookup: UnifiedRoadLookup.fromGrid(grid) };
}

describe('界外的目標不會別名到別的格子', () => {
  it('should reach a normal in-bounds target', () => {
    // 反面對照 —— 沒有這一條，下面每一條都可能因為「什麼都查不到」而通過。
    const { grid, lookup } = city();
    const target = toPosKey(8, 0);

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([target]), 100_000, lookup);

    expect(got.get(target)).toBeGreaterThanOrEqual(0);
  });

  it('should not fold a target past the right edge onto the next row', () => {
    // `(W, 0)` 的線性索引 = W = `(0, 1)`。而 `(0,1)` 上有路，一定會被 settle。
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([`${W},0`]), 100_000, lookup);

    expect(got.has(`${W},0`), '界外的目標被說成到得了').toBe(false);
    expect(got.has(toPosKey(0, 1)), '回報了一個沒有人問的格子').toBe(false);
    expect(got.size).toBe(0);
  });

  it('should ignore a negative target instead of indexing before the array', () => {
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(['-1,3']), 100_000, lookup);

    expect(got.size).toBe(0);
  });

  it('should ignore a target below the grid', () => {
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([`3,${H}`]), 100_000, lookup);

    expect(got.size).toBe(0);
  });

  it('should still find the good targets when a bad one is mixed in', () => {
    // 界外的那一個被丟掉之後，早退的門檻要跟著降 —— 不然查詢會等一個永遠不會
    // 出現的命中，白跑滿整個預算（或反過來提早停，漏掉真的目標）。
    const { grid, lookup } = city();
    const good = toPosKey(8, 0);

    const got = roadDistanceToTargets(
      grid, { x: 0, y: 0 }, new Set([good, `${W},0`, '-5,-5']), 100_000, lookup);

    expect([...got.keys()]).toEqual([good]);
  });
});
