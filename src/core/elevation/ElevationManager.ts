import { type ElevatedSegment, MAX_ELEVATION_LEVEL, MIN_ELEVATION_LEVEL } from './types';

/**
 * Sparse storage for elevated road/rail segments (levels 1-3).
 * Ground level (0) data remains in CellData / Grid.
 *
 * Pure logic module — no Three.js imports.
 */
export class ElevationManager {
  /** key = "x,y,level" → segment data */
  private layers = new Map<string, ElevatedSegment>();

  private static key(x: number, y: number, level: number): string {
    return `${x},${y},${level}`;
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
    this.layers.set(ElevationManager.key(x, y, level), { ...data });
  }

  delete(x: number, y: number, level: number): void {
    this.layers.delete(ElevationManager.key(x, y, level));
  }

  /** Does the city contain any elevated segment at all? O(1). */
  hasAnySegment(): boolean {
    return this.layers.size > 0;
  }

  /** Returns all elevated segments at (x, y), sorted by level ascending. */
  getAllLevels(x: number, y: number): { level: number; data: ElevatedSegment }[] {
    const result: { level: number; data: ElevatedSegment }[] = [];
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (seg) result.push({ level, data: seg });
    }
    return result;
  }

  /** Check if any elevated segment exists at (x, y). */
  hasElevatedSegment(x: number, y: number): boolean {
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if (this.layers.has(ElevationManager.key(x, y, level))) return true;
    }
    return false;
  }

  /** Returns the highest occupied level at (x, y), or 0 if none. */
  getHighestLevel(x: number, y: number): number {
    for (let level = MAX_ELEVATION_LEVEL; level >= MIN_ELEVATION_LEVEL; level--) {
      if (this.layers.has(ElevationManager.key(x, y, level))) return level;
    }
    return 0;
  }

  /**
   * Does the city contain any elevated ROAD anywhere?
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
   * The noisiest elevated ROAD tier at (x, y), or RoadType.NONE.
   *
   * Not `get(x, y, getHighestLevel(x, y)).roadType`: an elevated RAIL deck has
   * roadType NONE, so stacking one over an elevated motorway made the whole
   * position report "no road" — the motorway went silent and the land under it
   * kept an inflated value. That is precisely the BUG-099 symptom the elevated
   * tier lookup exists to prevent, reintroduced one layer up.
   */
  getHighestRoadType(x: number, y: number): number {
    let best = 0;
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      const seg = this.layers.get(ElevationManager.key(x, y, level));
      if (seg && seg.roadType > best) best = seg.roadType;
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
    let best = hasGroundRoad ? 0 : -1;
    for (let level = MIN_ELEVATION_LEVEL; level <= MAX_ELEVATION_LEVEL; level++) {
      if (!this.layers.has(ElevationManager.key(x, y, level))) continue;
      if (best < 0) { best = level; continue; }
      const d = Math.abs(level - targetLevel);
      const bd = Math.abs(best - targetLevel);
      if (d < bd || (d === bd && level < best)) best = level;
    }
    return best < 0 ? 0 : best;
  }

  /** Check if any ramp occupies level `level` at (x, y) — either as low side or high side. */
  hasRampAtLevel(x: number, y: number, level: number): boolean {
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      const seg = this.layers.get(ElevationManager.key(x, y, lv));
      if (!seg || !seg.isRamp) continue;
      // Ramp stored at lv occupies lv (high side) and lv-1 (low side)
      if (lv === level || lv - 1 === level) return true;
    }
    return false;
  }

  clear(): void {
    this.layers.clear();
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
    this.layers.clear();
    for (const entry of entries) {
      this.layers.set(
        ElevationManager.key(entry.x, entry.y, entry.level),
        { ...entry.data },
      );
    }
  }
}
