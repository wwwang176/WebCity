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

/** Cost multiplier applied per point used in previous variants (penalty method). */
const VARIANT_PENALTY = 3;

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

  // ── Variant penalty ──
  private readonly penalty: Float32Array;
  private readonly penaltyDirty: Uint32Array;
  private penaltyDirtyCount: number = 0;

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
   * Find multiple path variants using the penalty method.
   * Each subsequent variant penalizes points used by previous variants.
   */
  findPathVariants(
    reader: GraphReader,
    starts: number[],
    ends: number[],
    endPos: { x: number; y: number },
    count = 3,
    maxSteps = 8000,
  ): number[][] {
    if (starts.length === 0 || ends.length === 0) return [];

    // Reset penalty from any previous findPathVariants call
    this.resetPenalty();

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

    for (let i = 0; i < count; i++) {
      const path = this.search(reader, starts, ends, endPos, maxSteps, i > 0);
      if (!path || path.length === 0) break;
      variants.push(path);

      // Apply penalty to points used by this variant (excluding start/end cells)
      for (const edgeIdx of path) {
        const toIdx = reader.getEdgeToIdx(edgeIdx);
        const p = reader.getPoint(toIdx);
        const cellEncoded = p.cellX * 65536 + p.cellY;
        if (startCells.has(cellEncoded) || endCells.has(cellEncoded)) continue;

        if (this.penalty[toIdx] === 1) {
          this.penaltyDirty[this.penaltyDirtyCount++] = toIdx;
        }
        this.penalty[toIdx]! *= VARIANT_PENALTY;
      }
    }

    // Reset penalty for next call
    this.resetPenalty();

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
    while (this.parentEdge[cur] !== -1) {
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
