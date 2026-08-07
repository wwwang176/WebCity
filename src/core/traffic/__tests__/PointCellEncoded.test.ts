import { describe, it, expect } from 'vitest';
import { LaneGraphBuffer } from '../LaneGraphBuffer';
import { LaneGraph } from '../LaneGraph';

/**
 * findPathVariants sweeps every point in the graph, once per route, per request,
 * and only ever needs each point's cell. getPoint allocates an 8-field object
 * and performs eight DataView reads to deliver that. On a 3000-tile road network
 * (24k-48k points) at 100 requests per flush, that is millions of allocations
 * per batch in the pathfinding worker (BUG-112).
 *
 * getPointCellEncoded must agree with getPoint exactly — this is the property
 * that keeps the optimisation honest.
 */
describe('getPointCellEncoded matches getPoint', () => {
  it('should encode the same cell for every point in a real graph', () => {
    const graph = new LaneGraph();
    const cells = ['1,1', '2,1', '3,1', '3,2', '3,3'];
    const cellSet = new Set(cells);
    graph.buildFromGrid({
      getCellByKey: (key: string) => (cellSet.has(key) ? { roadType: 2, roadFlags: 15 } : null),
      getCompatibleNeighborKeys: (_s: string, nx: number, ny: number) => {
        const k = `${nx},${ny}`;
        return cellSet.has(k) ? [k] : [];
      },
    }, cells);

    const buffer = new LaneGraphBuffer(4096, 8192);
    buffer.writeFromGraph(graph);
    const reader = buffer.createReader();

    const count = reader.getPointCount();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const p = reader.getPoint(i);
      expect(reader.getPointCellEncoded(i)).toBe(p.cellX * 65536 + p.cellY);
    }
  });

  it('should handle a cell at the top of the uint16 range', () => {
    const buffer = new LaneGraphBuffer(16, 16);
    const reader = buffer.createReader();
    // Index 0 of an untouched buffer is all zeros — still must agree.
    expect(reader.getPointCellEncoded(0)).toBe(
      reader.getPoint(0).cellX * 65536 + reader.getPoint(0).cellY,
    );
  });
});
