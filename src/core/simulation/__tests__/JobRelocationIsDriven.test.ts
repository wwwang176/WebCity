import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * A job-relocation pass **completes within one tick**, once every
 * `JOB_RELOCATION_INTERVAL` ticks.
 *
 * These guard against the call being deleted, which would stop job changes entirely and
 * silently, with nothing else breaking.
 *
 * Slicing it (two citizens per tick) needed 503 ticks per pass — 9,478 at 100,000 citizens —
 * which amounts to the feature being off. With the workplace distance cache in place a whole
 * pass costs 7.7ms.
 */

type Internals = { runJobRelocation(): void };

function spiedLoop() {
  const state = createGameState(8, 8);
  const loop = new SimulationLoop(state);
  const inner = loop as unknown as Internals;
  const ticksRun: number[] = [];
  const orig = inner.runJobRelocation.bind(inner);
  inner.runJobRelocation = () => { ticksRun.push(state.clock.tick); orig(); };
  return { state, loop, ticksRun };
}

describe('the loop drives job relocation', () => {
  it('should run it once per JOB_RELOCATION_INTERVAL', () => {
    const { loop, ticksRun } = spiedLoop();
    const span = SIMULATION.JOB_RELOCATION_INTERVAL * 2;
    for (let i = 0; i < span; i++) loop.tick();

    expect(ticksRun.length, `${span} 個 tick 裡跑了 ${ticksRun.length} 次`).toBe(2);
    expect(ticksRun[1]! - ticksRun[0]!, '兩輪之間的間隔不對')
      .toBe(SIMULATION.JOB_RELOCATION_INTERVAL);
  });

  it('should not leave any cross-tick state behind', () => {
    // A slicer holds a list across ticks, and that list goes stale: candidate workplaces get
    // demolished, citizens die or leave (the BUG-331 family). Completing within one tick
    // leaves no such window.
    const { loop } = spiedLoop();
    for (let i = 0; i < SIMULATION.JOB_RELOCATION_INTERVAL + 5; i++) loop.tick();

    const inner = loop as unknown as Record<string, unknown>;
    expect(inner['jobRelocationSlicer'], 'jobRelocationSlicer 還在 —— 切片又回來了')
      .toBeUndefined();
  });

  it('should have no slice budget constant left', () => {
    // A leftover constant would suggest slicing is still expected.
    expect((SIMULATION as Record<string, unknown>)['JOB_RELOCATION_SLICE'],
      'JOB_RELOCATION_SLICE 還在').toBeUndefined();
  });
});

describe('換工作之後的通勤快取', () => {
  it('should drop the cached route of anyone who changed job', () => {
    // Without clearing it, that citizen keeps commuting along the route to their **old**
    // workplace, so the overlay, the statistics and vehicle spawning are all wrong until the
    // cache expires on its own.
    const state = createGameState(40, 40);
    for (let x = 0; x < 40; x++) {
      state.grid.setCell(x, 1, {
        roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      });
    }
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    // A workplace far enough to trigger "commute too long", plus a vacancy next to home.
    state.grid.setCell(30, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(4, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    for (let i = 0; i < 20; i++) {
      // Happiness held below the threshold of 35 so the trigger is unambiguous and does not
      // depend on the commute time being computable.
      state.citizens.restoreCitizen({
        age: 100, homeId: '2,2', workplaceId: '30,2', happiness: 10,
      });
    }
    state.citizens.updateResidentialCapacity(200);

    const loop = new SimulationLoop(state);
    const inner = loop as unknown as {
      runJobRelocation(): void;
      commuteCache: { remove(id: number): void };
    };
    const removed: number[] = [];
    const origRemove = inner.commuteCache.remove.bind(inner.commuteCache);
    inner.commuteCache.remove = (id: number) => { removed.push(id); origRemove(id); };

    const before = new Map(state.citizens.getCitizens().map(c => [c.id, c.workplaceId]));
    inner.runJobRelocation();
    const switched = state.citizens.getCitizens()
      .filter(c => before.get(c.id) !== c.workplaceId).map(c => c.id);

    expect(switched.length, '這個場景沒有人換工作 —— 測試什麼都沒測到')
      .toBeGreaterThan(0);
    for (const id of switched) {
      expect(removed, `市民 ${id} 換了工作，通勤快取卻沒清`).toContain(id);
    }
  });
});
