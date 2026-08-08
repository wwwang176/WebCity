import { describe, it, expect } from 'vitest';
import { runMigrations, CURRENT_SAVE_VERSION, MIGRATIONS } from '../migrations';
import { createGameState } from '../../simulation/GameState';
import { RoadType, RoadDirection } from '../../road/types';
import { serializeGameState, deserializeGameState } from '../Serializer';
import { LifeStage, AGE_PER_TICK } from '../../citizen/types';

describe('Save migrations', () => {
  it('CURRENT_SAVE_VERSION should match the highest migration version', () => {
    const maxVersion = Math.max(...MIGRATIONS.map(m => m.version));
    expect(CURRENT_SAVE_VERSION).toBe(maxVersion);
  });

  it('migrations should be sorted by version ascending', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i]!.version).toBeGreaterThan(MIGRATIONS[i - 1]!.version);
    }
  });

  it('runMigrations should return CURRENT_SAVE_VERSION', () => {
    const state = createGameState(10, 10);
    const result = runMigrations(state, 0);
    expect(result).toBe(CURRENT_SAVE_VERSION);
  });

  it('runMigrations should skip already-applied migrations', () => {
    const state = createGameState(10, 10);
    // Pretend save is already at current version
    const result = runMigrations(state, CURRENT_SAVE_VERSION);
    expect(result).toBe(CURRENT_SAVE_VERSION);
  });
});

describe('migration v2: fix_intersection_roadtype', () => {
  it('should upgrade intersection roadType to match highest neighbor', () => {
    const state = createGameState(20, 20);
    const grid = state.grid;

    // Build a FOUR_LANE E-W road at y=5
    for (let x = 3; x <= 7; x++) {
      let flags = 0;
      if (x > 3) flags |= RoadDirection.WEST;
      if (x < 7) flags |= RoadDirection.EAST;
      grid.setCell(x, 5, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
    }

    // Build a TWO_LANE N-S road at x=5 (overwrites intersection to TWO_LANE)
    for (let y = 3; y <= 7; y++) {
      let flags = 0;
      if (y > 3) flags |= RoadDirection.NORTH;
      if (y < 7) flags |= RoadDirection.SOUTH;
      // Merge flags at intersection
      if (y === 5) {
        const existing = grid.getCell(5, 5)!;
        flags |= existing.roadFlags;
      }
      grid.setCell(5, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }

    // Verify intersection is broken (TWO_LANE)
    expect(grid.getCell(5, 5)!.roadType).toBe(RoadType.TWO_LANE);

    // Run migration
    runMigrations(state, 1);

    // Intersection should now be FOUR_LANE
    expect(grid.getCell(5, 5)!.roadType).toBe(RoadType.FOUR_LANE);

    // Non-intersection cells should be unchanged
    expect(grid.getCell(4, 5)!.roadType).toBe(RoadType.FOUR_LANE);
    expect(grid.getCell(5, 4)!.roadType).toBe(RoadType.TWO_LANE);
  });

  it('should not change intersections that are already correct', () => {
    const state = createGameState(20, 20);
    const grid = state.grid;

    // Build a FOUR_LANE cross, all same type
    for (let x = 3; x <= 7; x++) {
      let flags = 0;
      if (x > 3) flags |= RoadDirection.WEST;
      if (x < 7) flags |= RoadDirection.EAST;
      grid.setCell(x, 5, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
    }
    for (let y = 3; y <= 7; y++) {
      if (y === 5) continue;
      let flags = 0;
      if (y > 3) flags |= RoadDirection.NORTH;
      if (y < 7) flags |= RoadDirection.SOUTH;
      grid.setCell(5, y, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
    }
    // Set intersection with all 4 flags
    grid.setCell(5, 5, {
      roadType: RoadType.FOUR_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });

    runMigrations(state, 1);

    // Should still be FOUR_LANE (no change needed)
    expect(grid.getCell(5, 5)!.roadType).toBe(RoadType.FOUR_LANE);
  });
});

// BUG-055: migration v3 detected legacy citizens by "birthTick is absent", but
// deserializeGameState restores citizens BEFORE running migrations and
// CitizenManager._addCitizen fabricates a birthTick ahead of the ...overrides
// spread — so the guard skipped every citizen and v3 never converted anyone.
describe('v3 citizen age migration (years -> life-weeks)', () => {
  /** A minimal but structurally complete version-2 save. */
  function legacySave(citizens: Record<string, unknown>[], tick = 5000): string {
    const base = JSON.parse(serializeGameState(createGameState(10, 10))) as Record<string, unknown>;
    base.version = 2;
    (base.clock as { tick: number }).tick = tick;
    base.citizens = citizens;
    return JSON.stringify(base);
  }

  it('should convert a legacy senior age from years to life-weeks', () => {
    const json = legacySave([
      {
        id: 1,
        age: 70,
        lifeStage: 'SENIOR',
        education: 'HIGH_SCHOOL',
        educationProgress: 80000,
        happiness: 50,
        health: 80,
        homeId: null,
        workplaceId: null,
      },
    ]);

    const restored = deserializeGameState(json);
    const c = restored.citizens.getCitizens()[0]!;

    // 70y -> 200 + (70-65) * (80/35) = 211.43 life-weeks
    expect(c.age).toBeCloseTo(211.43, 1);
    expect(c.lifeStage).toBe(LifeStage.SENIOR);
    // educationProgress rescaled 160000 -> 10000 thresholds
    expect(c.educationProgress).toBe(5000);
  });

  it('should anchor birthTick to the save clock, not tick 0', () => {
    const json = legacySave([
      { id: 1, age: 70, lifeStage: 'SENIOR', education: 'NONE', educationProgress: 0,
        happiness: 50, health: 80, homeId: null, workplaceId: null },
    ], 5000);

    const restored = deserializeGameState(json);
    const c = restored.citizens.getCitizens()[0]!;

    // birthTick must reproduce the age at the SAVED tick, not at tick 0.
    expect(5000 - c.birthTick).toBeCloseTo(c.age / AGE_PER_TICK, 0);
    expect(c.birthTick).toBeGreaterThan(-40000);
  });

  it('should convert a legacy child so schooling still applies', () => {
    const json = legacySave([
      { id: 1, age: 10, lifeStage: 'CHILD', education: 'NONE', educationProgress: 0,
        happiness: 50, health: 80, homeId: null, workplaceId: null },
    ]);

    const restored = deserializeGameState(json);
    const c = restored.citizens.getCitizens()[0]!;

    // 10y -> 8 + (10-5) * (24/7) = 25.14 life-weeks, still a CHILD
    expect(c.age).toBeCloseTo(25.14, 1);
    expect(c.lifeStage).toBe(LifeStage.CHILD);
  });

  it('should leave modern saves untouched', () => {
    const base = JSON.parse(serializeGameState(createGameState(10, 10))) as Record<string, unknown>;
    (base.clock as { tick: number }).tick = 5000;
    base.citizens = [
      { id: 1, birthTick: 1000, age: 24, lifeStage: 'CHILD', education: 'NONE',
        educationProgress: 0, happiness: 50, health: 80, homeId: null, workplaceId: null },
    ];

    const restored = deserializeGameState(JSON.stringify(base));
    const c = restored.citizens.getCitizens()[0]!;
    expect(c.age).toBe(24);
    expect(c.birthTick).toBe(1000);
  });
});
