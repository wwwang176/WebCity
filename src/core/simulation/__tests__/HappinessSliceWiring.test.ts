import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { citizenSliceCount, CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * Slicing is **round-robin, not sampling**: each citizen stores their own happiness and those
 * not due keep their previous value. What has to be pinned is that everyone gets a turn and
 * that nobody is skipped or counted twice, not a statistical margin.
 *
 * Measured at 70,891 citizens, the unsliced version put 68.5ms into a single tick, felt as a
 * stutter every 1.5 seconds (BUG-330).
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

type Inner = { refreshHappinessContext(): void };

describe('快樂度分片的接線', () => {
  it('should use the slice count the pure function decided', () => {
    // With the wiring broken (a hardcoded 6 slices, say), a large city's cost returns to
    // linear while every value-checking assertion stays green. The city has to be large
    // enough that the pure function returns more than the floor.
    const pop = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + 1000;
    const state = city(pop);
    expect(citizenSliceCount(state.citizens.getPopulation()),
      '城市不夠大，寫死下限也會過').toBeGreaterThan(SIMULATION.SLOW_TICK_INTERVAL);

    const loop = new SimulationLoop(state);
    loop.tick();
    expect(loop.lastHappinessSlice.slices, '片數跟純函式算的不一致')
      .toBe(citizenSliceCount(state.citizens.getPopulation()));
  });

  it('should cover the whole city in one cycle and no more', () => {
    const state = city(600);
    const loop = new SimulationLoop(state);
    const n = citizenSliceCount(state.citizens.getPopulation());

    let total = 0;
    const slicesSeen = new Set<number>();
    for (let t = 0; t < n; t++) {
      loop.tick();
      total += loop.lastHappinessSlice.updated;
      slicesSeen.add(loop.lastHappinessSlice.index);
    }
    expect(slicesSeen.size, `一輪 ${n} 個 tick 只走到 ${slicesSeen.size} 片`).toBe(n);
    // Exact equality cannot be pinned: citizens arrive and leave over these ticks and the
    // population itself moves. Missing one slice drops this to five sixths, which the
    // threshold catches.
    const pop = state.citizens.getPopulation();
    expect(total / pop, `一輪只算到 ${total} 位，人口 ${pop}`).toBeGreaterThan(0.95);
    expect(total / pop).toBeLessThan(1.05);
  });

  it('should keep a small city on the cadence it always had', () => {
    // In a small city each citizen still updates every SLOW_TICK_INTERVAL ticks; the cadence
    // is unchanged.
    const state = city(600);
    expect(citizenSliceCount(state.citizens.getPopulation()))
      .toBe(SIMULATION.SLOW_TICK_INTERVAL);
  });

  it('should spread the work evenly instead of dumping it on one tick', () => {
    // The point of the whole thing. Packed into slow slot 4, that single tick does all the
    // work.
    const state = city(600);
    const loop = new SimulationLoop(state);
    const n = citizenSliceCount(state.citizens.getPopulation());
    const perTick: number[] = [];
    for (let t = 0; t < n; t++) { loop.tick(); perTick.push(loop.lastHappinessSlice.updated); }

    const pop = state.citizens.getPopulation();
    for (const k of perTick) {
      expect(k, `某個 tick 算了 ${k} 位，遠多於平均的 ${(pop/n).toFixed(0)}`)
        .toBeLessThan(pop / n * 1.5);
    }
  });

  it('should build the city-wide context once per cycle, not once per tick', () => {
    // The context contains an O(population) adult count. Rerunning it every tick consumes what
    // slicing saves while producing an identical result, so no value-checking assertion would
    // turn red.
    const state = city(600);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Inner;
    let calls = 0;
    const orig = inner.refreshHappinessContext.bind(inner);
    inner.refreshHappinessContext = () => { calls++; orig(); };

    const n = SIMULATION.SLOW_TICK_INTERVAL;
    for (let t = 0; t < n * 3; t++) loop.tick();

    // Three slow cycles means three rebuilds. One extra at the start is allowed, for when no
    // context exists yet.
    expect(calls, `${n * 3} 個 tick 裡重算了 ${calls} 次全城情境`).toBeLessThanOrEqual(4);
    expect(calls, '全城情境根本沒被重算').toBeGreaterThanOrEqual(3);
  });

  it('should have happiness for everyone after the first cycle', () => {
    // The first few ticks of a new game have no context. Without the fallback rebuild, those
    // slices are skipped and the first cycle covers only part of the population.
    //
    // Citizens are identified individually rather than counted: "recompute the same batch
    // every tick" produces the same total. The sentinel is NaN, since at the start everyone's
    // happiness is the default and "has a value" cannot tell who was computed.
    const state = city(600);
    const loop = new SimulationLoop(state);
    for (const c of state.citizens.getCitizens()) c.happiness = NaN;

    const n = citizenSliceCount(state.citizens.getPopulation());
    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    for (let t = 0; t < n; t++) loop.tick();

    const skipped = state.citizens.getCitizens()
      .filter(c => before.has(c.id) && Number.isNaN(c.happiness));
    expect(skipped.length, `第一輪有 ${skipped.length} 位市民完全沒被算到`).toBe(0);
  });
});
