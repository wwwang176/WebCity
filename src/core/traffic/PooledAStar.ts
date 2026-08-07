/**
 * PooledAStar — Zero-GC A* pathfinder operating on LaneGraphBuffer (SharedArrayBuffer).
 *
 * All working memory is pre-allocated in the constructor and reused across calls.
 * Uses a dirtyList pattern to reset only touched indices between searches.
 *
 * No Map, no Set, no object allocation during pathfinding.
 */

import type { GraphReader } from './LaneGraphBuffer';
import { LANE_SPEED_DECAY } from './Pathfinding';

/** Reference speed limit used as baseline for cost normalization. */
const REFERENCE_SPEED_LIMIT = 50;

/** Cost multiplier applied per point used in previous variants (point-level penalty). */
const VARIANT_PENALTY = 3;

/** Cost multiplier applied to ALL points in a cell used by a previous route (cell-level penalty). */
const CELL_ROUTE_PENALTY = 8;

export class PooledAStar {
  // ── Pre-allocated working memory ──
  private readonly gScore: Float32Array;
  private readonly parentEdge: Int32Array;       // edge index that leads to this point (-1 = none)
  private readonly closed: Uint8Array;           // 0 = open, 1 = closed
  private readonly dirtyList: Uint32Array;
  private dirtyCount: number = 0;

  // ── Binary heap (min-heap by f-score) ──
  private readonly heapNodes: Uint32Array;       // point indices
  private readonly heapF: Float32Array;          // f-scores
  private heapSize: number = 0;

  // ── Variant penalty (point-level) ──
  private readonly penalty: Float32Array;
  private readonly penaltyDirty: Uint32Array;
  private penaltyDirtyCount: number = 0;

  // ── Cell-level penalty (for route diversity) ──
  private readonly cellPenalty: Float32Array;     // indexed by pointIdx, like penalty
  private readonly cellPenaltyDirty: Uint32Array;
  private cellPenaltyDirtyCount: number = 0;

  // ── End-point lookup (bitfield) ──
  private readonly isEnd: Uint8Array;
  private readonly endDirty: Uint32Array;
  private endDirtyCount: number = 0;

  // ── Result buffer ──
  private readonly resultBuf: Int32Array;        // edge indices (reversed during reconstruction)

  constructor(maxPoints: number) {
    this.gScore = new Float32Array(maxPoints).fill(Infinity);
    this.parentEdge = new Int32Array(maxPoints).fill(-1);
    this.closed = new Uint8Array(maxPoints);
    this.dirtyList = new Uint32Array(maxPoints);

    this.heapNodes = new Uint32Array(maxPoints);
    this.heapF = new Float32Array(maxPoints);

    this.penalty = new Float32Array(maxPoints).fill(1);
    this.penaltyDirty = new Uint32Array(maxPoints);

    this.cellPenalty = new Float32Array(maxPoints).fill(1);
    this.cellPenaltyDirty = new Uint32Array(maxPoints);

    this.isEnd = new Uint8Array(maxPoints);
    this.endDirty = new Uint32Array(maxPoints);

    this.resultBuf = new Int32Array(maxPoints);
  }

  /**
   * Find a single shortest path. Returns edge index array, or null if unreachable.
   * @param reader   GraphReader on the SharedArrayBuffer
   * @param starts   Point indices (exit points near origin)
   * @param ends     Point indices (entry points near destination)
   * @param endPos   Destination position for heuristic
   * @param maxSteps Maximum A* expansion steps (default 8000)
   */
  findPath(
    reader: GraphReader,
    starts: number[],
    ends: number[],
    endPos: { x: number; y: number },
    maxSteps = 8000,
  ): number[] | null {
    if (starts.length === 0 || ends.length === 0) return null;
    return this.search(reader, starts, ends, endPos, maxSteps, false);
  }

  /**
   * Find path variants: 2 route-level (different cells) × 2 lane-level each = up to 4 variants.
   *
   * 1. Route A: normal A*
   * 2. Route B: cell-level penalty on A's cells → A* finds different route
   * 3. Lane A2: point-level penalty on A's points → same cells, different lane
   * 4. Lane B2: point-level penalty on B's points → same cells, different lane
   *
   * Degrades gracefully: if only one route exists, route B ≈ route A → 4 lane variants.
   */
  findPathVariants(
    reader: GraphReader,
    starts: number[],
    ends: number[],
    endPos: { x: number; y: number },
    count = 4,
    maxSteps = 8000,
  ): number[][] {
    if (starts.length === 0 || ends.length === 0) return [];

    // Reset all penalties from any previous call
    this.resetPenalty();
    this.resetCellPenalty();

    // Collect start/end cells for exclusion from penalty
    const startCells = new Set<number>(); // encoded as cellX * 65536 + cellY
    const endCells = new Set<number>();
    for (const idx of starts) {
      const p = reader.getPoint(idx);
      startCells.add(p.cellX * 65536 + p.cellY);
    }
    for (const idx of ends) {
      const p = reader.getPoint(idx);
      endCells.add(p.cellX * 65536 + p.cellY);
    }

    const variants: number[][] = [];
    const routeCount = Math.min(2, count);

    // ── Phase 1: find route-level variants (cell penalty) ──
    const routes: number[][] = [];
    for (let r = 0; r < routeCount; r++) {
      const path = this.search(reader, starts, ends, endPos, maxSteps, r > 0);
      if (!path || path.length === 0) break;
      routes.push(path);
      variants.push(path);

      // Apply cell-level penalty: penalize ALL points whose cell matches this route's cells.
      // Exclude start/end cells AND the first/last edge cells (fork/merge points that
      // alternative routes also must traverse).
      const forkCells = new Set<number>();
      if (path.length > 0) {
        const firstFrom = reader.getPoint(reader.getEdgeFromIdx(path[0]!));
        const firstTo = reader.getPoint(reader.getEdgeToIdx(path[0]!));
        const lastFrom = reader.getPoint(reader.getEdgeFromIdx(path[path.length - 1]!));
        const lastTo = reader.getPoint(reader.getEdgeToIdx(path[path.length - 1]!));
        forkCells.add(firstFrom.cellX * 65536 + firstFrom.cellY);
        forkCells.add(firstTo.cellX * 65536 + firstTo.cellY);
        forkCells.add(lastFrom.cellX * 65536 + lastFrom.cellY);
        forkCells.add(lastTo.cellX * 65536 + lastTo.cellY);
      }
      const routeCells = new Set<number>();
      for (const edgeIdx of path) {
        const toIdx = reader.getEdgeToIdx(edgeIdx);
        const p = reader.getPoint(toIdx);
        const cellEncoded = p.cellX * 65536 + p.cellY;
        if (!startCells.has(cellEncoded) && !endCells.has(cellEncoded) && !forkCells.has(cellEncoded)) {
          routeCells.add(cellEncoded);
        }
      }
      // Scan all points and apply cell penalty to those in routeCells.
      // getPointCellEncoded avoids allocating a PointData per point and does two
      // DataView reads instead of eight — this loop runs once per route per
      // request, over every point in the graph (BUG-112).
      const pointCount = reader.getPointCount();
      for (let i = 0; i < pointCount; i++) {
        if (routeCells.has(reader.getPointCellEncoded(i))) {
          if (this.cellPenalty[i] === 1) {
            this.cellPenaltyDirty[this.cellPenaltyDirtyCount++] = i;
          }
          this.cellPenalty[i]! *= CELL_ROUTE_PENALTY;
        }
      }
    }

    // ── Phase 2: find lane-level variants for each route (point penalty) ──
    this.resetCellPenalty(); // clear cell penalty — lane variants stay on same cells

    for (const route of routes) {
      if (variants.length >= count) break;

      // Apply point-level penalty for this route's points
      this.resetPenalty();
      for (const edgeIdx of route) {
        const toIdx = reader.getEdgeToIdx(edgeIdx);
        const p = reader.getPoint(toIdx);
        const cellEncoded = p.cellX * 65536 + p.cellY;
        if (startCells.has(cellEncoded) || endCells.has(cellEncoded)) continue;

        if (this.penalty[toIdx] === 1) {
          this.penaltyDirty[this.penaltyDirtyCount++] = toIdx;
        }
        this.penalty[toIdx]! *= VARIANT_PENALTY;
      }

      // A* with point penalty → finds same route, different lane
      const laneVariant = this.search(reader, starts, ends, endPos, maxSteps, true);
      if (laneVariant && laneVariant.length > 0) {
        variants.push(laneVariant);
      }
    }

    // Reset all for next call
    this.resetPenalty();
    this.resetCellPenalty();

    return variants;
  }

  // ── Internal A* search ──

  private search(
    reader: GraphReader,
    starts: number[],
    ends: number[],
    endPos: { x: number; y: number },
    maxSteps: number,
    usePenalty: boolean,
  ): number[] | null {
    this.cachedReader = reader;
    this.resetDirty();
    this.markEnds(ends);

    // Seed start points
    for (const idx of starts) {
      this.gScore[idx] = 0;
      this.parentEdge[idx] = -1;
      this.markDirty(idx);
      const p = reader.getPoint(idx);
      const h = this.heuristic(p.posX, p.posY, endPos.x, endPos.y);
      this.heapPush(idx, h);
    }

    let steps = 0;

    while (this.heapSize > 0 && steps < maxSteps) {
      steps++;

      const current = this.heapPop();
      if (current === -1) break;

      // Reached destination?
      if (this.isEnd[current]) {
        this.clearEnds();
        return this.reconstructPath(current);
      }

      if (this.closed[current]) continue;
      this.closed[current] = 1;

      const currentG = this.gScore[current]!;

      // Expand neighbors
      const edgeIndices = reader.getEdgesFrom(current);
      for (const edgeIdx of edgeIndices) {
        const neighborIdx = reader.getEdgeToIdx(edgeIdx);
        if (this.closed[neighborIdx]) continue;

        // Cost = length / (laneSpeedMultiplier × speedRatio)
        const neighborPoint = reader.getPoint(neighborIdx);
        const speedLimit = neighborPoint.speedLimit || REFERENCE_SPEED_LIMIT;
        const laneSpeed = Math.pow(LANE_SPEED_DECAY, neighborPoint.lane);
        let cost = reader.getEdgeLength(edgeIdx) / (laneSpeed * (speedLimit / REFERENCE_SPEED_LIMIT));

        if (usePenalty) {
          cost *= this.penalty[neighborIdx]!;
          cost *= this.cellPenalty[neighborIdx]!;
        }

        const tentativeG = currentG + cost;
        if (tentativeG >= this.gScore[neighborIdx]!) continue;

        this.gScore[neighborIdx] = tentativeG;
        this.parentEdge[neighborIdx] = edgeIdx;
        this.markDirty(neighborIdx);

        const h = this.heuristic(neighborPoint.posX, neighborPoint.posY, endPos.x, endPos.y);
        this.heapPush(neighborIdx, tentativeG + h);
      }
    }

    this.clearEnds();
    return null;
  }

  private heuristic(ax: number, ay: number, bx: number, by: number): number {
    return (Math.abs(ax - bx) + Math.abs(ay - by)) * 0.01;
  }

  private reconstructPath(endIdx: number): number[] {
    let count = 0;
    let cur = endIdx;
    // Bounded by the buffer size. A self-consistent graph can never cycle here —
    // `closed` stops a node being re-parented, so parent pointers strictly
    // descend by closure time. But syncGraphToWorker rewrites the shared buffer
    // in place while this worker may be mid-batch, and nothing validates the
    // graph version, so a torn read can yield a cyclic chain. Without a cap that
    // wedges the worker forever: no BATCH_RESULT is ever posted again, there is
    // no synchronous fallback for commute spawning, and no watchdog (BUG-063).
    const maxSteps = this.resultBuf.length;
    while (this.parentEdge[cur] !== -1) {
      if (count >= maxSteps) return [];
      this.resultBuf[count++] = this.parentEdge[cur]!;
      // Walk back: find the fromIdx of this edge
      cur = this.getEdgeFromIdxCached(this.parentEdge[cur]!);
    }
    // Reverse into a new array (single allocation per result — cached in routeIndex)
    const result = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      result[i] = this.resultBuf[count - 1 - i]!;
    }
    return result;
  }

  private cachedReader: GraphReader | null = null;

  private getEdgeFromIdxCached(edgeIdx: number): number {
    return this.cachedReader!.getEdgeFromIdx(edgeIdx);
  }

  // ── Dirty list management ──

  private markDirty(idx: number): void {
    this.dirtyList[this.dirtyCount++] = idx;
  }

  private resetDirty(): void {
    for (let i = 0; i < this.dirtyCount; i++) {
      const idx = this.dirtyList[i]!;
      this.gScore[idx] = Infinity;
      this.parentEdge[idx] = -1;
      this.closed[idx] = 0;
    }
    this.dirtyCount = 0;
    this.heapSize = 0;
  }

  private markEnds(ends: number[]): void {
    for (const idx of ends) {
      this.isEnd[idx] = 1;
      this.endDirty[this.endDirtyCount++] = idx;
    }
  }

  private clearEnds(): void {
    for (let i = 0; i < this.endDirtyCount; i++) {
      this.isEnd[this.endDirty[i]!] = 0;
    }
    this.endDirtyCount = 0;
  }

  private resetPenalty(): void {
    for (let i = 0; i < this.penaltyDirtyCount; i++) {
      this.penalty[this.penaltyDirty[i]!] = 1;
    }
    this.penaltyDirtyCount = 0;
  }

  private resetCellPenalty(): void {
    for (let i = 0; i < this.cellPenaltyDirtyCount; i++) {
      this.cellPenalty[this.cellPenaltyDirty[i]!] = 1;
    }
    this.cellPenaltyDirtyCount = 0;
  }

  // ── Binary min-heap (inline, zero allocation) ──

  private heapPush(pointIdx: number, f: number): void {
    let pos = this.heapSize++;
    this.heapNodes[pos] = pointIdx;
    this.heapF[pos] = f;

    // Bubble up
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.heapF[parent]! <= this.heapF[pos]!) break;
      this.heapSwap(pos, parent);
      pos = parent;
    }
  }

  private heapPop(): number {
    if (this.heapSize === 0) return -1;
    const top = this.heapNodes[0]!;
    this.heapSize--;
    if (this.heapSize === 0) return top;

    // Move last to top
    this.heapNodes[0] = this.heapNodes[this.heapSize]!;
    this.heapF[0] = this.heapF[this.heapSize]!;

    // Bubble down
    let pos = 0;
    while (true) {
      const left = 2 * pos + 1;
      const right = 2 * pos + 2;
      let smallest = pos;

      if (left < this.heapSize && this.heapF[left]! < this.heapF[smallest]!) smallest = left;
      if (right < this.heapSize && this.heapF[right]! < this.heapF[smallest]!) smallest = right;
      if (smallest === pos) break;

      this.heapSwap(pos, smallest);
      pos = smallest;
    }

    return top;
  }

  private heapSwap(a: number, b: number): void {
    const tmpNode = this.heapNodes[a]!;
    this.heapNodes[a] = this.heapNodes[b]!;
    this.heapNodes[b] = tmpNode;

    const tmpF = this.heapF[a]!;
    this.heapF[a] = this.heapF[b]!;
    this.heapF[b] = tmpF;
  }
}
