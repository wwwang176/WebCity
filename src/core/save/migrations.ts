/**
 * Save migration system — automatically patches old saves on load.
 *
 * Each migration has a target version and a migrate function.
 * On load, all migrations with version > save's version run in order.
 * After all migrations, the save version is updated to CURRENT_SAVE_VERSION.
 *
 * To add a new migration:
 * 1. Increment CURRENT_SAVE_VERSION
 * 2. Add a new entry to MIGRATIONS array with { version, name, migrate }
 */

import type { GameState } from '../simulation/GameState';
import { RoadType } from '../road/types';
import { CARDINAL_DIRECTIONS } from '../grid/GridHelpers';

export interface SaveMigration {
  /** Target version — this migration runs when save version < this value. */
  version: number;
  /** Human-readable name for logging. */
  name: string;
  /** Mutate the GameState in place. */
  migrate(state: GameState): void;
}

/** Current save version. Increment when adding a new migration. */
export const CURRENT_SAVE_VERSION = 2;

/** Ordered list of migrations. Must be sorted by version ascending. */
export const MIGRATIONS: readonly SaveMigration[] = [
  {
    version: 2,
    name: 'fix_intersection_roadtype',
    migrate(state: GameState): void {
      // Fix intersections where a lower-type road overwrote a higher-type road.
      // Scan all road cells with 3+ directions (intersections) and upgrade
      // their roadType to the max of their neighbors.
      const grid = state.grid;
      const fixes: { x: number; y: number; roadType: number }[] = [];

      grid.forEachCell((cell, x, y) => {
        if (cell.roadType === RoadType.NONE) return;

        // Count directions
        let dirCount = 0;
        if (cell.roadFlags & 1) dirCount++;
        if (cell.roadFlags & 2) dirCount++;
        if (cell.roadFlags & 4) dirCount++;
        if (cell.roadFlags & 8) dirCount++;
        if (dirCount < 3) return; // not an intersection

        // Find max neighbor roadType
        let maxNeighborType = cell.roadType;
        for (const dir of CARDINAL_DIRECTIONS) {
          const neighbor = grid.getCell(x + dir.dx, y + dir.dy);
          if (neighbor && neighbor.roadType > maxNeighborType) {
            maxNeighborType = neighbor.roadType;
          }
        }

        if (maxNeighborType > cell.roadType) {
          fixes.push({ x, y, roadType: maxNeighborType });
        }
      });

      for (const fix of fixes) {
        grid.setCell(fix.x, fix.y, { roadType: fix.roadType });
      }

      if (fixes.length > 0) {
        console.log(`[Migration] fix_intersection_roadtype: upgraded ${fixes.length} intersection(s)`);
      }
    },
  },
];

/**
 * Run all pending migrations on a loaded GameState.
 * @param state The deserialized GameState to migrate.
 * @param saveVersion The version stored in the save file (0 if missing).
 * @returns The new version after all migrations.
 */
export function runMigrations(state: GameState, saveVersion: number): number {
  for (const migration of MIGRATIONS) {
    if (saveVersion < migration.version) {
      console.log(`[Migration] Running v${migration.version}: ${migration.name}`);
      migration.migrate(state);
    }
  }
  return CURRENT_SAVE_VERSION;
}
