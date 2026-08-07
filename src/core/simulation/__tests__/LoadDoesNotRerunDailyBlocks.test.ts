import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { serializeGameState, deserializeGameState } from '../../save/Serializer';
import { ZoneType } from '../../grid/types';

/**
 * lastDeathDay / lastBirthMonth / lastRiderDay start at -1 and are not
 * serialized, so the first tick after a load re-ran the current day's death
 * block and the current month's birth block regardless of how far into that
 * day or month the save was taken.
 *
 * Neither block is idempotent: deathTick rolls an independent per-citizen
 * chance with no per-day guard, and birthTick rolls the monthly fertility rate
 * for every fertile adult. Save-and-load was therefore a population lever —
 * repeat it to farm births, and eat an extra death roll each time.
 * advanceDay() on the deathcare/fire/garbage 7-day ring buffers also rotated a
 * slot early, discarding a day of statistics.
 */
function cityAtMidDay() {
  const state = createGameState(20, 20);
  for (let x = 2; x < 12; x++) {
    state.grid.setCell(x, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  for (let i = 0; i < 40; i++) {
    const c = state.citizens.createCitizen({ age: 100, birthTick: 0 })!;
    c.homeId = '5,5';
  }
  // Advance to a tick that is NOT on a day boundary.
  const loop = new SimulationLoop(state);
  for (let i = 0; i < 7; i++) loop.tick();
  return state;
}

describe('loading a save does not replay the current day or month', () => {
  it('should not re-run the day block on the first tick after load', () => {
    const state = cityAtMidDay();
    const savedDay = state.clock.getDay();

    const restored = deserializeGameState(serializeGameState(state));
    const loop = new SimulationLoop(restored);

    // Same day as the save: the daily block must not fire again.
    expect(restored.clock.getDay()).toBe(savedDay);
    expect(loop.hasRunDayBlockFor(savedDay)).toBe(true);
  });

  it('should not re-run the month block on the first tick after load', () => {
    const state = cityAtMidDay();
    const savedMonth = state.clock.getMonth();

    const restored = deserializeGameState(serializeGameState(state));
    const loop = new SimulationLoop(restored);

    expect(loop.hasRunMonthBlockFor(savedMonth)).toBe(true);
  });

  it('should still run the day block when the day actually turns', () => {
    const state = cityAtMidDay();
    const restored = deserializeGameState(serializeGameState(state));
    const loop = new SimulationLoop(restored);

    const startDay = restored.clock.getDay();
    let ticks = 0;
    while (restored.clock.getDay() === startDay && ticks < 200) { loop.tick(); ticks++; }

    expect(restored.clock.getDay()).not.toBe(startDay);
    expect(loop.hasRunDayBlockFor(restored.clock.getDay())).toBe(true);
  });

  it('should run the day block on a brand new game as the first day turns', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const startDay = state.clock.getDay();

    let ticks = 0;
    while (state.clock.getDay() === startDay && ticks < 200) { loop.tick(); ticks++; }

    expect(loop.hasRunDayBlockFor(state.clock.getDay())).toBe(true);
  });
});
