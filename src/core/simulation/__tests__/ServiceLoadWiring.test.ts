import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { EducationLevel } from '../../citizen/types';

/**
 * Service load is computed by counting citizens per cell first and then querying, so the
 * **headcount** has to reach the services intact.
 *
 * `count` is optional (existing callers omit it), so leaving it out is not a type error and
 * the whole city's demand silently collapses to one citizen per building. With 12,434
 * citizens in 103 buildings, that is a hundred-and-twentieth of the real demand.
 *
 * These intercept what SimulationLoop hands the services rather than reading the resulting
 * load ratios: a load ratio is only non-zero when the facility has power and a road
 * connection, neither of which has anything to do with this seam.
 */

const HOME = '2,2';
const WORK = '6,2';

function city(citizens: number, education = EducationLevel.HIGH_SCHOOL): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(6, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({ age: 100, homeId: HOME, workplaceId: WORK, education });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** Runs two full slow cycles so slot 4 is guaranteed to have run. */
function runSlowCycles(loop: SimulationLoop): void {
  for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL * 2; i++) loop.tick();
}

type Entry = { x: number; y: number; count?: number; weight?: number };

/** Stubs out the coverage check and captures the entries this city feeds into a service. */
function capture(
  state: GameState,
  service: { getCoverage: unknown },
  method: string,
): Entry[][] {
  const calls: Entry[][] = [];
  const s = service as unknown as Record<string, unknown>;
  s['getCoverage'] = () => true;
  s[method] = (...args: unknown[]) => {
    calls.push(...args.map(a => [...(a as Entry[])]));
  };
  return calls;
}

describe('服務負載的人數有傳下去', () => {
  it('should tell the hospital how many people live at each address', () => {
    const state = city(800);
    const calls = capture(state, state.health, 'updateLoads');
    runSlowCycles(new SimulationLoop(state));

    const last = calls[calls.length - 1]!;
    const home = last.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進醫院').toBeDefined();
    expect(last.length, `一棟樓生出 ${last.length} 筆條目`).toBe(1);
    // Exact equality cannot be pinned: the index is built in slow slot 4, several ticks have
    // passed since, and citizens are born and die in between. Omitting `count` makes this
    // number 1, which the threshold catches.
    const pop = state.citizens.getPopulation();
    expect(home!.count! / pop, `醫院收到的人數是 ${home!.count}，城裡有 ${pop} 人`)
      .toBeGreaterThan(0.9);
    expect(home!.count! / pop).toBeLessThan(1.1);
  });

  it('should have a fresh index on the daily death tick, not slot 4 leftovers', () => {
    // The daily death settlement calls updateHospitalLoads, and it runs after slow slot 5
    // (migration, housing, relocation), so a slot-4 index would miss citizens who just moved
    // in and count citizens who just moved out.
    //
    // Loading is worse: a SimulationLoop constructed after slot 4 but before the day boundary
    // still has an empty index, hospital demand comes out as 0, and the death rate gets a
    // wrongly low multiplier. This reproduces that.
    const state = city(800);
    state.clock.tick = 23;          // the next tick crosses the day boundary (ticksPerDay = 24)
    const calls = capture(state, state.health, 'updateLoads');
    const loop = new SimulationLoop(state);
    loop.tick();
    expect(state.clock.tick, '沒有踩到日界').toBe(24);

    expect(calls.length, '日界那一個 tick 沒有更新醫院負載').toBeGreaterThan(0);
    const last = calls[calls.length - 1]!;
    const home = last.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進醫院 —— 索引是空的').toBeDefined();
    const pop = state.citizens.getPopulation();
    expect(home!.count! / pop, `醫院收到 ${home!.count} 人，城裡有 ${pop} 人`)
      .toBeGreaterThan(0.9);
  });

  it('should scale the police demand weight with the headcount', () => {
    const small = city(100);
    const smallCalls = capture(small, small.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(small));
    const smallHome = smallCalls[smallCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const big = city(800);
    const bigCalls = capture(big, big.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(big));
    const bigHome = bigCalls[bigCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(smallHome.weight).toBeGreaterThan(0);
    // Without multiplying by the headcount, both sides are one demand per building and the
    // ratio is 1.
    expect(bigHome.weight! / smallHome.weight!, `100 人 ${smallHome.weight} vs 800 人 ${bigHome.weight}`)
      .toBeGreaterThan(4);
  });

  it('should scale the fire demand weight with the headcount', () => {
    const small = city(100);
    const smallCalls = capture(small, small.fire, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(small));
    const smallHome = smallCalls[smallCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const big = city(800);
    const bigCalls = capture(big, big.fire, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(big));
    const bigHome = bigCalls[bigCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(smallHome.weight).toBeGreaterThan(0);
    expect(bigHome.weight! / smallHome.weight!).toBeGreaterThan(4);
  });

  it('should keep education apart inside one building for police', () => {
    // If aggregation keeps only the headcount and drops education, no education (weight 2.0)
    // and university (0.3) are treated as the same.
    const none = city(400, EducationLevel.NONE);
    const noneCalls = capture(none, none.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(none));
    const noneHome = noneCalls[noneCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const uni = city(400, EducationLevel.UNIVERSITY);
    const uniCalls = capture(uni, uni.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(uni));
    const uniHome = uniCalls[uniCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(noneHome.weight!, '學歷完全沒有影響警力需求')
      .toBeGreaterThan(uniHome.weight! * 2);
  });

  it('should tell the schools how many students share an address', () => {
    const state = city(600, EducationLevel.NONE);
    // All marked as enrolled so they take the enrolled path; the eligible path also requires
    // school coverage.
    for (const c of state.citizens.getCitizens()) c.educationProgress = 1;
    const calls = capture(state, state.education, 'updateSchoolLoads');
    runSlowCycles(new SimulationLoop(state));

    // One call passes two arrays (enrolled, eligible), which `capture` records separately.
    const enrolled = calls[calls.length - 2]!;
    const home = enrolled.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進學校').toBeDefined();
    expect(home!.count, `學校收到 ${home!.count} 個學生`).toBeGreaterThan(500);
  });
});
