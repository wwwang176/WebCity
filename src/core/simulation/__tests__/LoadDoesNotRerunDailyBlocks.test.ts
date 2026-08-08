import { describe, it, expect, vi, afterEach } from 'vitest';
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
 *
 * These tests observe the BLOCKS' EFFECTS, not the bookkeeping fields. Asserting
 * `hasRunDayBlockFor(clock.getDay())` was a tautology: the constructor assigns
 * `lastDeathDay = clock.getDay()`, so the assertion reduced to
 * `getDay() === getDay()` and stayed green with the entire fix reverted.
 */

/** ticksPerDay = 24, 30 days per month → month boundary at tick 720. */
const TICKS_PER_DAY = 24;

/**
 * A city whose clock sits at `tickAt`, with one fertile adult per house so
 * every house keeps spare capacity (birthTick skips a home that is already
 * full, so the old 40-citizens-in-one-house fixture could never produce a
 * birth and could not have observed the month block at all).
 */
function cityAt(tickAt: number) {
  const state = createGameState(20, 20);
  for (let x = 2; x < 12; x++) {
    state.grid.setCell(x, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  state.clock.tick = tickAt;
  for (let x = 2; x < 12; x++) {
    // birthTick must be derived from the CURRENT tick: updateAges recomputes
    // age as (tick - birthTick) * AGE_PER_TICK, so a citizen created with
    // birthTick 0 is far past MAX_FERTILITY_AGE by tick 720 and birthTick
    // skips it — the block would look like it never ran.
    const c = state.citizens.createCitizen({ age: 100 }, tickAt)!;
    c.homeId = `${x},5`;
    c.happiness = 80;
  }
  return state;
}

/** Counts calls to the daily ring-buffer rotation, which only the day block makes. */
function countDayBlocks(state: ReturnType<typeof cityAt>): () => number {
  let calls = 0;
  const orig = state.deathCare.advanceDay.bind(state.deathCare);
  state.deathCare.advanceDay = () => { calls++; orig(); };
  return () => calls;
}

/** Counts calls to the daily rider rollover, which only the rider block makes. */
function countRiderRollovers(state: ReturnType<typeof cityAt>): () => number {
  let calls = 0;
  const orig = state.bus.rolloverDailyRiders.bind(state.bus);
  state.bus.rolloverDailyRiders = () => { calls++; orig(); };
  return () => calls;
}

describe('loading a save does not replay the current day or month', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('should not re-run the day block on the first tick after load', () => {
    // Mid-day: tick 710 is day 29, and 711 is still day 29.
    const restored = deserializeGameState(serializeGameState(cityAt(710)));
    const loop = new SimulationLoop(restored);
    const dayBlocks = countDayBlocks(restored);

    loop.tick();

    expect(restored.clock.getDay()).toBe(29);
    expect(dayBlocks()).toBe(0);
  });

  it('should not re-run the rider rollover on the first tick after load', () => {
    // lastRiderDay is a separate field with its own constructor assignment;
    // deleting that one line left every other test green.
    const restored = deserializeGameState(serializeGameState(cityAt(710)));
    const loop = new SimulationLoop(restored);
    const rollovers = countRiderRollovers(restored);

    loop.tick();

    expect(rollovers()).toBe(0);
  });

  it('should not re-run the month block on the first tick after load', () => {
    // Math.random() === 0 makes every fertile adult give birth, so a replayed
    // month block is guaranteed to show up as new citizens.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const restored = deserializeGameState(serializeGameState(cityAt(710)));
    const loop = new SimulationLoop(restored);
    const before = restored.citizens.getCitizens().length;

    loop.tick();

    expect(restored.clock.getMonth()).toBe(0);
    expect(restored.citizens.getCitizens().length).toBe(before);
  });

  it('should still run the day block and rider rollover when the day turns', () => {
    // Positive control: the guard must not suppress the block forever.
    const restored = deserializeGameState(serializeGameState(cityAt(TICKS_PER_DAY * 30 - 1)));
    const loop = new SimulationLoop(restored);
    const dayBlocks = countDayBlocks(restored);
    const rollovers = countRiderRollovers(restored);

    loop.tick();

    expect(restored.clock.getDay()).toBe(30);
    expect(dayBlocks()).toBe(1);
    expect(rollovers()).toBe(1);
  });

  it('should still run the month block when the month turns', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const restored = deserializeGameState(serializeGameState(cityAt(TICKS_PER_DAY * 30 - 1)));
    const loop = new SimulationLoop(restored);
    // A month boundary is also a day boundary, so the death block runs first —
    // and with Math.random() === 0 every citizen dies, leaving nobody fertile.
    // Neutralise the unrelated stochastic block so the birth block is observable.
    restored.citizens.deathTick = () => [];
    const before = restored.citizens.getCitizens().length;

    loop.tick();

    expect(restored.clock.getMonth()).toBe(1);
    expect(restored.citizens.getCitizens().length).toBeGreaterThan(before);
  });

  it('should run the day block on a brand new game as the first day turns', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const dayBlocks = countDayBlocks(state);

    for (let i = 0; i < TICKS_PER_DAY; i++) loop.tick();

    expect(state.clock.getDay()).toBe(1);
    expect(dayBlocks()).toBe(1);
  });
});
