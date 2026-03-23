/**
 * UnifiedRoadLookup — treats ground roads (level 0) and elevated roads
 * (levels 1-3) as one unified system.
 *
 * Provides cell lookup, neighbor discovery with level-compatibility rules,
 * and a complete list of all road cell keys.
 *
 * Pure logic module — no Three.js imports.
 */

import { RoadType } from './types';
import { toPosKey, parsePosKeyUnsafe, parseLevelFromKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { type ElevationManager } from '../elevation/ElevationManager';
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
    const sourceIsRamp = this.isRamp(sourceKey);
    const result: string[] = [];

    // Check ground level at neighbor
    const groundCell = this.grid.getCell(nx, ny);
    if (groundCell && groundCell.roadType !== RoadType.NONE) {
      const neighborLevel = 0;
      if (this.isCompatible(sourceLevel, sourceIsRamp, neighborLevel, false)) {
        result.push(toPosKey(nx, ny));
      }
    }

    // Check all elevated levels at neighbor
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      const seg = this.em.get(nx, ny, lv);
      if (seg && seg.roadType !== RoadType.NONE) {
        if (this.isCompatible(sourceLevel, sourceIsRamp, lv, seg.isRamp)) {
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
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      const seg = this.em.get(x, y, lv);
      if (seg && seg.roadType !== RoadType.NONE) {
        result.push(`${x},${y},${lv}`);
      }
    }

    return result;
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
}
