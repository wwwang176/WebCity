/**
 * UnifiedRoadLookup — treats ground roads (level 0) and elevated roads
 * (levels 1-3) as one unified system.
 *
 * Provides cell lookup, neighbor discovery with level-compatibility rules,
 * and a complete list of all road cell keys.
 *
 * Pure logic module — no Three.js imports.
 */

import { RoadType, RoadDirection } from './types';
import { toPosKey, parsePosKeyUnsafe, parseLevelFromKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { ElevationManager } from '../elevation/ElevationManager';
import { MIN_ELEVATION_LEVEL, MAX_ELEVATION_LEVEL } from '../elevation/types';

export interface RoadCellInfo {
  roadType: number;
  roadFlags: number;
}

interface GridLike {
  readonly width: number;
  readonly height: number;
  getCell(x: number, y: number): { roadType: number; roadFlags: number } | null;
  forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void): void;
}

export class UnifiedRoadLookup {
  constructor(
    private grid: GridLike,
    private em: ElevationManager,
  ) {}

  /**
   * The map's size, taken from here rather than carried by the caller: whoever holds a lookup
   * holds the size, and two separate copies eventually disagree.
   */
  get width(): number { return this.grid.width; }
  get height(): number { return this.grid.height; }

  /** Create a lookup from a plain Grid (no elevation). */
  static fromGrid(grid: GridLike): UnifiedRoadLookup {
    return new UnifiedRoadLookup(grid, new ElevationManager());
  }

  /** Look up road data by key. Routes to Grid (level 0) or ElevationManager (level 1-3). */
  getCellByKey(key: string): RoadCellInfo | null {
    const level = parseLevelFromKey(key);
    const { x, y } = parsePosKeyUnsafe(key);
    if (level === 0) {
      const cell = this.grid.getCell(x, y);
      if (!cell || cell.roadType === RoadType.NONE) return null;
      return { roadType: cell.roadType, roadFlags: cell.roadFlags };
    }
    const seg = this.em.get(x, y, level);
    if (!seg || seg.roadType === RoadType.NONE) return null;
    return { roadType: seg.roadType, roadFlags: seg.roadFlags };
  }

  /**
   * Whether this position has any elevated level.
   *
   * A **fast negative** for hot loops: every `getCompatibleNeighborKeys` call parses the source
   * string key, allocates a result array and queries the cell again, and the utility coverage
   * flood calls it once per neighbour. In a city with a few elevated sections almost all of that
   * work is wasted, and this lets a caller ask whether there is anything elevated here and take
   * the cheap ground path when there is not.
   */
  hasElevatedAt(x: number, y: number): boolean {
    return this.em.levelsAt(x, y) !== 0;
  }

  /** Check if a cell key represents a ramp. */
  isRamp(key: string): boolean {
    const level = parseLevelFromKey(key);
    if (level === 0) return false;
    const { x, y } = parsePosKeyUnsafe(key);
    const seg = this.em.get(x, y, level);
    return seg?.isRamp ?? false;
  }

  /**
   * Get all cell keys at a neighbor position that are COMPATIBLE with the source key.
   *
   * Rules:
   * - Same level → always compatible
   * - Different level → compatible only if |diff| = 1 AND at least one side is a ramp
   */
  getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number): string[] {
    if (nx < 0 || ny < 0 || nx >= this.grid.width || ny >= this.grid.height) return [];

    const sourceLevel = parseLevelFromKey(sourceKey);
    const { x: sx, y: sy } = parsePosKeyUnsafe(sourceKey);
    const sourceIsRamp = this.isRamp(sourceKey);
    const sourceRampDir = sourceIsRamp && sourceLevel > 0
      ? this.em.get(sx, sy, sourceLevel)?.rampAscendDirection ?? 0
      : 0;
    const result: string[] = [];

    // Check ground level at neighbor
    const groundCell = this.grid.getCell(nx, ny);
    if (groundCell && groundCell.roadType !== RoadType.NONE) {
      const neighborLevel = 0;
      if (this.isCompatible(sourceLevel, sourceIsRamp, neighborLevel, false)
        && (!sourceIsRamp || this.isAlongRampAxis(sourceRampDir, sx, sy, nx, ny))) {
        result.push(toPosKey(nx, ny));
      }
    }

    // Check all elevated levels at neighbor.
    //
    // A bitmask of which levels this cell has is asked for once, and a position with no elevated
    // levels stops there. Asking about all three unconditionally allocated an `x,y,level` string
    // and did a Map lookup each time: `ElevationManager.get` measured 5.8% of the main thread on
    // a 40k save whose city had seven elevated sections in total.
    const mask = this.em.levelsAt(nx, ny);
    if (mask === 0) return result;
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      if ((mask & (1 << lv)) === 0) continue;
      const seg = this.em.get(nx, ny, lv);
      if (seg && seg.roadType !== RoadType.NONE) {
        if (this.isCompatible(sourceLevel, sourceIsRamp, lv, seg.isRamp)
          && (!sourceIsRamp || this.isAlongRampAxis(sourceRampDir, sx, sy, nx, ny))
          && (!seg.isRamp || this.isAlongRampAxis(seg.rampAscendDirection, nx, ny, sx, sy))) {
          result.push(`${nx},${ny},${lv}`);
        }
      }
    }

    return result;
  }

  /** Get all road cell keys at a specific (x, y) position across all levels. */
  getAllKeysAtPosition(x: number, y: number): string[] {
    if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) return [];
    const result: string[] = [];

    // Check ground level
    const groundCell = this.grid.getCell(x, y);
    if (groundCell && groundCell.roadType !== RoadType.NONE) {
      result.push(toPosKey(x, y));
    }

    // Check all elevated levels
    const mask = this.em.levelsAt(x, y);
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      if ((mask & (1 << lv)) === 0) continue;
      const seg = this.em.get(x, y, lv);
      if (seg && seg.roadType !== RoadType.NONE) {
        result.push(`${x},${y},${lv}`);
      }
    }

    return result;
  }

  /**
   * The ground road cell key at (x, y), or null if there is no road on the
   * ground there.
   *
   * This is what a building can reach. A viaduct deck has no driveway and is
   * not connected to the cell below it, so anything asking "which road does
   * this building open onto" wants this rather than `getAllKeysAtPosition`.
   */
  getGroundKeyAtPosition(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) return null;
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return null;
    return toPosKey(x, y);
  }

  /**
   * Is a ramp standing on this cell?
   *
   * A ramp climbs from the ground to the deck ACROSS its own cell, so its
   * structure occupies the ground there — unlike a viaduct, which passes
   * overhead with clearance.
   */
  hasRampAt(x: number, y: number): boolean {
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      if (this.em.get(x, y, lv)?.isRamp) return true;
    }
    return false;
  }

  /** Get ALL road cell keys (ground + elevated). */
  getAllCellKeys(): string[] {
    const keys: string[] = [];

    // Ground cells
    this.grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) {
        keys.push(toPosKey(x, y));
      }
    });

    // Elevated cells
    const entries = this.em.toJSON();
    for (const entry of entries) {
      if (entry.data.roadType !== RoadType.NONE) {
        keys.push(`${entry.x},${entry.y},${entry.level}`);
      }
    }

    return keys;
  }

  /** Level-compatibility check. */
  private isCompatible(
    srcLevel: number, srcIsRamp: boolean,
    dstLevel: number, dstIsRamp: boolean,
  ): boolean {
    if (srcLevel === dstLevel) return true;
    if (Math.abs(srcLevel - dstLevel) !== 1) return false;
    return srcIsRamp || dstIsRamp;
  }

  /** Check if the direction from (sx,sy) to (nx,ny) is along the ramp's axis. */
  private isAlongRampAxis(rampAscendDir: number, sx: number, sy: number, nx: number, ny: number): boolean {
    const dx = nx - sx;
    const dy = ny - sy;
    if (rampAscendDir & (RoadDirection.EAST | RoadDirection.WEST)) return dx !== 0;
    if (rampAscendDir & (RoadDirection.NORTH | RoadDirection.SOUTH)) return dy !== 0;
    return true; // unknown direction — allow
  }
}
