import { describe, it, expect } from 'vitest';
import { LaneGraphBuffer, GRAPH_HEADER_BYTES } from '../LaneGraphBuffer';
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
    // Written by hand, not read off an untouched buffer.
    //
    // The first version of this case built an empty LaneGraphBuffer and
    // compared index 0 against getPoint(0). Every byte was zero, so both sides
    // were 0 and the assertion held for ANY implementation — wrong offset,
    // wrong endianness, wrong stride, swapped fields, idx read as a byte index.
    // It also never went near 65535 despite its name.
    const graph = new LaneGraph();
    const cells = ['1,1', '2,1'];
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
    expect(reader.getPointCount()).toBeGreaterThan(0);

    // Stamp an extreme, ASYMMETRIC cell over point 0 and read it back. Asymmetry
    // is what catches a field swap; 65535/1 is what catches a signed read.
    const view = new DataView(buffer.getBuffer());
    const off = GRAPH_HEADER_BYTES; // point 0 starts right after the header
    view.setUint16(off + 8, 65535, true);
    view.setUint16(off + 10, 1, true);

    expect(reader.getPointCellEncoded(0)).toBe(65535 * 65536 + 1);
    const p = reader.getPoint(0);
    expect(p.cellX).toBe(65535);
    expect(p.cellY).toBe(1);
  });
});
