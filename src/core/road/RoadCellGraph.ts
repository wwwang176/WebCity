/**
 * The cell-level road graph, shared by the synchronous and asynchronous workplace distance paths.
 *
 * Nodes are road cells including elevated ones, and edges are the adjacencies
 * `UnifiedRoadLookup` allows.
 *
 * **Level and ramp rules are consumed at build time**, so whoever holds the graph — the worker in
 * particular — never sees levels and never re-interprets the rules. That is why it exists: the
 * rules live in one place (BUG-109 was caused by the worker holding a flat buffer that could not
 * see elevated roads).
 */

import { parsePosKeyUnsafe, parseLevelFromKey, toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { roadTileCost } from './roadCost';
import type { UnifiedRoadLookup } from './UnifiedRoadLookup';

/**
 * The road graph in compressed sparse row form. Node i's adjacency is
 * `targets[offsets[i] .. offsets[i+1])`.
 *
 * **Weights are integers** in a `Uint16Array`, from 9 to 60 (see `roadCost.ts`). Integer addition
 * commutes, so a forward and a reverse flood over one route necessarily produce bit-identical
 * totals. Floating point cannot: that is about order, not precision.
 */
export interface RoadCellGraph {
  readonly nodeKeys: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
  /** Length n+1. */
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
  /** The integer cost of entering the cell at targets[j]. */
  readonly weights: Uint16Array;
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
  /** 0 is ground, 1-3 elevated. */
  readonly nodeLevel: Uint8Array;
}

/** The level from a key. A ground key has no third segment and returns 0. */
export function levelOfKey(key: string): number {
  return parseLevelFromKey(key);
}

/**
 * Builds the graph from a lookup, in O(road cells x 4).
 *
 * **Not to be called per query.** `roadDistanceToTargets` is called once per citizen, and
 * building the graph inside it multiplies O(road cells) by the population. The graph changes only
 * when the road network does, so `SimulationLoop` holds it, keyed on
 * `commuteCache.roadGeneration`.
 */
export function buildRoadCellGraph(lookup: UnifiedRoadLookup): RoadCellGraph {
  const nodeKeys = lookup.getAllCellKeys();
  const n = nodeKeys.length;
  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) indexOf.set(nodeKeys[i]!, i);

  const nodeX = new Uint16Array(n);
  const nodeY = new Uint16Array(n);
  const nodeLevel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const key = nodeKeys[i]!;
    const { x, y } = parsePosKeyUnsafe(key);
    if (x > 0xffff || y > 0xffff) throw new RangeError(`cell coordinate exceeds the Uint16 limit: ${key}`);
    nodeX[i] = x; nodeY[i] = y; nodeLevel[i] = levelOfKey(key);
  }

  const offsets = new Uint32Array(n + 1);
  const targetList: number[] = [];
  const weightList: number[] = [];

  for (let i = 0; i < n; i++) {
    offsets[i] = targetList.length;
    const key = nodeKeys[i]!;
    const x = nodeX[i]!, y = nodeY[i]!;
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!, ny = y + dy!;
      for (const nk of lookup.getCompatibleNeighborKeys(key, nx, ny)) {
        const j = indexOf.get(nk);
        if (j === undefined) continue;
        const info = lookup.getCellByKey(nk);
        if (!info) continue;
        const w = roadTileCost(info.roadType);
        if (!Number.isFinite(w)) continue;
        if (w > 0xffff) throw new RangeError(`road cost exceeds the Uint16 limit: ${nk} = ${w}`);
        targetList.push(j);
        weightList.push(w);
      }
    }
  }
  offsets[n] = targetList.length;

  return {
    nodeKeys, indexOf, offsets,
    targets: Uint32Array.from(targetList),
    weights: Uint16Array.from(weightList),
    nodeX, nodeY, nodeLevel,
  };
}

// ── The flood core ──────────────────────────────────────────────────

/** A binary heap. Nodes are integer indices and costs are integers. */
class NodeHeap {
  private idx: number[] = [];
  private cost: number[] = [];
  get size(): number { return this.idx.length; }

  push(i: number, c: number): void {
    this.idx.push(i); this.cost.push(c);
    let k = this.idx.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[k]! >= this.cost[p]!) break;
      this.swap(k, p); k = p;
    }
  }

  pop(): { node: number; cost: number } | undefined {
    if (this.idx.length === 0) return undefined;
    const top = { node: this.idx[0]!, cost: this.cost[0]! };
    const li = this.idx.pop()!, lc = this.cost.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = li; this.cost[0] = lc;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.idx.length && this.cost[l]! < this.cost[m]!) m = l;
        if (r < this.idx.length && this.cost[r]! < this.cost[m]!) m = r;
        if (m === k) break;
        this.swap(k, m); k = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!];
    [this.cost[a], this.cost[b]] = [this.cost[b]!, this.cost[a]!];
  }
}

/**
 * A weighted flood from `seedNodes`, returning each node's cost with -1 for unreached.
 *
 * Four invariants, relied on by both the synchronous query and the worker:
 *
 * 1. **Cost is charged at the destination cell**: `weights[j]` is the price of entering
 *    `targets[j]`.
 * 2. **`onSettle` fires on pop, not on relax.** Pop order is increasing cost order, so the first
 *    settle is always the cheapest route. Recording on relax lets whichever was reached first win
 *    permanently: a rural lane at the door beats a motorway two cells away (BUG-102).
 * 3. **Neighbours past `maxBudget` never enter the heap.**
 * 4. **Costs are integers throughout.** `cost` is an `Int32Array` and the weights a
 *    `Uint16Array`, both exact, so the stale check cannot misjudge through rounding. That is
 *    also the only reason the worker and the synchronous path can agree cell for cell:
 *    floating-point addition is not associative, and walking the same edges in reverse produces
 *    different bits.
 *
 * `onSettle` returning true ends the flood early, which the synchronous query uses once it has
 * found every target.
 *
 * This is a **general** weighted-graph Dijkstra and assumes nothing about the weights coming from
 * a road network. The road graph happens to give every node uniform in-edge weights, since cost
 * is charged at the destination, so the "relax to a cheaper value" and "stale heap entry"
 * branches are unreachable — but the contract holds for any graph, and the tests guard them with
 * a synthetic one.
 */
export function floodRoadCellGraph(
  graph: RoadCellGraph,
  seedNodes: readonly number[],
  maxBudget: number,
  onSettle?: (node: number, cost: number) => boolean,
): Int32Array {
  const n = graph.nodeKeys.length;
  const cost = new Int32Array(n).fill(-1);
  const heap = new NodeHeap();

  for (const s of seedNodes) {
    if (s < 0 || s >= n || cost[s]! >= 0) continue;
    cost[s] = 0;
    heap.push(s, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cost[cur.node]! < cur.cost) continue; // a stale heap entry
    if (onSettle && onSettle(cur.node, cur.cost)) return cost;

    for (let j = graph.offsets[cur.node]!; j < graph.offsets[cur.node + 1]!; j++) {
      const next = graph.targets[j]!;
      const nc = cur.cost + graph.weights[j]!;
      if (nc > maxBudget) continue;
      const prev = cost[next]!;
      if (prev < 0 || nc < prev) {
        cost[next] = nc;
        heap.push(next, nc);
      }
    }
  }
  return cost;
}

// ── Seeds and attachment ────────────────────────────────────────────

/**
 * The road nodes near a building cell, across every level.
 *
 * Neither a home nor a workplace is a road cell; each attaches to a road within Chebyshev(reach),
 * matching the inner-ring model used by zoning and civic buildings (`ZONE_ROAD_REACH`).
 */
export function seedNodesFor(
  graph: RoadCellGraph, x: number, y: number, reach: number,
): number[] {
  const out: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      // One (x, y) can carry several levels, and all of them count: an elevated road is a road.
      for (let lv = 0; lv <= 3; lv++) {
        const key = lv === 0 ? toPosKey(nx, ny) : `${nx},${ny},${lv}`;
        const i = graph.indexOf.get(key);
        if (i !== undefined) out.push(i);
      }
    }
  }
  return out;
}

/**
 * When a node settles, attaches the cells within Chebyshev(reach) of it that `accept` allows.
 *
 * **Called at the moment of settling rather than collecting the whole sequence first.** That is
 * what lets the synchronous query exit early once it has found every target; collecting first and
 * attaching afterwards always runs the full budget.
 *
 * Only the first attachment is recorded: settle order is increasing cost order, so the first is
 * the cheapest route (BUG-102's semantics). `dx`/`dy` include `(0, 0)`, so a road cell checks
 * itself too.
 *
 * Note that this means **a road cell does not necessarily get its own cost**: a cheaper road cell
 * within reach gives it that one instead. That is the correct meaning of attaching to the nearest
 * road, not a defect.
 *
 * ## Why a dense array rather than a `Map<string, number>`
 *
 * This runs once per settled node and scans (2*reach+1)^2 = 25 cells each time. Allocating a
 * `"x,y"` string key per cell dominated: a Chrome trace on a 40k save showed one synchronous
 * query freezing the main thread for 2,686ms with **47.9% of its self time here**. Indexed by
 * `y * width + x`, a cell costs one integer write and no allocation.
 *
 * @param out Length `width * height`, with `-1` for a cell not yet attached. The caller fills it
 *   with -1.
 * @returns How many cells were newly attached, which the caller counts towards its early exit.
 */
export function attachAtSettledNode(
  graph: RoadCellGraph,
  node: number,
  cost: number,
  reach: number,
  width: number,
  height: number,
  accept: (x: number, y: number) => boolean,
  out: Int32Array,
): number {
  const cx = graph.nodeX[node]!, cy = graph.nodeY[node]!;
  let added = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= height) continue;
    const rowBase = ny * width;
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx;
      // The bounds check is what the dense array requires: relying on `accept` to reject
      // out-of-bounds cells is not a bet that can be taken when writing into an array. The
      // behaviour is unchanged, since `accept` rejects them anyway.
      if (nx < 0 || nx >= width) continue;
      const idx = rowBase + nx;
      if (out[idx]! >= 0) continue;
      if (!accept(nx, ny)) continue;
      out[idx] = cost;
      added++;
    }
  }
  return added;
}

// ── Transpose ───────────────────────────────────────────────────────

/**
 * The transpose: every edge `(i -> j, w)` becomes `(j -> i, w)`, with the nodes unchanged.
 *
 * **The weight follows the edge rather than an endpoint**, which is the whole reason this exists.
 * Cost is charged at the destination, so a forward edge A->B is priced at cost(B); running
 * Dijkstra outward from B on the transpose gives exactly each A's forward cost of reaching B.
 *
 * Spreading backwards from B on the forward graph charges cost(A) instead, which is what the
 * former `reverseFloodFromWorkplace` did, and which is BUG-237.
 */
export function transposeRoadCellGraph(graph: RoadCellGraph): RoadCellGraph {
  const n = graph.nodeKeys.length;
  const e = graph.targets.length;

  // Counts each node's in-degree first.
  const counts = new Uint32Array(n);
  for (let j = 0; j < e; j++) counts[graph.targets[j]!]!++;

  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + counts[i]!;

  const cursor = Uint32Array.from(offsets.subarray(0, n));
  const targets = new Uint32Array(e);
  const weights = new Uint16Array(e);

  for (let i = 0; i < n; i++) {
    for (let j = graph.offsets[i]!; j < graph.offsets[i + 1]!; j++) {
      const dst = graph.targets[j]!;
      const at = cursor[dst]!++;
      targets[at] = i;
      weights[at] = graph.weights[j]!;
    }
  }

  return {
    nodeKeys: graph.nodeKeys, indexOf: graph.indexOf,
    offsets, targets, weights,
    nodeX: graph.nodeX, nodeY: graph.nodeY, nodeLevel: graph.nodeLevel,
  };
}
