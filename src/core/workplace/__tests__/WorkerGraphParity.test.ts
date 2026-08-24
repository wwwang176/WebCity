import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const W = 12, H = 6;

/** See RoadCellGraph.test.ts. The topology is never written into an assertion. */
function testCity() {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < W; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 8; x++) cells.set(`${x},3`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,2', { roadType: RoadType.RURAL, roadFlags: NS });

  const grid = {
    width: W, height: H,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(this.getCell(x, y)!, x, y);
    },
  };

  const em = new ElevationManager();
  for (let x = 4; x <= 9; x++) {
    em.set(x, 1, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
      isRamp: x === 4 || x === 9,
      rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
    });
  }
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

function buildingCells(grid: { getCell(x: number, y: number): { roadType: number } | null }) {
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid.getCell(x, y)!.roadType === RoadType.NONE) out.push(`${x},${y}`);
    }
  }
  return out;
}

const BUDGET = 1080;

/**
 * The design's hard constraint: **what the worker computes must equal what the synchronous query
 * computes.**
 *
 * Both share one flood core, so this should stay green permanently; what it guards against is
 * someone writing a second copy in the worker for performance. The city has elevated roads, ramps
 * and **a mix of road types**: with one type throughout, forward and reverse happen to be equal,
 * which is how BUG-237 was missed.
 *
 * Checked with `.toBe`: costs are integers and addition commutes, so forward and reverse are
 * necessarily bit-identical. Under floating point this could not pass mathematically.
 */
describe('worker result equals the synchronous query', () => {
  it('should agree on every home → workplace cost, exactly', () => {
    const { grid, lookup } = testCity();
    const forward = buildRoadCellGraph(lookup);
    const transposed = transposeRoadCellGraph(forward);
    const cells = buildingCells(grid);
    const isBuilding = (x: number, y: number): boolean => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };

    let compared = 0;
    for (const wpKey of cells) {
      const [wx, wy] = wpKey.split(',').map(Number);
      const fromWorker = new Int32Array(grid.width * grid.height).fill(-1);
      reverseFloodFromGraph(
        transposed, { pos: wpKey, x: wx!, y: wy! }, BUDGET,
        grid.width, grid.height, isBuilding, fromWorker,
      );
      for (const homeKey of cells) {
        const [hx, hy] = homeKey.split(',').map(Number);
        const sync = roadDistanceToTargets(
          grid, { x: hx!, y: hy! }, new Set([wpKey]), BUDGET, lookup, forward,
        );
        const aRaw = fromWorker[hy! * grid.width + hx!]!;
        const a = aRaw < 0 ? undefined : aRaw;
        const b = sync.get(wpKey);
        if (b === undefined) {
          expect(a, `${homeKey} → ${wpKey}：同步說到不了，worker 說到得了`).toBeUndefined();
        } else {
          expect(a, `${homeKey} → ${wpKey}：成本不同`).toBe(b);
        }
        compared++;
      }
    }
    expect(compared, '一組都沒比到').toBeGreaterThan(100);
  });

  it('should disagree if given the forward graph instead of the transpose', () => {
    // Shows the transpose is not decoration. With a mix of road types, a reverse flood on the
    // forward graph gives a different answer, which is BUG-237.
    const { grid, lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const isBuilding = (x: number, y: number): boolean => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };
    const wp = { pos: '0,0', x: 0, y: 0 };
    const withTranspose = new Int32Array(grid.width * grid.height).fill(-1);
    reverseFloodFromGraph(transposeRoadCellGraph(g), wp, BUDGET,
      grid.width, grid.height, isBuilding, withTranspose);
    const withForward = new Int32Array(grid.width * grid.height).fill(-1);
    reverseFloodFromGraph(g, wp, BUDGET, grid.width, grid.height, isBuilding, withForward);
    expect([...withForward], '正向圖與轉置圖給出相同結果 —— fixture 的路型不夠混合')
      .not.toEqual([...withTranspose]);
  });
});
