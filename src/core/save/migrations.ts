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
import { getLifeStage, AGE_PER_TICK } from '../citizen/types';

export interface SaveMigration {
  /** Target version — this migration runs when save version < this value. */
  version: number;
  /** Human-readable name for logging. */
  name: string;
  /** Mutate the GameState in place. */
  migrate(state: GameState): void;
}

/** Current save version. Increment when adding a new migration. */
export const CURRENT_SAVE_VERSION = 3;

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
  {
    version: 3,
    name: 'convert_citizen_age_to_life_weeks',
    migrate(state: GameState): void {
      // Old saves stored age in years (0-100). New system uses life-weeks (0-280).
      // Piecewise linear mapping preserving life-stage boundaries.
      const tick = state.clock.tick;
      const citizens = state.citizens.getCitizens() as any[];
      let converted = 0;
      for (const c of citizens) {
        if (c.birthTick !== undefined && c.birthTick !== null) continue; // already new format
        const oldAge: number = c.age;
        let newAge: number;
        if (oldAge <= 5)       newAge = oldAge * (8 / 5);                      // 0-5y → 0-8wk
        else if (oldAge <= 12) newAge = 8 + (oldAge - 5) * (24 / 7);          // 5-12y → 8-32wk
        else if (oldAge <= 18) newAge = 32 + (oldAge - 12) * (20 / 6);        // 12-18y → 32-52wk
        else if (oldAge <= 65) newAge = 52 + (oldAge - 18) * (148 / 47);      // 18-65y → 52-200wk
        else                   newAge = 200 + (oldAge - 65) * (80 / 35);      // 65-100y → 200-280wk
        c.age = newAge;
        c.birthTick = Math.round(tick - newAge / AGE_PER_TICK);
        c.lifeStage = getLifeStage(newAge);
        // Scale education progress proportionally (old thresholds → new thresholds)
        if (c.educationProgress > 0) {
          const OLD_THRESHOLDS: Record<string, number> = { NONE: 240000, ELEMENTARY: 200000, HIGH_SCHOOL: 160000 };
          const NEW_THRESHOLDS: Record<string, number> = { NONE: 15000, ELEMENTARY: 12000, HIGH_SCHOOL: 10000 };
          const oldT = OLD_THRESHOLDS[c.education] ?? 240000;
          const newT = NEW_THRESHOLDS[c.education] ?? 15000;
          c.educationProgress = Math.round(c.educationProgress * (newT / oldT));
        }
        converted++;
      }
      if (converted > 0) {
        console.log(`[Migration] convert_citizen_age_to_life_weeks: converted ${converted} citizen(s)`);
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
