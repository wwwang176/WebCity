/**
 * Which workplaces a cell can reach and at what cost, as a per-cell CSR table.
 *
 * ## Why `Record<string, number>` was replaced
 *
 * The old format was a plain `{ "x,y": cost }` object per workplace. On a 40k save that measured
 * **408,712 string keys** across 375 workplaces, structured-cloned in full on every worker
 * response. The measured cost was **1,057-1,131ms on the main thread simply to read `e.data`**,
 * about every 8 seconds, plus 70ms to rebuild a Map with `Object.entries().map()`.
 *
 * All three views are now typed arrays, and `postMessage` with a transfer list copies nothing.
 *
 * ## Why it is indexed by cell rather than by workplace
 *
 * Both questions the main thread asks have a **home** as their subject: which workplaces this
 * cell can reach, and how far this cell is from these workplaces. The old format scanned every
 * workplace for either. Transposed, both are one row.
 *
 * ## The format
 *
 * ```
 * offsets[cellIndex]     where this cell's first entry is
 * offsets[cellIndex + 1] the next cell's first entry
 * wpIndex[i] / cost[i]   entry i: which workplace, at what cost
 * ```
 *
 * The same CSR convention `RoadCellGraph` uses.
 */

/** `wpIndex` is a `Uint16Array`, with `0xffff` reserved for "none". */
export const MAX_WORKPLACES = 65535;

export interface WorkplaceDistanceBuffers {
  width: number;
  height: number;
  /** Index to a workplace's `"x,y"`. */
  workplacePos: readonly string[];
  /** Length `width * height + 1`. */
  offsets: Uint32Array;
  wpIndex: Uint16Array;
  cost: Int32Array;
}

/** For the worker: collects one workplace at a time and transposes at the end. */
export class WorkplaceDistanceTableBuilder {
  private readonly positions: string[] = [];
  /** Per-entry cell indices and costs, with workplace indices in `wpOf`. Three parallel
   *  arrays. */
  private cells: number[] = [];
  private costs: number[] = [];
  private wpOf: number[] = [];

  constructor(private readonly width: number, private readonly height: number) {}

  get workplaceCount(): number { return this.positions.length; }

  /**
   * @param dense Length `width * height`, with `-1` for an unreachable cell.
   */
  addWorkplace(pos: string, dense: Int32Array): void {
    if (this.positions.length >= MAX_WORKPLACES) {
      throw new RangeError(`more than ${MAX_WORKPLACES} workplaces — wpIndex would overflow`);
    }
    const wp = this.positions.length;
    this.positions.push(pos);
    for (let i = 0; i < dense.length; i++) {
      const c = dense[i]!;
      if (c < 0) continue;
      this.cells.push(i);
      this.costs.push(c);
      this.wpOf.push(wp);
    }
  }

  /** A counting-sort transpose into CSR, in O(entries + cells). */
  build(): WorkplaceDistanceBuffers {
    const cellCount = this.width * this.height;
    const n = this.cells.length;
    const offsets = new Uint32Array(cellCount + 1);
    for (let i = 0; i < n; i++) offsets[this.cells[i]! + 1]!++;
    for (let i = 0; i < cellCount; i++) offsets[i + 1] = offsets[i + 1]! + offsets[i]!;

    const wpIndex = new Uint16Array(n);
    const cost = new Int32Array(n);
    // `cursor` is a copy of offsets: using offsets itself as the cursor would overwrite it.
    const cursor = offsets.slice(0, cellCount);
    for (let i = 0; i < n; i++) {
      const at = cursor[this.cells[i]!]!++;
      wpIndex[at] = this.wpOf[i]!;
      cost[at] = this.costs[i]!;
    }

    return {
      width: this.width, height: this.height,
      workplacePos: this.positions, offsets, wpIndex, cost,
    };
  }
}

/** For the main thread: read-only queries. */
export class WorkplaceDistanceTable {
  private readonly indexOfPos: Map<string, number>;

  constructor(private readonly b: WorkplaceDistanceBuffers) {
    this.indexOfPos = new Map();
    for (let i = 0; i < b.workplacePos.length; i++) this.indexOfPos.set(b.workplacePos[i]!, i);
  }

  get workplaceCount(): number { return this.b.workplacePos.length; }
  get entryCount(): number { return this.b.wpIndex.length; }

  /** The transfer list for `postMessage`. The three views are independent and move without a
   *  copy. */
  static transferables(b: WorkplaceDistanceBuffers): ArrayBuffer[] {
    return [b.offsets.buffer as ArrayBuffer, b.wpIndex.buffer as ArrayBuffer, b.cost.buffer as ArrayBuffer];
  }

  /** This cell's range in the CSR. Out of bounds returns an empty one. */
  private rowOf(x: number, y: number): { from: number; to: number } {
    if (x < 0 || y < 0 || x >= this.b.width || y >= this.b.height) return { from: 0, to: 0 };
    const i = y * this.b.width + x;
    return { from: this.b.offsets[i]!, to: this.b.offsets[i + 1]! };
  }

  /** Which workplaces can reach this cell. */
  reachableWorkplacesAt(x: number, y: number): Set<string> {
    const { from, to } = this.rowOf(x, y);
    const out = new Set<string>();
    for (let i = from; i < to; i++) out.add(this.b.workplacePos[this.b.wpIndex[i]!]!);
    return out;
  }

  /** The road cost from this cell to that workplace. `undefined` when unreachable. */
  costAt(x: number, y: number, workplacePos: string): number | undefined {
    const wp = this.indexOfPos.get(workplacePos);
    if (wp === undefined) return undefined;
    const { from, to } = this.rowOf(x, y);
    for (let i = from; i < to; i++) if (this.b.wpIndex[i] === wp) return this.b.cost[i]!;
    return undefined;
  }

  /**
   * How far this cell is from each of the workplaces in `targets`.
   *
   * Scans **this cell's row** rather than `targets`: a cell reaches far fewer workplaces on
   * average than the city has, and one pass over the row computes the intersection.
   */
  distancesAt(x: number, y: number, targets: ReadonlySet<string>): Map<string, number> {
    const { from, to } = this.rowOf(x, y);
    const out = new Map<string, number>();
    for (let i = from; i < to; i++) {
      const pos = this.b.workplacePos[this.b.wpIndex[i]!]!;
      if (targets.has(pos)) out.set(pos, this.b.cost[i]!);
    }
    return out;
  }
}
