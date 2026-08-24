import type { Grid } from '../grid/Grid';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';
import { MAX_ELEVATION_LEVEL } from '../elevation/types';
import { MULTI_CELL_OCCUPIED, isPrimaryCellReserved, findPrimaryCell } from '../building/InfraPlacement';

/** How many levels the node space has: ground plus elevated 1-3. */
export const FLOOD_LEVELS = MAX_ELEVATION_LEVEL + 1;

/** `group` has not been computed yet. */
const GROUP_UNKNOWN = -2;
/** This cell settles for itself and belongs to no multi-cell building. */
export const GROUP_NONE = -1;

/**
 * Scratch space for the utility coverage flood: traversal state plus records shared across
 * plants within one pass.
 *
 * ## Why this exists
 *
 * A `Set<string>` for visited and a string array for the queue, allocated per plant, walks all
 * 40,000 cells of a fully built 200x200 city for every plant — hundreds of thousands of
 * short-lived strings and twenty-four large Sets across three utilities and twenty-four plants
 * in one pass. That pass measured 4.3 seconds, with almost all of the remaining cost in the
 * strings.
 *
 * These are typed arrays reused across calls instead:
 *
 * - **Visited** uses a generation stamp (`visitedGen[node] === gen`), so moving to the next
 *   plant is `gen++` rather than clearing a million cells.
 * - **The queue** is an `Int32Array` with head and tail indices.
 * - **The pass-shared** records — infrastructure positions, multi-cell building grouping, and
 *   footprints already charged — were a `Set<string>` and a `Map<string, CellCharge>` passed in
 *   by the caller.
 *
 * ## Node encoding
 *
 * `node = level * totalCells + idx` with `idx = y * width + x`. Ground is level 0 and elevated
 * is 1-3, the same numbering as `cellKey`'s `"x,y,level"`.
 *
 * ## Not reentrant
 *
 * One scratch serves one flood at a time. Each of the three utilities holds its own, and the
 * plants within one run **sequentially** (the for loop in `calculateCoverage`), which is enough.
 */
export class UtilityFloodScratch {
  width = 0;
  height = 0;
  totalCells = 0;

  private visitedGen = new Int32Array(0);
  private gen = 0;
  private queue = new Int32Array(0);
  private head = 0;
  private tail = 0;

  private infraBits = new Uint8Array(0);
  private group = new Int32Array(0);
  private demand = new Float64Array(0);
  private paid = new Uint8Array(0);

  /**
   * Begins a new coverage pass.
   *
   * @param infra Infrastructure positions as `"x,y"`. Flattened into per-cell flags: the flood
   *   asks about every neighbour, and keeping a `Set<string>` allocates a string per neighbour.
   */
  beginPass(grid: Grid, infra?: Set<string>): void {
    const { width, height } = grid;
    const cells = width * height;
    if (this.totalCells !== cells) {
      this.visitedGen = new Int32Array(cells * FLOOD_LEVELS);
      this.queue = new Int32Array(cells * FLOOD_LEVELS);
      this.infraBits = new Uint8Array(cells);
      this.group = new Int32Array(cells);
      this.demand = new Float64Array(cells);
      this.paid = new Uint8Array(cells);
      this.gen = 0;
    } else {
      this.infraBits.fill(0);
      this.paid.fill(0);
    }
    this.width = width;
    this.height = height;
    this.totalCells = cells;
    this.group.fill(GROUP_UNKNOWN);

    if (infra) {
      for (const key of infra) {
        const p = parsePosKeyUnsafe(key);
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
        this.infraBits[p.y * width + p.x] = 1;
      }
    }
  }

  /** Begins one plant's flood: traversal state reset, queue emptied. */
  beginFlood(): void {
    this.gen++;
    this.head = 0;
    this.tail = 0;
  }

  isInfra(idx: number): boolean {
    return this.infraBits[idx] === 1;
  }

  /** @returns whether this node had not been visited. */
  markVisited(node: number): boolean {
    if (this.visitedGen[node] === this.gen) return false;
    this.visitedGen[node] = this.gen;
    return true;
  }

  hasVisited(node: number): boolean {
    return this.visitedGen[node] === this.gen;
  }

  push(node: number): void {
    this.queue[this.tail++] = node;
  }

  get hasQueued(): boolean {
    return this.head < this.tail;
  }

  shift(): number {
    return this.queue[this.head++]!;
  }

  /**
   * What reaching this cell costs, and whose account it goes on.
   *
   * Both answers are computed and memoised together because they are one thing: a multi-cell
   * building's **entire consumption sits on its primary cell** and its secondary cells report 0
   * (see `calculateUtilityCellDemand`), so reaching a secondary cell charges the primary cell's
   * figure. Memoising them separately would make the grouping and the amount two records that
   * can go stale independently.
   *
   * The memoisation is there because `findPrimaryCell` scans an O(max(w,h)^2) box — 81 lookups
   * for every secondary cell of a large airport — while the cells do not change within a pass.
   *
   * @returns the index of the footprint's primary cell, or `GROUP_NONE` when the cell settles
   *   for itself. The amount comes from `demandAt(idx)`, which is the only way to return two
   *   values without allocating.
   */
  chargeOf(grid: Grid, idx: number, x: number, y: number,
           getDemand: (x: number, y: number) => number): number {
    const memo = this.group[idx]!;
    if (memo !== GROUP_UNKNOWN) return memo;

    let group = GROUP_NONE;
    let demandX = x, demandY = y;
    const buildingId = grid.getField(x, y, 'buildingId');
    const reserved = grid.getField(x, y, 'reserved');
    if (buildingId > 0
      && (reserved === MULTI_CELL_OCCUPIED || isPrimaryCellReserved(reserved))) {
      const primary = findPrimaryCell(grid, x, y);
      if (primary) {
        group = primary.y * this.width + primary.x;
        demandX = primary.x;
        demandY = primary.y;
      }
    }
    this.group[idx] = group;
    this.demand[idx] = getDemand(demandX, demandY);
    return group;
  }

  /** The amount `chargeOf` computed. */
  demandAt(idx: number): number {
    return this.demand[idx]!;
  }

  isPaid(group: number): boolean {
    return this.paid[group] === 1;
  }

  markPaid(group: number): void {
    this.paid[group] = 1;
  }
}
