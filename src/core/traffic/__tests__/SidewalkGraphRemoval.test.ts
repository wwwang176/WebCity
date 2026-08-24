import { describe, it, expect } from 'vitest';
import { SidewalkGraph, type GridLookup } from '../SidewalkGraph';
import { RoadType, RoadDirection } from '../../road/types';

/**
 * The graph must contain no edge pointing at a node that no longer exists.
 *
 * Edges are stored in both directions: `a->b` in a's adjacency list and `b->a` in b's. Deleting
 * b must delete a's copy too, otherwise A* still walks it and pedestrians walk on a pavement
 * that no longer exists.
 *
 * Matching the reverse edge by rebuilding `${to.id}->${nodeId}` never hits, because a real edge
 * id is `${type}|${roadTypes}:${from}->${to}` (BUG-159 and BUG-160 folded the kind and the road
 * widths into it), so the `findIndex` matches nothing.
 *
 * It is normally invisible because `updateCells` razes and rebuilds the changed cell's four
 * neighbours, taking those stale edges with it. But its rebuild covers the changed cell plus
 * one ring, while the holder of a stale edge can be two cells away, and adjacency lists beyond
 * that ring are never cleared.
 */

interface Cell { roadType: number; roadFlags: number; buildingId: number }

function eastWestRoad(): {
  graph: SidewalkGraph;
  /** Builds a road at (x, y) and recomputes only that cell. */
  buildRoadAt(x: number, y: number): void;
  /** Rebuilds the whole graph, optionally excluding some cells from this pass. */
  rebuildAll(exclude?: string[]): void;
} {
  const cells = new Map<string, Cell>();
  const put = (x: number, y: number) =>
    cells.set(`${x},${y}`, { roadType: RoadType.TWO_LANE, roadFlags: 0, buildingId: 0 });

  for (let x = 3; x <= 9; x++) put(x, 10);

  const relink = () => {
    for (const [key, cell] of cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const at = (dx: number, dy: number) => cells.get(`${x + dx},${y + dy}`);
      let f = 0;
      if (at(0, -1)) f |= RoadDirection.NORTH;
      if (at(0, 1)) f |= RoadDirection.SOUTH;
      if (at(1, 0)) f |= RoadDirection.EAST;
      if (at(-1, 0)) f |= RoadDirection.WEST;
      cell.roadFlags = f;
    }
  };
  relink();

  const lookup: GridLookup = { getCell: (x, y) => cells.get(`${x},${y}`) ?? null };
  const graph = new SidewalkGraph();
  graph.buildFromGrid(lookup, [...cells.keys()], []);

  return {
    graph,
    buildRoadAt(x, y) {
      put(x, y);
      relink();
      graph.updateCells(lookup, [`${x},${y}`]);
    },
    rebuildAll(exclude = []) {
      const skip = new Set(exclude);
      graph.buildFromGrid(lookup, [...cells.keys()].filter(k => !skip.has(k)), []);
    },
  };
}

/** Edges pointing at nodes no longer in the graph. */
function danglingEdges(graph: SidewalkGraph): string[] {
  const out: string[] = [];
  for (const node of graph.getAllNodes()) {
    for (const e of graph.getEdgesFrom(node.id)) {
      if (!graph.getNode(e.to.id)) out.push(e.id);
    }
  }
  return out;
}

describe('人行道圖的殘邊', () => {
  it('should start out with no dangling edges', () => {
    const { graph } = eastWestRoad();
    expect(danglingEdges(graph), '剛建好就有殘邊').toHaveLength(0);
  });

  it('should leave no dangling edge when a node disappears', () => {
    // Building a road at (7,9) puts a road on (7,10)'s north side, so that side's sidewalk
    // node disappears. The recompute covers (7,9) plus one ring and does not reach (6,10) two
    // cells away, whose edge pointing at (7,10):NW is left uncleaned.
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);

    expect(
      danglingEdges(city.graph),
      '有邊指向已經不存在的節點 —— A* 走得過去，行人走在不存在的人行道上',
    ).toHaveLength(0);
  });

  it('should not report edge ids that no longer exist', () => {
    // The retirement sweep uses these ids to decide whether a route still exists. A dead id
    // left in means pedestrians who should retire do not.
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);

    const live = city.graph.getEdgeIds();
    const real = new Set(city.graph.getAllEdges().map(e => e.id));
    for (const id of live) {
      expect(real.has(id), `getEdgeIds 回報了一條已經不存在的邊：${id}`).toBe(true);
    }
    expect(live.size, 'getEdgeIds 與實際的邊對不起來').toBe(real.size);
  });

  it('should still match after a full rebuild', () => {
    // The id set is maintained incrementally, so a full rebuild must reset it too; otherwise
    // the previous generation's ids remain and the retirement sweep believes roads that no
    // longer exist are still there.
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);
    // Rebuild into a smaller graph: rebuilding the same layout produces identical ids and
    // shows nothing about whether it was cleared.
    city.rebuildAll(['9,10', '8,10']);

    const live = city.graph.getEdgeIds();
    const real = new Set(city.graph.getAllEdges().map(e => e.id));
    expect(live.size, '重建後 id 集合還混著上一代的邊').toBe(real.size);
    for (const id of live) expect(real.has(id), `殘留的舊 id：${id}`).toBe(true);
  });
});
