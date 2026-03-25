import { RoadType } from '../../src/core/road/types';
import { parsePosKeyUnsafe, parseLevelFromKey, toPosKey } from '../../src/core/grid/GridHelpers';
import type { GridLookup } from '../../src/core/traffic/LaneGraph';

/**
 * Create a GridLookup from a Map of cell data.
 * Supports both "x,y" and "x,y,level" keys.
 * Implements the full GridLookup interface (getCellByKey + getCompatibleNeighborKeys).
 */
export function makeGridLookup(
  cells: Map<string, { roadType: RoadType; roadFlags: number }>,
): GridLookup {
  return {
    getCellByKey(key: string) {
      return cells.get(key) ?? null;
    },
    getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number) {
      const result: string[] = [];
      // Check ground key
      const groundKey = toPosKey(nx, ny);
      if (cells.has(groundKey)) result.push(groundKey);
      // Check elevated keys (level 1-3)
      for (let lv = 1; lv <= 3; lv++) {
        const elevKey = `${nx},${ny},${lv}`;
        if (cells.has(elevKey)) result.push(elevKey);
      }
      return result;
    },
  };
}
