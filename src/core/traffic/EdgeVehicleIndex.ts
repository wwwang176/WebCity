/**
 * Which vehicles are on each edge: a per-edge index rebuilt every frame.
 *
 * ## Why not `Map<string, EdgeEntry[]>`
 *
 * That allocates a `{ vid, progress, halfLen, queueing }` object per **vehicle** per frame. A
 * 40k-citizen save has 1,829 vehicles on the road, and `advanceEdgeVehicles` is driven by the
 * render loop rather than the simulation tick, so that is a hundred thousand short-lived
 * objects per second. Some frames measured 16.4% of their self time in garbage collection.
 *
 * Pooling and reuse was tried and reverted: forgetting to update `vid` turns no test red, and
 * the failure mode is car-following distances **silently** wrong. This version has no such
 * failure mode, because there is no object to forget to update — the five fields are five
 * parallel typed arrays, overwritten from scratch each frame.
 *
 * ## Why linked lists rather than CSR
 *
 * The index is **mutated within a frame**: a vehicle reaching the next edge moves from the old
 * edge to the new one, and its position and braking state update on the spot so following
 * vehicles see the value computed for the leader this same frame
 * (`FrontToBackOrder.test.ts` pins this: 547 of 842 vehicles get a different result depending
 * on the order). CSR is sorted, and moving one entry means re-sorting. A doubly linked list
 * per slot makes insert, remove and move-edge all O(1).
 *
 * Traversal order is therefore last-in-first-out rather than insertion order. **No caller
 * depends on the order**: both consumers take a minimum over the whole run, or return a fixed
 * value on a hit that does not depend on which entry hit.
 *
 * ## Usage
 *
 * `begin()`, then `add()` N times (keeping the returned entry numbers), then traversal with
 * `setProgress` / `moveTo`.
 */

/** A read-only view of one vehicle on one edge, for tests and debugging. */
export interface EdgeVehicleView {
  vid: number;
  progress: number;
  halfLen: number;
  /**
   * Held back by something ahead — following, a red light, or a junction.
   *
   * Only queueing traffic can block a junction. A car that is merely close but
   * running free will be long gone by the time anyone reaches it.
   */
  queueing: boolean;
}

/** The end of a list. */
export const NO_ENTRY = -1;

export class EdgeVehicleIndex {
  /**
   * edgeId to slot number, reused across frames.
   *
   * **There is no way to clear it, and none is needed.** An edge id is fully determined by
   * `cellKey:dir:lane` (`LaneGraph`), so rebuilding the road network produces identical ids.
   * The table's size is bounded by how many lane edges fit on the map and does not grow with
   * the number of edits.
   */
  private slotOfEdge = new Map<string, number>();
  private slotCount = 0;

  /** Slot to first entry; `NO_ENTRY` means no vehicle on that edge. */
  private head = new Int32Array(0);

  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  /** Entry to the slot it is currently linked into, needed for removal. */
  private slotAt = new Int32Array(0);

  private vid = new Int32Array(0);
  private progress = new Float64Array(0);
  private halfLen = new Float64Array(0);
  private queueing = new Uint8Array(0);

  private n = 0;

  /** Starts a new frame. */
  begin(): void {
    this.n = 0;
    this.head.fill(NO_ENTRY);
  }

  /** @returns this entry's number. Callers must keep it to modify the entry later. */
  add(edgeId: string, vid: number, progress: number, halfLen: number, queueing: boolean): number {
    const slot = this.slotFor(edgeId);
    const i = this.n++;
    this.growEntries(this.n);
    this.vid[i] = vid;
    this.progress[i] = progress;
    this.halfLen[i] = halfLen;
    this.queueing[i] = queueing ? 1 : 0;
    this.link(i, slot);
    return i;
  }

  /** This entry's position and braking state changed, on the same edge. */
  setProgress(i: number, progress: number, queueing: boolean): void {
    this.progress[i] = progress;
    this.queueing[i] = queueing ? 1 : 0;
  }

  /** Moves this entry to another edge. */
  moveTo(i: number, edgeId: string): void {
    this.unlink(i);
    this.link(i, this.slotFor(edgeId));
  }

  /** The first entry on this edge; `NO_ENTRY` when there is none. */
  firstOf(edgeId: string): number {
    const slot = this.slotOfEdge.get(edgeId);
    return slot === undefined ? NO_ENTRY : this.head[slot]!;
  }

  nextOf(i: number): number { return this.next[i]!; }

  vidAt(i: number): number { return this.vid[i]!; }
  progressAt(i: number): number { return this.progress[i]!; }
  halfLenAt(i: number): number { return this.halfLen[i]!; }
  queueingAt(i: number): boolean { return this.queueing[i] === 1; }

  /** How many entries this frame holds. */
  get size(): number { return this.n; }

  /**
   * The vehicles on this edge, materialised as objects.
   *
   * **For tests and debugging only**: each call allocates a batch of objects, which is exactly
   * what this class exists to avoid.
   */
  entriesOf(edgeId: string): EdgeVehicleView[] {
    const out: EdgeVehicleView[] = [];
    for (let i = this.firstOf(edgeId); i !== NO_ENTRY; i = this.nextOf(i)) {
      out.push({
        vid: this.vidAt(i), progress: this.progressAt(i),
        halfLen: this.halfLenAt(i), queueing: this.queueingAt(i),
      });
    }
    return out;
  }

  private slotFor(edgeId: string): number {
    let slot = this.slotOfEdge.get(edgeId);
    if (slot === undefined) {
      slot = this.slotCount++;
      this.slotOfEdge.set(edgeId, slot);
      this.growSlots();
    }
    return slot;
  }

  private link(i: number, slot: number): void {
    const first = this.head[slot]!;
    this.next[i] = first;
    this.prev[i] = NO_ENTRY;
    if (first !== NO_ENTRY) this.prev[first] = i;
    this.head[slot] = i;
    this.slotAt[i] = slot;
  }

  private unlink(i: number): void {
    const p = this.prev[i]!, nx = this.next[i]!;
    if (p !== NO_ENTRY) this.next[p] = nx; else this.head[this.slotAt[i]!] = nx;
    if (nx !== NO_ENTRY) this.prev[nx] = p;
  }

  private growSlots(): void {
    if (this.slotCount <= this.head.length) return;
    const cap = Math.max(16, this.slotCount * 2);
    const head = new Int32Array(cap).fill(NO_ENTRY);
    head.set(this.head);
    this.head = head;
  }

  private growEntries(need: number): void {
    if (need <= this.vid.length) return;
    const cap = Math.max(64, need * 2);
    const grow = <T extends Int32Array | Float64Array | Uint8Array>(old: T, made: T): T => {
      made.set(old as never);
      return made;
    };
    this.next = grow(this.next, new Int32Array(cap));
    this.prev = grow(this.prev, new Int32Array(cap));
    this.slotAt = grow(this.slotAt, new Int32Array(cap));
    this.vid = grow(this.vid, new Int32Array(cap));
    this.progress = grow(this.progress, new Float64Array(cap));
    this.halfLen = grow(this.halfLen, new Float64Array(cap));
    this.queueing = grow(this.queueing, new Uint8Array(cap));
  }
}
