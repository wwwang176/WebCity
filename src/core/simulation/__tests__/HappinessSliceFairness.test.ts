import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * The **fairness** of slicing: each citizen comes up exactly once per cycle, and nobody is
 * skipped indefinitely.
 *
 * `HappinessSliceWiring` only counts how many citizens a cycle updates, which cannot rule out
 * recomputing the same batch every tick while the rest never move — the total still matches.
 * These follow **identity** using a sentinel value.
 *
 * Recomputing the slice count each tick from the current population changes everyone's slice
 * index whenever the population crosses a multiple of `CITIZEN_SLICE_PER_TICK`, which
 * destroys the "exactly once per cycle" guarantee: with the population oscillating around a
 * threshold, a citizen can be constructed who goes hundreds of ticks without an update.
 */

function city(citizens: number): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(6, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({ age: 100, homeId: '2,2', workplaceId: '6,2' });
  }
  state.citizens.updateResidentialCapacity(citizens * 2);
  return state;
}

/**
 * A sentinel: set every citizen's happiness to NaN, tick once, and whoever is a number again
 * was updated this tick. Identifying by the real side effect avoids reimplementing the
 * slicing rule, so these tests survive a change of slicing scheme.
 */
function updatedThisTick(state: GameState, loop: SimulationLoop): Set<number> {
  const citizens = state.citizens.getCitizens();
  for (const c of citizens) c.happiness = NaN;
  loop.tick();
  const hit = new Set<number>();
  for (const c of citizens) if (!Number.isNaN(c.happiness)) hit.add(c.id);
  return hit;
}

describe('分片的公平性', () => {
  it('should update each citizen exactly once per cycle, by identity', () => {
    // Counting totals alone would pass "recompute the same 100 citizens every tick and never
    // touch the other 500": six ticks still sum to 600. These identify citizens individually.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick(); // build the context first, so the first cycle is a complete one
    const n = loop.lastHappinessSlice.slices;
    expect(n).toBeGreaterThan(0);

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    const timesUpdated = new Map<number, number>();
    for (let t = 0; t < n; t++) {
      for (const id of updatedThisTick(state, loop)) {
        timesUpdated.set(id, (timesUpdated.get(id) ?? 0) + 1);
      }
    }

    // Only citizens present for the whole cycle: arrivals and departures mid-cycle carry no
    // guarantee.
    const survivors = state.citizens.getCitizens().filter(c => before.has(c.id));
    expect(survivors.length).toBeGreaterThan(100);
    for (const c of survivors) {
      expect(timesUpdated.get(c.id) ?? 0, `市民 ${c.id} 在一輪 ${n} 個 tick 裡被更新了 ${timesUpdated.get(c.id) ?? 0} 次`)
        .toBe(1);
    }
  });

  it('should not re-slice mid-cycle when the population crosses a threshold', () => {
    // Changing the slice count mid-cycle reassigns everyone: citizens already processed can
    // land in a later slice, and citizens not yet processed can land in one already passed,
    // making them wait another whole cycle.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const startSlices = loop.lastHappinessSlice.slices;
    expect(startSlices, '600 人應該是最小片數').toBe(SIMULATION.SLOW_TICK_INTERVAL);

    // Jump past CITIZEN_SLICE_PER_TICK * SLOW_TICK_INTERVAL in one go, so the pure function's
    // slice count is certainly larger than startSlices.
    const target = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + 500;
    for (let i = state.citizens.getPopulation(); i < target; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: '2,2', workplaceId: '6,2' });
    }
    state.citizens.updateResidentialCapacity(target * 2);

    // The remaining ticks of this cycle must keep the count it started with.
    const seen: number[] = [];
    for (let t = loop.lastHappinessSlice.index + 1; t < startSlices; t++) {
      loop.tick();
      seen.push(loop.lastHappinessSlice.slices);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s, `一輪中途片數從 ${startSlices} 變成 ${s}`).toBe(startSlices);
    }

    // The new count takes effect at the next cycle.
    loop.tick();
    expect(loop.lastHappinessSlice.slices, '新的一輪還在用舊片數')
      .toBeGreaterThan(startSlices);
    expect(loop.lastHappinessSlice.index, '換片數的那個 tick 不是從第 0 片開始').toBe(0);
  });

  it('should only change the slice count at a cycle boundary', () => {
    // The test above pins one occurrence; this pins the rule: the slice count changes only at
    // index === 0.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    let prev = loop.lastHappinessSlice.slices;
    for (let t = 0; t < 40; t++) {
      // Move the population every tick so the pure function's slice count keeps changing.
      const pop = state.citizens.getPopulation();
      const want = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + (t % 2 === 0 ? 400 : -400);
      for (let i = pop; i < want; i++) {
        state.citizens.restoreCitizen({ age: 100, homeId: '2,2', workplaceId: '6,2' });
      }
      const ids = state.citizens.getCitizens().map(c => c.id);
      for (let i = ids.length - 1; i >= want && i >= 0; i--) {
        state.citizens.removeCitizen(ids[i]!);
      }
      state.citizens.updateResidentialCapacity(want * 4);

      loop.tick();
      const { slices, index } = loop.lastHappinessSlice;
      if (slices !== prev) {
        expect(index, `片數在一輪中途從 ${prev} 變成 ${slices}（index=${index}）`).toBe(0);
        prev = slices;
      }
    }
  });
});

describe('分片的成本', () => {
  it('should leave a citizen who arrived mid-cycle to the next cycle', () => {
    // The inverse test for **bucketing**. Buckets are built at the start of a cycle and each
    // tick walks only its own, so a citizen arriving mid-cycle has no bucket and is picked up
    // next cycle.
    //
    // An implementation that rescans the whole city every tick would process them in their
    // slice immediately and turn this red — and that scan is exactly what bucketing removes:
    // 42,000 citizens in 20 slices means **scanning 42,000 per tick to find 2,110**
    // (`citizenSliceOf` measured at 8.3% of the happiness pass and 40.6% of the health pass).
    //
    // The one-cycle lag matches the commute-side bucketing, and new citizens already carry
    // default happiness.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();   // builds the context and completes slice 0
    const n = loop.lastHappinessSlice.slices;
    expect(n, '片數太少，構造不出「一輪中途」').toBeGreaterThan(2);
    expect(loop.lastHappinessSlice.index, '前置條件:剛走完第 0 片').toBe(0);

    const newcomer = state.citizens.restoreCitizen({ age: 100, homeId: '2,2', workplaceId: '6,2' });
    // Happiness and health have separate buckets, each rebuilt at its own cycle start, so both
    // are checked.
    newcomer.happiness = NaN;
    newcomer.health = NaN;

    for (let t = 1; t < n; t++) loop.tick();
    expect(state.citizens.getCitizens().some(c => c.id === newcomer.id),
      '前置條件:那位市民中途被遷走了，這個測試沒有在驗東西').toBe(true);
    expect(Number.isNaN(newcomer.happiness),
      '一輪中途進來的人這一輪就被算到了 —— 代表每個 tick 都還在重掃全城').toBe(true);
    expect(Number.isNaN(newcomer.health), '健康那一份桶每個 tick 都在重建').toBe(true);

    for (let t = 0; t < n; t++) loop.tick();
    expect(Number.isNaN(newcomer.happiness), '下一輪還是沒輪到他').toBe(false);
    expect(Number.isNaN(newcomer.health), '下一輪還是沒輪到他（健康）').toBe(false);
  });
});
