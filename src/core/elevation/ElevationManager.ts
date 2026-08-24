import { type ElevatedSegment, MAX_ELEVATION_LEVEL, MIN_ELEVATION_LEVEL } from './types';
import { RoadType } from '../road/types';

/**
 * Sparse storage for elevated road/rail segments (levels 1-3).
 * Ground level (0) data remains in CellData / Grid.
 *
 * Pure logic module — no Three.js imports.
 */
/**
 * Upper bound on y in a position key. Folding to one number keeps it inside SMI range; past
 * that V8 boxes the key as a heap number and Map lookups slow down, which defeats the only
 * reason this index exists.
 */
const POS_STRIDE = 8192;

export class ElevationManager {
  /** key = "x,y,level" → segment data */
  private layers = new Map<string, ElevatedSegment>();

  /**
   * Bitmask of which levels a cell occupies, keyed by folded numeric coordinates.
   *
   * **Derived data**: `layers` remains the single source of truth and this is only an index
   * that avoids asking three times, once per level. Every write path (`set`, `delete`,
   * `clear`, `fromJSON`) has to maintain it.
   *
   * The justification is measured. `UnifiedRoadLookup.getCompatibleNeighborKeys` asks all
   * three levels for every neighbour it probes, building an `x,y,level` string and a Map
   * lookup each time. On a 40,000-population save `ElevationManager.get` took **5.8%** of the
   * main thread in a city holding **7 elevated segments** in total. Asking the mask first
   * ends a position with no elevation in a single numeric lookup.
   */
  private levelMask = new Map<number, number>();

  private static key(x: number, y: number, level: number): string {
    return `${x},${y},${level}`;
  }

  private static posKey(x: number, y: number): number {
    return x * POS_STRIDE + y;
  }

  /**
   * Which levels this cell occupies: bit `level` set means something is there, 0 means nothing.
   *
   * This is **occupancy**, not road versus rail; a caller that needs the distinction still has
   * to fetch the segment and read `roadType`.
   */
  levelsAt(x: number, y: number): number {
    return this.levelMask.get(ElevationManager.posKey(x, y)) ?? 0;
  }

  /**
   * The range a position key can fold. Past it, two cells collide on one key.
   *
   * Out of reach in practice: `SaveValidator.IMPORT_LIMITS.MAX_GRID_DIMENSION` is 500 and the
   * game's own maps are smaller. This guards against a direct `new Grid(2, 9000)`.
   */
  private static validatePosition(x: number, y: number): void {
    if (x < 0 || y < 0 || y >= POS_STRIDE) {
      throw new RangeError(`elevated coordinate outside the position index range: (${x}, ${y})`);
    }
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
    ElevationManager.validatePosition(x, y);
    this.layers.set(ElevationManager.key(x, y, level), { ...data });
    const pk = ElevationManager.posKey(x, y);
    this.levelMask.set(pk, (this.levelMask.get(pk) ?? 0) | (1 << level));
  }

  delete(x: number, y: number, level: number): void {
    // The same guards as `set`. Without them the index diverges from `layers`: `1 << 33` is
    // `1 << 1` in JS (shifts are taken mod 32), so `delete(x, y, 33)` clears the bit for the
    // **actual level 1** while that segment stays in `layers`, invisible to every query
    // afterwards. Coordinates behave the same way: `(0, 8192)` and `(1, 0)` fold to one key.
    ElevationManager.validateLevel(level);
    ElevationManager.validatePosition(x, y);
    this.layers.delete(ElevationManager.key(x, y, level));
    const pk = ElevationManager.posKey(x, y);
    const mask = (this.levelMask.get(pk) ?? 0) & ~(1 << level);
    // An emptied cell leaves the index rather than keeping a 0. **This is an equivalent
    // mutation**: `levelsAt` answers the same for a missing key and a 0 value, so no test can
    // guard it. The reason is memory — without the delete, a city whose elevation was all torn
    // down keeps a dead table as large as every bridge it ever built.
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
   * **No production caller.** The workplace-distance cache has been level-aware since
   * BUG-109, so the elevation gate this once fed is gone. Kept because "does the city have
   * elevated road" is a reasonable question in itself; if nothing takes it up, deleting it
   * beats leaving it to mislead.
   *
   * Not hasAnySegment(): elevated RAIL lives in the same `layers` map with
   * roadType NONE, so the broader question lets a single elevated metro tile —
   * which contributes nothing to road reachability — answer yes.
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
    // Goes through clear() + set() rather than writing `layers` directly: index maintenance
    // lives in one place, and a load path that skips it diverges from the truth in silence.
    this.clear();
    for (const entry of entries) {
      this.set(entry.x, entry.y, entry.level, entry.data);
    }
  }
}
