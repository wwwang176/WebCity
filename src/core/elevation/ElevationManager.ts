import { type ElevatedSegment, MAX_ELEVATION_LEVEL, MIN_ELEVATION_LEVEL } from './types';
import { RoadType } from '../road/types';

/**
 * Sparse storage for elevated road/rail segments (levels 1-3).
 * Ground level (0) data remains in CellData / Grid.
 *
 * Pure logic module — no Three.js imports.
 */
/**
 * 位置鍵的 y 上限。摺成一個數字是為了讓它留在 SMI 範圍內 —— 超出去 V8 會把
 * 鍵裝箱成堆積數字，Map 查詢就慢下來，而這個索引存在的唯一理由就是快。
 */
const POS_STRIDE = 8192;

export class ElevationManager {
  /** key = "x,y,level" → segment data */
  private layers = new Map<string, ElevatedSegment>();

  /**
   * 「這一格佔了哪幾層」的位元遮罩，鍵是摺起來的數字座標。
   *
   * **衍生資料** —— `layers` 仍然是唯一的真相，這裡只是一張避免逐層問三次的
   * 索引。所有寫入點（`set` / `delete` / `clear` / `fromJSON`）都要維護它。
   *
   * 存在的理由是量出來的:`UnifiedRoadLookup.getCompatibleNeighborKeys` 每探一個
   * 鄰居就無條件問三層，每問一次配一個 `x,y,level` 字串再查一次 Map。4 萬人的
   * 存檔實測 `ElevationManager.get` 佔主執行緒 **5.8%**，而那座城市總共只有
   * **7 段高架**。改成先問遮罩之後，沒有高架的位置一次數字查詢就結束。
   */
  private levelMask = new Map<number, number>();

  private static key(x: number, y: number, level: number): string {
    return `${x},${y},${level}`;
  }

  private static posKey(x: number, y: number): number {
    return x * POS_STRIDE + y;
  }

  /**
   * 這一格佔了哪幾層 —— 第 `level` 個位元為 1 代表那一層有東西。0 = 什麼都沒有。
   *
   * 這是**佔用**，不分道路或鐵軌;要區分的呼叫端仍然得取出 segment 看 `roadType`。
   */
  levelsAt(x: number, y: number): number {
    return this.levelMask.get(ElevationManager.posKey(x, y)) ?? 0;
  }

  private static validateLevel(level: number): void {
    if (level < MIN_ELEVATION_LEVEL || level > MAX_ELEVATION_LEVEL) {
      throw new RangeError(`Elevation level must be ${MIN_ELEVATION_LEVEL}-${MAX_ELEVATION_LEVEL}, got ${level}`);
    }
  }

  get(x: number, y: number, level: number): ElevatedSegment | null {
    return this.layers.get(ElevationManager.key(x, y, level)) ?? null;
  }

  set(x: number, y: number, level: number, data: ElevatedSegment): void {
    ElevationManager.validateLevel(level);
    if (y >= POS_STRIDE || x < 0 || y < 0) {
      throw new RangeError(`高架座標超出位置索引範圍: (${x}, ${y})`);
    }
    this.layers.set(ElevationManager.key(x, y, level), { ...data });
    const pk = ElevationManager.posKey(x, y);
    this.levelMask.set(pk, (this.levelMask.get(pk) ?? 0) | (1 << level));
  }

  delete(x: number, y: number, level: number): void {
    this.layers.delete(ElevationManager.key(x, y, level));
    const pk = ElevationManager.posKey(x, y);
    const mask = (this.levelMask.get(pk) ?? 0) & ~(1 << level);
    // 空的那一格移出索引而不是留一個 0。**這是等價變異** —— `levelsAt` 對
    // 「沒有這個鍵」與「值是 0」的回答一樣，所以沒有測試守得住它。理由是記憶體:
    // 不刪的話，拆光高架的城市會留下一張跟它曾經蓋過的橋一樣大的死表。
    if (mask === 0) this.levelMask.delete(pk); else this.levelMask.set(pk, mask);
  }

  /** Does the city contain any elevated segment at all? O(1). */
  hasAnySegment(): boolean {
    return this.layers.size > 0;
  }

  /** Returns all elevated segments at (x, y), sorted by level ascending. */
  getAllLevels(x: number, y: number): { level: number; data: ElevatedSegment }[] {
    const mask = this.levelsAt(x, y);
    const result: { level: number; data: ElevatedSegment }[] = [];
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if ((mask & (1 << level)) === 0) continue;
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (seg) result.push({ level, data: seg });
    }
    return result;
  }

  /** Check if any elevated segment exists at (x, y). */
  hasElevatedSegment(x: number, y: number): boolean {
    return this.levelsAt(x, y) !== 0;
  }

  /** Returns the highest occupied level at (x, y), or 0 if none. */
  getHighestLevel(x: number, y: number): number {
    const mask = this.levelsAt(x, y);
    return mask === 0 ? 0 : 31 - Math.clz32(mask);
  }

  /**
   * Does the city contain any elevated ROAD anywhere?
   *
   * **目前沒有 production 呼叫端。** 它原本只服務一件事：workplace 距離快取
   * 的高架閘門（「有高架就別用快取」）。BUG-109 治本之後快取本身就是樓層
   * 感知的，閘門已移除。保留是因為「城裡有沒有高架道路」本身是個合理的查詢，
   * 但如果一直沒人用，刪掉它比留著誤導好。
   *
   * Not hasAnySegment(): elevated RAIL lives in the same `layers` map with
   * roadType NONE, so asking the broader question let a single elevated metro
   * tile — which contributes nothing to road reachability — permanently
   * disable the workplace-distance cache for the whole city.
   */
  hasAnyElevatedRoad(): boolean {
    for (const seg of this.layers.values()) {
      if (seg.roadType !== 0) return true;
    }
    return false;
  }

  /**
   * The loudest elevated ROAD tier at (x, y), or RoadType.NONE.
   *
   * `rank` decides what "loudest" means and defaults to the enum ordinal —
   * which is NOT a noise ordering: ONE_WAY is 6 and HIGHWAY is 5, while their
   * noise factors are 1.2 and 2.0. The pollution caller passes its own table so
   * a one-way street stacked over a motorway cannot silence it.
   *
   * Not `get(x, y, getHighestLevel(x, y)).roadType`: an elevated RAIL deck has
   * roadType NONE, so stacking one over an elevated motorway made the whole
   * position report "no road" — the motorway went silent and the land under it
   * kept an inflated value. That is precisely the BUG-099 symptom the elevated
   * tier lookup exists to prevent, reintroduced one layer up.
   */
  getHighestRoadType(x: number, y: number, rank: (roadType: number) => number = t => t): number {
    const mask = this.levelsAt(x, y);
    if (mask === 0) return 0;
    let best = 0;
    let bestRank = 0;
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if ((mask & (1 << level)) === 0) continue;
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (!seg || seg.roadType === RoadType.NONE) continue;
      const r = rank(seg.roadType);
      if (best === 0 || r > bestRank) { best = seg.roadType; bestRank = r; }
    }
    return best;
  }

  /**
   * Which level a new elevated run should start from at (x, y).
   *
   * The level NEAREST the one being built, counting the ground (0) only when a
   * ground road is there; ties go to the lower level, which needs the cheaper
   * structure and is the likelier intent.
   *
   * getHighestLevel was wrong for this in both directions. With a ground road
   * under a level-3 deck and level 1 selected, it started at 3 and descended
   * instead of ramping up off the ground. And picking the top of a stack meant
   * an existing level-1 viaduct under a level-3 one could not be extended at
   * all. A segment already at the target level still wins, since its distance
   * is 0 — the previous special case is subsumed.
   */
  chooseStartLevel(x: number, y: number, targetLevel: number, hasGroundRoad: boolean): number {
    const mask = this.levelsAt(x, y);
    let best = hasGroundRoad ? 0 : -1;
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if ((mask & (1 << level)) === 0) continue;
      // A ROAD has to be there, not merely a segment. Elevated rail lives in
      // this same map with roadType 0 — the premise getHighestRoadType exists
      // for, twelve lines above. Asking only whether the level is occupied let
      // a rail deck win a tie against a road deck, and the placement loop then
      // wrote `roadType: existingAtStart.roadType`, i.e. 0: a paid, rendered,
      // maintained viaduct whose origin is not a road and which therefore has
      // no lane edge to anything (BUG-162, the BUG-097 symptom returning).
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (!seg || seg.roadType === RoadType.NONE) continue;
      if (best < 0) { best = level; continue; }
      const d = Math.abs(level - targetLevel);
      const bd = Math.abs(best - targetLevel);
      if (d < bd || (d === bd && level < best)) best = level;
    }
    return best < 0 ? 0 : best;
  }

  /**
   * Is there an elevated ROAD at (x, y), at any level?
   *
   * Distinct from hasElevatedSegment, which is true for an elevated railway
   * too — the same conflation chooseStartLevel above exists to avoid.
   */
  hasElevatedRoadAt(x: number, y: number): boolean {
    const mask = this.levelsAt(x, y);
    if (mask === 0) return false;
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if ((mask & (1 << level)) === 0) continue;
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (seg && seg.roadType !== RoadType.NONE) return true;
    }
    return false;
  }

  /** Check if any ramp occupies level `level` at (x, y) — either as low side or high side. */
  hasRampAtLevel(x: number, y: number, level: number): boolean {
    const mask = this.levelsAt(x, y);
    if (mask === 0) return false;
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      if ((mask & (1 << lv)) === 0) continue;
      const seg = this.layers.get(ElevationManager.key(x, y, lv));
      if (!seg || !seg.isRamp) continue;
      // Ramp stored at lv occupies lv (high side) and lv-1 (low side)
      if (lv === level || lv - 1 === level) return true;
    }
    return false;
  }

  clear(): void {
    this.layers.clear();
    this.levelMask.clear();
  }

  toJSON(): Array<{ x: number; y: number; level: number; data: ElevatedSegment }> {
    const entries: Array<{ x: number; y: number; level: number; data: ElevatedSegment }> = [];
    for (const [key, data] of this.layers) {
      const parts = key.split(',');
      entries.push({
        x: Number(parts[0]),
        y: Number(parts[1]),
        level: Number(parts[2]),
        data,
      });
    }
    return entries;
  }

  fromJSON(entries: Array<{ x: number; y: number; level: number; data: ElevatedSegment }>): void {
    // 走 clear() + set() 而不是自己寫進 layers —— 索引的維護只有一份，讀檔這條路
    // 少維護一次就會靜靜地跟真相分家。
    this.clear();
    for (const entry of entries) {
      this.set(entry.x, entry.y, entry.level, entry.data);
    }
  }
}
