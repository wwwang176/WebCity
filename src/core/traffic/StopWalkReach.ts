import type { SidewalkGraph } from './SidewalkGraph';

/**
 * Which cells are walkable from a stop, and how far each is.
 *
 * This defines transit coverage. It measures along the sidewalk graph rather than drawing a
 * diamond on the map, and the difference is roads: pedestrians only cross at junctions, so a
 * cell across the street is a long walk. By straight-line distance it is two tiles, and the
 * simulation assigns households to the stop opposite, sends a pedestrian, and they have to
 * detour to a junction — the visible long way round is a dispatch error, not a pathfinding
 * one.
 *
 * It also excludes cells across a river or behind a row of buildings, which straight-line
 * distance likewise cannot see.
 */
export interface StopReach {
  /** Cells reachable from the stop at (x, y) within `maxDist`, mapped to their walk distance. */
  cellsWithin(x: number, y: number, maxDist: number): ReadonlyMap<string, number>;
}

/**
 * Walk distance in tiles from a stop to a cell. `Infinity` when unreachable or beyond
 * `maxDist`.
 *
 * Every stop-picking site uses this rather than computing its own distance: reachability can
 * have only one definition, otherwise scoring concludes a citizen cannot reach a stop while
 * dispatch sends them there anyway.
 */
export function walkDistanceToStop(
  reach: StopReach,
  stopX: number, stopY: number,
  x: number, y: number,
  maxDist: number,
): number {
  return reach.cellsWithin(stopX, stopY, maxDist).get(`${x},${y}`) ?? Infinity;
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * A bounded Dijkstra over the sidewalk graph, one per stop, retained once computed.
 *
 * The cache is necessary rather than an optimisation: the rebuild trigger
 * (`isTransferGraphDirty`) also fires when the player changes a route's vehicle count, which
 * has nothing to do with sidewalks. Without it, one click of +/- rewalks every stop in the
 * city.
 */
export class SidewalkStopReach implements StopReach {
  private readonly cache = new Map<string, ReadonlyMap<string, number>>();
  private syncedVersion: number;

  constructor(private readonly graph: SidewalkGraph) {
    this.syncedVersion = graph.version;
  }

  cellsWithin(x: number, y: number, maxDist: number): ReadonlyMap<string, number> {
    this.dropEverythingIfGraphMoved();
    const key = `${x},${y}|${maxDist}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const computed = this.walkOutwards(x, y, maxDist);
    this.cache.set(key, computed);
    return computed;
  }

  /**
   * Drops the stops these cells could have affected.
   *
   * Only stops close enough to the change need recomputing: a path is never shorter than the
   * straight line between its ends, so a cell further than `radius` in a straight line is
   * further on foot too and cannot fall inside the coverage.
   *
   * Calling this declares that the graph change has been handled, so it aligns the generation
   * as well. Without that, the next query is treated by the safety net as a whole-graph
   * replacement and discards everything, wasting the precise invalidation.
   */
  invalidateNear(changedCells: Iterable<string>, radius: number): void {
    this.syncedVersion = this.graph.version;
    if (this.cache.size === 0) return;

    const changed: Array<[number, number]> = [];
    for (const key of changedCells) {
      const comma = key.indexOf(',');
      if (comma < 0) continue;
      changed.push([Number(key.slice(0, comma)), Number(key.slice(comma + 1))]);
    }
    if (changed.length === 0) return;

    const r2 = radius * radius;
    for (const cacheKey of [...this.cache.keys()]) {
      const bar = cacheKey.indexOf('|');
      const comma = cacheKey.indexOf(',');
      const sx = Number(cacheKey.slice(0, comma));
      const sy = Number(cacheKey.slice(comma + 1, bar));
      for (const [cx, cy] of changed) {
        const dx = cx - sx, dy = cy - sy;
        if (dx * dx + dy * dy <= r2) { this.cache.delete(cacheKey); break; }
      }
    }
  }

  /** Number of cached stops, for tests and debugging. */
  get size(): number { return this.cache.size; }

  private dropEverythingIfGraphMoved(): void {
    if (this.graph.version === this.syncedVersion) return;
    this.cache.clear();
    this.syncedVersion = this.graph.version;
  }

  private walkOutwards(x: number, y: number, maxDist: number): ReadonlyMap<string, number> {
    const cellKey = `${x},${y}`;
    const seeds = this.graph.getNodesInCell(cellKey);
    // A stop with no node in the graph is connected to no sidewalk and serves nobody.
    // Deliberately no fallback to "find the nearest node", which would quietly paper over a
    // stop missing from the graph.
    if (seeds.length === 0) return EMPTY;

    const dist = new Map<string, number>();
    const heapId: string[] = [];
    const heapD: number[] = [];

    const push = (id: string, d: number): void => {
      heapId.push(id); heapD.push(d);
      let i = heapId.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p]! <= heapD[i]!) break;
        [heapId[p], heapId[i]] = [heapId[i]!, heapId[p]!];
        [heapD[p], heapD[i]] = [heapD[i]!, heapD[p]!];
        i = p;
      }
    };

    const pop = (): [string, number] => {
      const topId = heapId[0]!, topD = heapD[0]!;
      const lastId = heapId.pop()!, lastD = heapD.pop()!;
      if (heapId.length > 0) {
        heapId[0] = lastId; heapD[0] = lastD;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heapD.length && heapD[l]! < heapD[m]!) m = l;
          if (r < heapD.length && heapD[r]! < heapD[m]!) m = r;
          if (m === i) break;
          [heapId[m], heapId[i]] = [heapId[i]!, heapId[m]!];
          [heapD[m], heapD[i]] = [heapD[i]!, heapD[m]!];
          i = m;
        }
      }
      return [topId, topD];
    };

    for (const node of seeds) { dist.set(node.id, 0); push(node.id, 0); }

    const cells = new Map<string, number>();
    while (heapId.length > 0) {
      const [id, d] = pop();
      if (d > (dist.get(id) ?? Infinity)) continue;

      const node = this.graph.getNode(id);
      if (node) {
        const known = cells.get(node.cellKey);
        if (known === undefined || d < known) cells.set(node.cellKey, d);
      }

      for (const edge of this.graph.getEdgesFrom(id)) {
        const next = d + edge.length;
        if (next > maxDist) continue;
        if (next < (dist.get(edge.to.id) ?? Infinity)) {
          dist.set(edge.to.id, next);
          push(edge.to.id, next);
        }
      }
    }
    return cells;
  }
}
