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
