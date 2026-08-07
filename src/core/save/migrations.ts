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
import { HEALTH } from '../service/HealthService';
import { POLICE } from '../service/PoliceService';
import { FIRE } from '../service/FireService';
import { PARK } from '../service/ParkService';
import { GARBAGE } from '../service/GarbageService';
import { DEATH_CARE } from '../service/DeathCareService';
import { DEFAULT_RADIUS as EDU_RADIUS, DEFAULT_CAPACITY as EDU_CAPACITY } from '../service/EducationService';
import type { SchoolType } from '../service/EducationService';

export interface SaveMigration {
  /** Target version — this migration runs when save version < this value. */
  version: number;
  /** Human-readable name for logging. */
  name: string;
  /** Mutate the GameState in place. */
  migrate(state: GameState): void;
}

/** Current save version. Increment when adding a new migration. */
export const CURRENT_SAVE_VERSION = 6;

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
    // Intentionally empty. This conversion CANNOT run against a live GameState:
    // deserializeGameState restores citizens before migrations, and
    // CitizenManager._addCitizen materialises `birthTick` ahead of the
    // ...overrides spread — so by the time a GameState migration sees them, the
    // "no birthTick" signal that identifies legacy citizens is already gone and
    // the guard skips everyone (BUG-055).
    // The real conversion runs pre-restore, on the raw payload:
    // see migrateSavedCitizens() below, called from deserializeGameState.
    migrate() {},
  },
  {
    version: 4,
    name: 'update_facility_balance_constants',
    migrate(state: GameState): void {
      let updated = 0;

      // Update hospitals
      for (const h of state.health.getHospitals() as any[]) {
        h.capacity = HEALTH.DEFAULT_CAPACITY;
        h.radius = HEALTH.DEFAULT_RADIUS;
        updated++;
      }

      // Update police stations
      for (const s of state.police.getStations() as any[]) {
        s.capacity = POLICE.DEFAULT_CAPACITY;
        s.radius = POLICE.DEFAULT_RADIUS;
        updated++;
      }

      // Update fire stations
      for (const s of state.fire.getStations() as any[]) {
        s.capacity = FIRE.DEFAULT_CAPACITY;
        s.radius = FIRE.DEFAULT_RADIUS;
        updated++;
      }

      // Update schools (each type has its own radius/capacity)
      for (const s of state.education.getSchools() as any[]) {
        const type: SchoolType = s.type;
        s.radius = EDU_RADIUS[type];
        s.capacity = EDU_CAPACITY[type];
        updated++;
      }

      // Update garbage facilities
      for (const f of state.garbage.getFacilities() as any[]) {
        f.capacity = GARBAGE.DEFAULT_CAPACITY;
        updated++;
      }

      // Update cemeteries (death care)
      for (const c of state.deathCare.getCemeteries() as any[]) {
        c.capacity = DEATH_CARE.DEFAULT_CAPACITY;
        updated++;
      }

      // Update parks
      for (const p of state.parks.getParks() as any[]) {
        p.radius = PARK.DEFAULT_RADIUS;
        updated++;
      }

      if (updated > 0) {
        console.log(`[Migration] update_facility_balance_constants: updated ${updated} facility(ies)`);
      }
    },
  },
  {
    version: 5,
    name: 'rebalance_emergency_service_capacities',
    migrate(state: GameState): void {
      // Police: 1000 → 2000, Hospital: 1500 → 1750, Fire: 2000 → 2500
      let updated = 0;

      for (const s of state.police.getStations() as any[]) {
        s.capacity = POLICE.DEFAULT_CAPACITY;
        updated++;
      }
      for (const h of state.health.getHospitals() as any[]) {
        h.capacity = HEALTH.DEFAULT_CAPACITY;
        updated++;
      }
      for (const s of state.fire.getStations() as any[]) {
        s.capacity = FIRE.DEFAULT_CAPACITY;
        updated++;
      }

      if (updated > 0) {
        console.log(`[Migration] rebalance_emergency_service_capacities: updated ${updated} facility(ies)`);
      }
    },
  },
  {
    version: 6,
    name: 'serialize_districts_policies_cityspec',
    // No-op by design. Districts, policies, city specialization and the global
    // market were never written by saves <= v5 (BUG-053), so there is nothing to
    // convert — pre-v6 saves correctly load with these at their defaults. The
    // version bump exists so SaveValidator and future migrations can tell the
    // two eras apart.
    migrate() {},
  },
];

/**
 * Pre-restore migration: convert legacy citizen ages from years (0-100) to
 * life-weeks (0-280), using a piecewise linear mapping that preserves the
 * life-stage boundaries.
 *
 * This MUST run on the raw saved payload, before CitizenManager restores the
 * citizens — restoring fabricates a birthTick, which erases the only signal
 * distinguishing a legacy citizen from a modern one (BUG-055).
 *
 * @param citizens The raw `citizens` array from the save (mutated in place).
 * @param saveVersion The version stored in the save file (0 if missing).
 * @param tick The saved clock tick, so birthTick encodes the age at save time.
 */
export function migrateSavedCitizens(
  citizens: Array<Record<string, any>> | undefined,
  saveVersion: number,
  tick: number,
): number {
  if (!citizens || saveVersion >= 3) return 0;

  let converted = 0;
  for (const c of citizens) {
    if (c.birthTick !== undefined && c.birthTick !== null) continue; // already new format
    const oldAge: number = c.age;
    let newAge: number;
    if (oldAge <= 5)       newAge = oldAge * (8 / 5);                     // 0-5y → 0-8wk
    else if (oldAge <= 12) newAge = 8 + (oldAge - 5) * (24 / 7);         // 5-12y → 8-32wk
    else if (oldAge <= 18) newAge = 32 + (oldAge - 12) * (20 / 6);       // 12-18y → 32-52wk
    else if (oldAge <= 65) newAge = 52 + (oldAge - 18) * (148 / 47);     // 18-65y → 52-200wk
    else                   newAge = 200 + (oldAge - 65) * (80 / 35);     // 65-100y → 200-280wk

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
  return converted;
}

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
