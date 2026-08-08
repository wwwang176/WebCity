import { describe, it, expect, vi } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';

/**
 * Births run in slow-slot 0 near the top of the tick; the per-day block —
 * updateAges, then deathTick — runs at the END of the same tick.
 *
 * A month boundary is `floor(day / 30)` changing, and a day boundary is
 * `floor(tick / 24)` changing, so the month boundary at tick 720 is ALSO a day
 * boundary. On that one tick a month, births happened first: birthTick chose
 * parents from ages last recomputed a day earlier, and every newborn was in the
 * list deathTick then walked, facing a death roll before it was a tick old.
 *
 * Moving the birth block after the daily one fixes both.
 *
 * The order is asserted from a trace rather than from population counts:
 * `createCitizenInKnownVacancy` is also how immigration adds people, so any
 * assertion phrased as "the population grew" measures migration, not birth.
 * (The first version of this file did exactly that and passed for the wrong
 * reason.)
 */
function fertileCity() {
  const state = createGameState(24, 24);
  for (let x = 1; x <= 20; x++) {
    state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    state.grid.setCell(x, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(x, 4, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  }
  state.power.addPlant({ x: 1, y: 1, output: 9000, pollution: 0, type: 'solar' });
  state.water.addPlant({ x: 2, y: 1, output: 9000 });
  state.power.calculateCoverage(state.grid);
  state.water.calculateCoverage(state.grid);

  for (let x = 1; x <= 20; x++) {
    for (let i = 0; i < 2; i++) {
      const c = state.citizens.createCitizen({ age: 60 });
      if (c) c.homeId = `${x},6`;
    }
  }
  return state;
}

/** Every stage of every tick, in order, tagged with the tick it ran on. */
function traceStages(state: ReturnType<typeof fertileCity>): Array<[number, string]> {
  const trace: Array<[number, string]> = [];
  const citizens = state.citizens as unknown as {
    updateAges: (t: number) => void;
    deathTick: (...a: unknown[]) => unknown;
  };

  const realAges = citizens.updateAges.bind(citizens);
  const realDeath = citizens.deathTick.bind(citizens);

  vi.spyOn(citizens, 'updateAges').mockImplementation((t: number) => {
    trace.push([state.clock.tick, 'ages']); return realAges(t);
  });
  vi.spyOn(citizens, 'deathTick').mockImplementation((...a: unknown[]) => {
    trace.push([state.clock.tick, 'death']); return realDeath(...a);
  });
  return trace;
}

/**
 * Mark the birth pass on a loop.
 *
 * Spying on a CitizenManager method cannot do it: `createCitizenInKnownVacancy`
 * is also how immigration adds people, and `updateResidentialCapacity` runs
 * every slow-slot-0 tick. Both were tried; both measured something else.
 */
function traceBirths(
  loop: SimulationLoop, trace: Array<[number, string]>, state: ReturnType<typeof fertileCity>,
): void {
  const priv = loop as unknown as { runBirths: () => void };
  const real = priv.runBirths.bind(priv);
  vi.spyOn(priv, 'runBirths').mockImplementation(() => {
    // Only record the ticks where it actually does something.
    const before = (loop as unknown as { lastBirthMonth: number }).lastBirthMonth;
    real();
    if ((loop as unknown as { lastBirthMonth: number }).lastBirthMonth !== before) {
      trace.push([state.clock.tick, 'births']);
    }
  });
}

/** Ticks on which a month boundary falls: floor(day/30) changes. */
const MONTH_BOUNDARY = 720;

describe('births are considered after the day has been aged and culled', () => {
  useSeededRandom();

  it('should age and cull before considering births, on the month boundary', () => {
    const state = fertileCity();
    const loop = new SimulationLoop(state);
    const trace = traceStages(state);
    traceBirths(loop, trace, state);

    for (let i = 0; i < MONTH_BOUNDARY + 40; i++) loop.tick();

    const onBoundary = trace.filter(([t]) => t === MONTH_BOUNDARY).map(([, s]) => s);
    expect(onBoundary, 'no births happened on the month boundary').toContain('births');
    expect(onBoundary, 'the fixture never reached a day boundary here').toContain('ages');
    expect(onBoundary).toContain('death');

    expect(onBoundary.indexOf('ages'), 'births ran before ageing')
      .toBeLessThan(onBoundary.indexOf('births'));
    expect(onBoundary.indexOf('death'), 'births ran before the death check')
      .toBeLessThan(onBoundary.indexOf('births'));
  });

  it('should still consider births every month', () => {
    // The control: "after the daily block" must not become "not at all". The
    // birth block is gated on the month CHANGING, so moving it must not skip a
    // month or fire twice.
    const state = fertileCity();
    const loop = new SimulationLoop(state);
    const trace = traceStages(state);
    traceBirths(loop, trace, state);

    for (let i = 0; i < MONTH_BOUNDARY * 3 + 40; i++) loop.tick();

    const ticks = trace.filter(([, s]) => s === 'births').map(([t]) => t);
    expect(ticks).toEqual([MONTH_BOUNDARY, MONTH_BOUNDARY * 2, MONTH_BOUNDARY * 3]);
  });
});
