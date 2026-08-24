import type { Grid } from '../grid/Grid';
import { normalizeRect } from '../grid/GridHelpers';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import type { ElevationManager } from '../elevation/ElevationManager';
import { MIN_ELEVATION_LEVEL, MAX_ELEVATION_LEVEL } from '../elevation/types';
import { classifyDemolishCell } from './DemolishClassifier';
import { isInfrastructureBuilding } from './InfraConfig';
import { findPrimaryCell } from './InfraPlacement';

/**
 * What one demolish pass will clear.
 *
 * ## Why this exists
 *
 * Without a tally, demolish answers with **three constants**: `cost` always 0 (demolition
 * does not touch the wallet), `ok` always true (demolition raises no notification), no
 * `reason` and no `info`. Clearing 42 cells and clearing 0 cells then produce identical
 * responses, and a program cannot tell whether it achieved anything (BUG-366).
 *
 * ## Why it scans before demolishing instead of counting inside the loop
 *
 * Separating counting from destruction keeps counting a pure function. `Game.demolish()`
 * imports Three.js directly, so rules written inside that loop cannot be loaded by unit tests
 * and can break with every test still green.
 *
 * The price is walking the same rectangle twice. Classification is **shared through
 * `classifyDemolishCell`**, so both passes apply one set of rules; a second copy of the
 * judgement is the mistake this repo keeps paying for.
 */
export interface DemolishTally {
  /** Cells where something was cleared. **Counted once each**: a bridge and the road under it are one cell. */
  cells: number;
  /** Zoned buildings (residential, commercial, industrial, office). */
  buildings: number;
  /** Ground-level road cells. */
  roads: number;
  /** Ground-level rail cells. */
  rails: number;
  /** Civic and utility facilities. A multi-cell building counts as **one**, not one per cell. */
  infrastructure: number;
  /**
   * Zoned cells cleared.
   *
   * A **different question** from `buildings` (how many buildings went vs how many zoned
   * cells were cleared), so residential land carrying a building falls into both. For the
   * de-duplicated total, read `cells`.
   */
  zones: number;
  /** Elevated **segments**. Two levels stacked on one cell count as 2. */
  elevated: number;
}

export const EMPTY_DEMOLISH_TALLY: DemolishTally = {
  cells: 0, buildings: 0, roads: 0, rails: 0, infrastructure: 0, zones: 0, elevated: 0,
};

/**
 * Scans the rectangle and counts what this demolish pass would clear. **Mutates nothing.**
 *
 * Out-of-bounds cells are skipped (`grid.getCell` returns null), and the rectangle may be
 * given corners in either order.
 */
export function tallyDemolish(
  grid: Grid,
  elevation: ElevationManager,
  x1: number, y1: number, x2: number, y2: number,
): DemolishTally {
  const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
  const t: DemolishTally = { ...EMPTY_DEMOLISH_TALLY };
  // A multi-cell facility is met once per cell it occupies; only the first one counts.
  const infraSeen = new Set<string>();

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = grid.getCell(x, y);
      if (!cell) continue;

      let touched = false;

      for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
        if (elevation.get(x, y, lv)) { t.elevated++; touched = true; }
      }

      const primary = isInfrastructureBuilding(cell.buildingId)
        ? findPrimaryCell(grid, x, y) : null;
      const action = classifyDemolishCell(cell, primary);

      switch (action.action) {
        case 'skip': break;
        case 'multi_cell_infra': {
          const key = `${action.primaryX},${action.primaryY}`;
          if (!infraSeen.has(key)) { infraSeen.add(key); t.infrastructure++; }
          touched = true;
          break;
        }
        case 'single_cell_infra':
          t.infrastructure++;
          touched = true;
          break;
        case 'regular':
          if (cell.buildingId !== 0) { t.buildings++; touched = true; }
          if (cell.roadType !== RoadType.NONE) { t.roads++; touched = true; }
          if (action.hasTrack) { t.rails++; touched = true; }
          if (cell.zoneType !== ZoneType.NONE) { t.zones++; touched = true; }
          // `reserved` (abandoned, burned, rotation, multi-cell occupancy) has no category of
          // its own and needs none: nowhere in the repo is it written on a cell whose
          // `buildingId === 0`, so it is always counted alongside a building or a facility.
          // A branch of its own would be dead code no test could reach.
          break;
      }

      if (touched) t.cells++;
    }
  }

  return t;
}
