/**
 * 「這一格到得了哪些工作地，各多少成本」—— 逐格的 CSR 表。
 *
 * ## 為什麼換掉 `Record<string, number>`
 *
 * 舊格式是逐工作地一份 `{ "x,y": cost }` 的普通物件。4 萬人存檔實測:375 個工作地
 * 合計 **408,712 個字串鍵**，worker 每次回傳都整包 structured clone 過來。量到的
 * 代價是**主執行緒單單讀一次 `e.data` 就要 1,057–1,131ms**，每 8 秒左右一次;
 * 之後 `Object.entries().map()` 重建 Map 再花 70ms。
 *
 * 現在三個檢視都是 typed array，`postMessage` 帶 transfer list 是零複製。
 *
 * ## 為什麼索引是「格子」不是「工作地」
 *
 * 主執行緒問的兩件事都以**家**為主詞:「哪些工作地到得了這一格」與「這一格到這
 * 幾個工作地各多遠」。舊格式兩者都得掃過全部工作地。轉置之後兩者都是讀一列。
 *
 * ## 格式
 *
 * ```
 * offsets[cellIndex]     這一格的第一筆在哪
 * offsets[cellIndex + 1] 下一格的第一筆
 * wpIndex[i] / cost[i]   第 i 筆:哪個工作地、多少成本
 * ```
 *
 * 跟 `RoadCellGraph` 用的是同一套 CSR 慣例。
 */

/** `wpIndex` 是 `Uint16Array`，`0xffff` 留給「沒有」。 */
export const MAX_WORKPLACES = 65535;

export interface WorkplaceDistanceBuffers {
  width: number;
  height: number;
  /** 索引 → 工作地的 `"x,y"`。 */
  workplacePos: readonly string[];
  /** 長度 `width * height + 1`。 */
  offsets: Uint32Array;
  wpIndex: Uint16Array;
  cost: Int32Array;
}

/** 給 worker 用:一個工作地一個工作地收，最後轉置。 */
export class WorkplaceDistanceTableBuilder {
  private readonly positions: string[] = [];
  /** 逐筆的格子索引與成本，工作地索引是 `wpOf`。三個平行陣列。 */
  private cells: number[] = [];
  private costs: number[] = [];
  private wpOf: number[] = [];

  constructor(private readonly width: number, private readonly height: number) {}

  get workplaceCount(): number { return this.positions.length; }

  /**
   * @param dense 長度 `width * height`，`-1` 代表這一格到不了。
   */
  addWorkplace(pos: string, dense: Int32Array): void {
    if (this.positions.length >= MAX_WORKPLACES) {
      throw new RangeError(`工作地數量超過 ${MAX_WORKPLACES}，wpIndex 會溢位`);
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

  /** 計數排序轉置成 CSR。O(筆數 + 格數)。 */
  build(): WorkplaceDistanceBuffers {
    const cellCount = this.width * this.height;
    const n = this.cells.length;
    const offsets = new Uint32Array(cellCount + 1);
    for (let i = 0; i < n; i++) offsets[this.cells[i]! + 1]!++;
    for (let i = 0; i < cellCount; i++) offsets[i + 1] = offsets[i + 1]! + offsets[i]!;

    const wpIndex = new Uint16Array(n);
    const cost = new Int32Array(n);
    // `cursor` 從 offsets 複製一份 —— 直接拿 offsets 當游標會把它改掉。
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

/** 給主執行緒用:唯讀查詢。 */
export class WorkplaceDistanceTable {
  private readonly indexOfPos: Map<string, number>;

  constructor(private readonly b: WorkplaceDistanceBuffers) {
    this.indexOfPos = new Map();
    for (let i = 0; i < b.workplacePos.length; i++) this.indexOfPos.set(b.workplacePos[i]!, i);
  }

  get workplaceCount(): number { return this.b.workplacePos.length; }
  get entryCount(): number { return this.b.wpIndex.length; }

  /** `postMessage` 的 transfer list。三個檢視各自獨立，可以零複製搬過去。 */
  static transferables(b: WorkplaceDistanceBuffers): ArrayBuffer[] {
    return [b.offsets.buffer as ArrayBuffer, b.wpIndex.buffer as ArrayBuffer, b.cost.buffer as ArrayBuffer];
  }

  /** 這一格在 CSR 裡的區間。界外回一段空的。 */
  private rowOf(x: number, y: number): { from: number; to: number } {
    if (x < 0 || y < 0 || x >= this.b.width || y >= this.b.height) return { from: 0, to: 0 };
    const i = y * this.b.width + x;
    return { from: this.b.offsets[i]!, to: this.b.offsets[i + 1]! };
  }

  /** 哪些工作地到得了這一格。 */
  reachableWorkplacesAt(x: number, y: number): Set<string> {
    const { from, to } = this.rowOf(x, y);
    const out = new Set<string>();
    for (let i = from; i < to; i++) out.add(this.b.workplacePos[this.b.wpIndex[i]!]!);
    return out;
  }

  /** 這一格到那個工作地的道路成本。到不了回 `undefined`。 */
  costAt(x: number, y: number, workplacePos: string): number | undefined {
    const wp = this.indexOfPos.get(workplacePos);
    if (wp === undefined) return undefined;
    const { from, to } = this.rowOf(x, y);
    for (let i = from; i < to; i++) if (this.b.wpIndex[i] === wp) return this.b.cost[i]!;
    return undefined;
  }

  /**
   * 這一格到 `targets` 裡那些工作地各多遠。
   *
   * 掃的是**這一格那一列**而不是 `targets` —— 一格平均到得了的工作地遠少於全城
   * 工作地總數，掃列一次就把交集算完了。
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
