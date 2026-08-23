/**
 * 「這一格有沒有被涵蓋」——一張逐格的密集旗標。
 *
 * ## 為什麼不是 `Set<string>`
 *
 * 水電覆蓋的 flood 每碰到一格就要 `${x},${y}` 配一個字串再雜湊一次，而查詢端
 * （`isPowered` / `isSupplied` / `isInCoverage`）每次呼叫也要配一個 —— 那三支
 * 被建築生長、廢棄判定、設施運轉、收入計算、圖層繪製各自逐格呼叫。
 *
 * 200x200 全蓋滿、24 座廠的測資實測，一輪三種公用事業要 4.3 秒，而那時剩下的
 * 成本幾乎全部是字串:`visited`、`coverage`、以及每個鄰居的 `toPosKey`。
 *
 * ## 尺寸
 *
 * 尺寸跟著 `calculateCoverage` 收到的 grid 走（`reset`），所以換地圖不必重建物件。
 * 還沒算過任何一輪時是空的 —— 跟空的 `Set` 一樣，什麼都回 false。
 */
export class CoverageBits {
  private bits = new Uint8Array(0);
  private _width = 0;
  private _height = 0;
  private _size = 0;

  get width(): number { return this._width; }
  get height(): number { return this._height; }
  /** 涵蓋了幾格。 */
  get size(): number { return this._size; }

  /**
   * 開始新的一輪:對上這張地圖的尺寸並清空。
   *
   * 尺寸沒變就只清內容 —— 每 6 個 tick 重配一張 25 萬格的陣列是白花的。
   */
  reset(width: number, height: number): void {
    const need = width * height;
    if (this._width !== width || this._height !== height) {
      this.bits = new Uint8Array(need);
      this._width = width;
      this._height = height;
    } else if (this._size > 0) {
      this.bits.fill(0);
    }
    this._size = 0;
  }

  /** @returns 這一格本來不在裡面。 */
  addIdx(idx: number): boolean {
    if (this.bits[idx] === 1) return false;
    this.bits[idx] = 1;
    this._size++;
    return true;
  }

  hasIdx(idx: number): boolean {
    return this.bits[idx] === 1;
  }

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this._width || y >= this._height) return false;
    return this.bits[y * this._width + x] === 1;
  }

  add(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this._width || y >= this._height) return false;
    return this.addIdx(y * this._width + x);
  }

  /** 涵蓋到的格子座標。**只給測試與偵錯用** —— 走訪整張地圖並且配物件。 */
  *cells(): Generator<{ x: number; y: number }> {
    for (let idx = 0; idx < this.bits.length; idx++) {
      if (this.bits[idx] === 1) yield { x: idx % this._width, y: (idx / this._width) | 0 };
    }
  }
}
