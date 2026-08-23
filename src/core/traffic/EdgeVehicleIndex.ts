/**
 * 「這條邊上有哪些車」—— 每幀重建的逐邊索引。
 *
 * ## 為什麼不是 `Map<string, EdgeEntry[]>`
 *
 * 舊版每幀為**每一台車**配一個 `{ vid, progress, halfLen, queueing }` 物件。
 * 4 萬人的存檔路上有 1 829 台車，而 `advanceEdgeVehicles` 是被算繪迴圈驅動的
 * （不是模擬 tick），所以那是每秒十萬個短命物件。實測某些幀有 16.4% 的自身時間
 * 花在垃圾回收上。
 *
 * 池化重用試過一次，被撤掉了:`vid` 忘了更新的話沒有任何測試會紅，而失敗模式是
 * 跟車距離**靜靜地**算錯。這一版沒有那個失敗模式 —— 根本沒有物件可以忘記更新，
 * 五個欄位是五條平行的 typed array，每幀從頭覆寫。
 *
 * ## 為什麼是串列而不是 CSR
 *
 * 索引在**同一幀之內會被改**:車走到下一條邊時要從舊邊移到新邊，位置與煞車狀態
 * 也要當場更新，後面的車才看得到前車這一幀剛算好的值（`FrontToBackOrder.test.ts`
 * 釘著這件事:842 台車有 547 台的結果會因為順序而不同）。CSR 是排好的，搬一筆就
 * 要重排。逐槽一條雙向串列讓插入、移除、換邊都是 O(1)。
 *
 * 走訪順序因此是後進先出，不是插入順序。**沒有呼叫端依賴順序** —— 兩個消費者
 * 都在整段裡取極小值，或在命中時回一個與命中者無關的固定值。
 *
 * ## 用法
 *
 * `begin()` → `add()` × N（記下回傳的筆號）→ 走訪與 `setProgress` / `moveTo`。
 */

/** 一台車在某條邊上的樣子，唯讀。給測試與偵錯用。 */
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

/** 空的串列尾端。 */
export const NO_ENTRY = -1;

export class EdgeVehicleIndex {
  /**
   * edgeId → 槽號。跨幀重複使用。
   *
   * **沒有清空的方法，也不需要。** 邊的 id 是 `cellKey:dir:lane` 完全決定的
   * （`LaneGraph`），重建路網會產生一模一樣的 id —— 所以這張表的上限只取決於
   * 地圖裝得下幾條車道邊，不會隨編輯次數成長。
   */
  private slotOfEdge = new Map<string, number>();
  private slotCount = 0;

  /** 槽 → 第一筆，`NO_ENTRY` = 這條邊上沒有車。 */
  private head = new Int32Array(0);

  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  /** 筆 → 它現在掛在哪一槽。移除時要用。 */
  private slotAt = new Int32Array(0);

  private vid = new Int32Array(0);
  private progress = new Float64Array(0);
  private halfLen = new Float64Array(0);
  private queueing = new Uint8Array(0);

  private n = 0;

  /** 開始新的一幀。 */
  begin(): void {
    this.n = 0;
    this.head.fill(NO_ENTRY);
  }

  /** @returns 這一筆的筆號。呼叫端要留著它才改得動這一筆。 */
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

  /** 這一筆的位置與煞車狀態變了（同一條邊）。 */
  setProgress(i: number, progress: number, queueing: boolean): void {
    this.progress[i] = progress;
    this.queueing[i] = queueing ? 1 : 0;
  }

  /** 這一筆換到另一條邊上。 */
  moveTo(i: number, edgeId: string): void {
    this.unlink(i);
    this.link(i, this.slotFor(edgeId));
  }

  /** 這條邊上的第一筆，`NO_ENTRY` = 沒有。 */
  firstOf(edgeId: string): number {
    const slot = this.slotOfEdge.get(edgeId);
    return slot === undefined ? NO_ENTRY : this.head[slot]!;
  }

  nextOf(i: number): number { return this.next[i]!; }

  vidAt(i: number): number { return this.vid[i]!; }
  progressAt(i: number): number { return this.progress[i]!; }
  halfLenAt(i: number): number { return this.halfLen[i]!; }
  queueingAt(i: number): boolean { return this.queueing[i] === 1; }

  /** 這一幀總共幾筆。 */
  get size(): number { return this.n; }

  /**
   * 這條邊上的車，攤成物件。
   *
   * **只給測試與偵錯用** —— 每呼叫一次就配一批物件，正是這個類別存在的理由要避免的。
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
