/** Entry stored in the spatial hash for cross-edge collision queries. */
export interface SpatialEntry {
  vid: number;
  x: number;
  y: number;
  hx: number;   // heading unit vector x
  hy: number;   // heading unit vector y
  halfLen: number;
  halfWidth: number;
  edgeId: string;
  toId: string;  // ConnectionPoint ID of edge destination (for merge-sibling filtering)
  progressRatio: number;  // edgeProgress / edge.length (0–1), for merge priority
}

/**
 * Simple 2D spatial hash grid for fast proximity queries.
 * Used to find nearby vehicles across different lane edges.
 *
 * Zero-alloc after warm-up: clear() retains allocated cell arrays,
 * queryNearbyInto() writes into a caller-provided reusable array.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells = new Map<number, SpatialEntry[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  /** Reset all cells for the next frame. Retains allocated arrays to avoid GC. */
  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
    }
  }

  insert(entry: SpatialEntry): void {
    const key = this.key(entry.x, entry.y);
    let arr = this.cells.get(key);
    if (!arr) { arr = []; this.cells.set(key, arr); }
    arr.push(entry);
  }

  /** Write all entries within `radius` of (qx, qy) into `out`. Returns entry count. */
  queryNearbyInto(qx: number, qy: number, radius: number, out: SpatialEntry[]): number {
    out.length = 0;
    const r2 = radius * radius;
    const minCx = Math.floor((qx - radius) * this.invCellSize);
    const maxCx = Math.floor((qx + radius) * this.invCellSize);
    const minCy = Math.floor((qy - radius) * this.invCellSize);
    const maxCy = Math.floor((qy + radius) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.cells.get(this.keyFromCell(cx, cy));
        if (!arr) continue;
        for (const e of arr) {
          const dx = e.x - qx;
          const dy = e.y - qy;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
    return out.length;
  }

  private key(x: number, y: number): number {
    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    return this.keyFromCell(cx, cy);
  }

  private keyFromCell(cx: number, cy: number): number {
    // Cantor-like pairing; works for negative coords via bit ops
    return ((cx * 73856093) ^ (cy * 19349663)) | 0;
  }
}
