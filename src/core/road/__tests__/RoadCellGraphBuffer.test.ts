import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph, levelOfKey, type RoadCellGraph } from '../RoadCellGraph';
import {
  serializeRoadCellGraph, deserializeRoadCellGraph, graphBufferNodeCount,
  GRAPH_BUFFER_VERSION, layoutOf,
} from '../RoadCellGraphBuffer';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;

/** See RoadCellGraph.test.ts. The topology is never written into an assertion. */
function testCity() {
  const w = 12, h = 6;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 8; x++) cells.set(`${x},3`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,2', { roadType: RoadType.RURAL, roadFlags: NS });

  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
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

/** A genuinely empty graph, showing that an empty graph's buffer is not 0 bytes. */
function emptyGraph(): RoadCellGraph {
  return {
    nodeKeys: [], indexOf: new Map(), offsets: new Uint32Array(1),
    targets: new Uint32Array(0), weights: new Uint16Array(0),
    nodeX: new Uint16Array(0), nodeY: new Uint16Array(0), nodeLevel: new Uint8Array(0),
  };
}

describe('RoadCellGraph serialization', () => {
  it('should round-trip every field exactly', () => {
    // A misaligned byte layout does not throw: it reads a run of Uint32 as Uint16 and produces
    // plausible-looking distances. So every field is compared.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));

    expect(back.nodeKeys).toEqual(g.nodeKeys);
    expect([...back.offsets]).toEqual([...g.offsets]);
    expect([...back.targets]).toEqual([...g.targets]);
    expect([...back.weights]).toEqual([...g.weights]);
    expect([...back.nodeX]).toEqual([...g.nodeX]);
    expect([...back.nodeY]).toEqual([...g.nodeY]);
    expect([...back.nodeLevel]).toEqual([...g.nodeLevel]);
  });

  it('should align every section to its element size, for any n and e', () => {
    // The layout's alignment is asserted directly rather than by running a fixture to see whether
    // it throws `RangeError`, which fails silently whenever the fixture's node count happens to
    // align: at n=26 and e=56 it already aligns, so removing the alignment turns nothing red.
    // A large sweep of (n, e) combinations catches any that do not align.
    for (let n = 0; n < 40; n++) {
      for (let e = 0; e < 40; e++) {
        const L = layoutOf(n, e);
        expect(L.oNodeX % 2, `n=${n} e=${e} nodeX 沒對齊`).toBe(0);
        expect(L.oNodeY % 2, `n=${n} e=${e} nodeY 沒對齊`).toBe(0);
        expect(L.oOffsets % 4, `n=${n} e=${e} offsets 沒對齊`).toBe(0);
        expect(L.oTargets % 4, `n=${n} e=${e} targets 沒對齊`).toBe(0);
        expect(L.oWeights % 2, `n=${n} e=${e} weights 沒對齊`).toBe(0);
        expect(L.total, `n=${n} e=${e} 總長度不足`)
          .toBeGreaterThanOrEqual(L.oWeights + e * 2);
      }
    }
  });

  it('should rebuild elevated keys from coordinates', () => {
    // Key strings are not serialised, to save a structured clone, so deserialisation has to
    // reassemble them, and an elevated key has a third segment.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));
    expect(back.nodeKeys.some(k => levelOfKey(k) > 0), '高架的 key 沒有帶樓層').toBe(true);
    for (let i = 0; i < back.nodeKeys.length; i++) {
      expect(back.indexOf.get(back.nodeKeys[i]!)).toBe(i);
    }
  });

  it('should report the node count without deserializing', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(graphBufferNodeCount(serializeRoadCellGraph(g))).toBe(g.nodeKeys.length);
  });

  it('should round-trip an empty graph, and report zero nodes', () => {
    // An empty graph's buffer has a header and a byteLength that is not 0. Any
    // `byteLength === 0` check misses it, and that is the condition guarding "do not send an
    // empty graph" on the cache side.
    const buf = serializeRoadCellGraph(emptyGraph());
    expect(buf.byteLength, '空圖的 buffer 不該是 0 bytes —— 它有 header')
      .toBeGreaterThan(0);
    expect(graphBufferNodeCount(buf)).toBe(0);
    expect(deserializeRoadCellGraph(buf).nodeKeys).toEqual([]);
  });

  it('should refuse a buffer with the wrong version', () => {
    const { lookup } = testCity();
    const buf = serializeRoadCellGraph(buildRoadCellGraph(lookup));
    new DataView(buf).setUint32(8, GRAPH_BUFFER_VERSION + 1, true);
    expect(() => deserializeRoadCellGraph(buf)).toThrow(/version/i);
  });
});
