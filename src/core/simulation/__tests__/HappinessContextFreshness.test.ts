import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { HAPPINESS } from '../../citizen/Happiness';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * The city-wide context is recomputed only every `SLOW_TICK_INTERVAL` ticks while slices run
 * every tick, so most slices in a cycle see the context as it was **when the cycle started**.
 *
 * Most of what the context holds is slow anyway (pollution, land value, service coverage) and
 * a few ticks of age costs nothing. The pending body and garbage queues are not: they are
 * short-lived events collected within a few ticks. From a stale snapshot, the slices covering
 * the interval between two refreshes never learn that a body is at the door.
 *
 * The queues are only as long as the outstanding pickups — unrelated to population — so
 * rebuilding them per tick is free.
 */

const HOME = '2,2';

function city(citizens: number, taxRate = 0.05): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(6, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  state.taxRates.residential = taxRate;
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({ age: 100, homeId: HOME, workplaceId: '6,2' });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** Mean happiness of the citizens updated this tick, identified by a NaN sentinel. */
function meanOfUpdated(state: GameState, loop: SimulationLoop): number {
  const citizens = state.citizens.getCitizens();
  for (const c of citizens) c.happiness = NaN;
  loop.tick();
  let sum = 0, n = 0;
  for (const c of citizens) if (!Number.isNaN(c.happiness)) { sum += c.happiness; n++; }
  return n > 0 ? sum / n : NaN;
}

/** Ticks up to the tick on which the context was just recomputed; the next tick is a slice
 *  reading the snapshot. */
function tickToJustAfterRefresh(state: GameState, loop: SimulationLoop): void {
  for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL * 3; i++) {
    loop.tick();
    if (state.clock.tick % SIMULATION.SLOW_TICK_INTERVAL === 4) return;
  }
  throw new Error('沒跑到慢速槽 4');
}

describe('待處理佇列的新鮮度', () => {
  it('should let a slice see a body reported after the context was built', () => {
    // A body reported after the context was rebuilt is invisible to the other five slices of
    // the cycle, and more slices means more missed: in a 72-slice city only 6 of 72 citizens
    // would know a body is at the door.
    const state = city(600);
    const loop = new SimulationLoop(state);
    tickToJustAfterRefresh(state, loop);

    const before = meanOfUpdated(state, loop);
    expect(Number.isNaN(before)).toBe(false);

    // The previous tick was not slow slot 4, so the tick below does not rebuild the context
    // either.
    expect(state.clock.tick % SIMULATION.SLOW_TICK_INTERVAL)
      .not.toBe(SIMULATION.SLOW_TICK_INTERVAL - 2);

    // Four bodies saturate the cap. The -20 cap is far larger than the commute jitter of +-3.
    for (let i = 0; i < 4; i++) state.deathCare.reportDeath(2, 2);

    const after = meanOfUpdated(state, loop);
    const drop = before - after;
    expect(drop, `報了四具屍體，這一片的平均只掉了 ${drop.toFixed(1)}`)
      .toBeGreaterThan(-HAPPINESS.DEATH_BODY_PENALTY_CAP * 0.75);
  });

  it('should stop penalising once the garbage is collected', () => {
    // Only the collection direction is testable: housing produces garbage every tick, so
    // there are already bags at the door when `before` is measured, and adding more only hits
    // the same cap.
    const state = city(600);
    const loop = new SimulationLoop(state);
    // Far more than the five bags needed to saturate the cap, so `before` is certainly at it.
    for (let i = 0; i < 40; i++) state.garbage.reportGarbage(2, 2, 1);
    tickToJustAfterRefresh(state, loop);

    const withGarbage = meanOfUpdated(state, loop);
    state.garbage.clearPendingAt(2, 2);

    const cleared = meanOfUpdated(state, loop);
    const recovered = cleared - withGarbage;
    expect(recovered, `垃圾收走了，這一片的平均只回升了 ${recovered.toFixed(1)}`)
      .toBeGreaterThan(-HAPPINESS.GARBAGE_BAG_PENALTY_CAP * 0.5);
  });

  it('should stop penalising once the bodies are collected', () => {
    // The other direction: the bodies are collected but the snapshot still holds them, and
    // this slice's citizens stay unhappy until the next rebuild.
    const state = city(600);
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 4; i++) state.deathCare.reportDeath(2, 2);
    tickToJustAfterRefresh(state, loop);

    const withBodies = meanOfUpdated(state, loop);
    state.deathCare.clearPendingAt(2, 2);

    const cleared = meanOfUpdated(state, loop);
    const recovered = cleared - withBodies;
    expect(recovered, `屍體收走了，這一片的平均只回升了 ${recovered.toFixed(1)}`)
      .toBeGreaterThan(-HAPPINESS.DEATH_BODY_PENALTY_CAP * 0.75);
  });
});

type Inner = { happinessContext: unknown };

describe('城市清空之後的情境', () => {
  it('should drop the cached context when the city empties', () => {
    // At `pop === 0` the rebuild returns early and the old context stays. While the population
    // is zero the player may change taxes, demolish services or let pollution move, and
    // citizens moving back in would be scored against the old context until the next slow
    // slot 4.
    //
    // This inspects the cached field rather than comparing happiness values: in a city emptied
    // and rebuilt, land value, crime and service coverage all restart, and the numeric
    // difference swamps the tax term. The invariant to pin is simply that no context is kept
    // while there is nobody.
    const state = city(400, 0.05);
    const loop = new SimulationLoop(state);
    tickToJustAfterRefresh(state, loop);
    expect((loop as unknown as Inner).happinessContext, '情境根本沒建起來').not.toBeNull();

    // Empty the city, demolishing the housing too: capacity is recomputed from the grid each
    // tick, so zeroing the number alone lets the same tick's migration refill the city and it
    // is never actually empty.
    for (const c of [...state.citizens.getCitizens()]) state.citizens.removeCitizen(c.id);
    state.grid.setCell(2, 2, { zoneType: ZoneType.NONE, buildingId: 0 });
    loop.tick();
    expect(state.citizens.getPopulation(), '城市沒有真的空過').toBe(0);

    expect((loop as unknown as Inner).happinessContext, '空城了還留著上一座城市的情境')
      .toBeNull();
  });

  it('should rebuild the context for citizens who move back in', () => {
    // After the context is invalidated, citizens who move back in must have happiness on the
    // next tick rather than waiting for the next slow slot 4.
    const state = city(400, 0.05);
    const loop = new SimulationLoop(state);
    tickToJustAfterRefresh(state, loop);
    for (const c of [...state.citizens.getCitizens()]) state.citizens.removeCitizen(c.id);
    state.grid.setCell(2, 2, { zoneType: ZoneType.NONE, buildingId: 0 });
    loop.tick();

    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    for (let i = 0; i < 400; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: HOME, workplaceId: '6,2' });
    }
    state.citizens.updateResidentialCapacity(1600);

    const mean = meanOfUpdated(state, loop);
    expect(Number.isNaN(mean), '重新遷入的第一個 tick 一個人都沒更新到').toBe(false);
    expect((loop as unknown as Inner).happinessContext, '情境沒有補建回來').not.toBeNull();
  });
});
