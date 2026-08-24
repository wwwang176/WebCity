/**
 * Whether a cell is covered — a dense per-cell flag array.
 *
 * ## Why not a `Set<string>`
 *
 * The utility coverage flood allocates and hashes a `${x},${y}` string for every cell it
 * touches, and each query (`isPowered` / `isSupplied` / `isInCoverage`) allocates another. Those
 * three are called per cell by building growth, abandonment, facility operation, income, and
 * overlay drawing.
 *
 * On a fully built 200x200 map with 24 plants, one pass over the three utilities measured 4.3
 * seconds, with almost all of the remaining cost in strings: `visited`, `coverage`, and a
 * `toPosKey` per neighbour.
 *
 * ## Size
 *
 * The size follows the grid `calculateCoverage` receives (`reset`), so changing map does not
 * require a new object. Before any pass it is empty and, like an empty `Set`, answers false to
 * everything.
 */
export class CoverageBits {
  private bits = new Uint8Array(0);
  private _width = 0;
  private _height = 0;
  private _size = 0;

  get width(): number { return this._width; }
  get height(): number { return this._height; }
  /** How many cells are covered. */
  get size(): number { return this._size; }

  /**
   * Begins a new pass: matches this map's size and clears.
   *
   * An unchanged size only clears the contents; reallocating a 250,000-cell array every 6 ticks
   * is wasted.
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

  /** @returns whether this cell was not already present. */
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

  /** The coordinates of the covered cells. **For tests and debugging only**: it walks the whole
   *  map and allocates an object per cell. */
  *cells(): Generator<{ x: number; y: number }> {
    for (let idx = 0; idx < this.bits.length; idx++) {
      if (this.bits[idx] === 1) yield { x: idx % this._width, y: (idx / this._width) | 0 };
    }
  }
}
