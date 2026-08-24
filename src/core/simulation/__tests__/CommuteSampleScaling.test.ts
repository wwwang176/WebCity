import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { commuteSampleSize, COMMUTE_SAMPLE_SPAN } from '../CommuteSampling';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';

/**
 * The commute-spawn loop does two things at once: decide which vehicles to draw, and estimate
 * how many citizens walk or take the metro today. The number asked is throttled (see
 * `CommuteSampling`), so each citizen sampled has to be scaled back up — missing any one
 * downstream counter shrinks that number out of nowhere.
 *
 * In a small city (intended asks <= SPAN) the factor is 1 and behaviour is unchanged, which
 * also means existing tests never reach the scaling path. These cities are deliberately large
 * enough to be throttled.
 */

/** Home and workplace 2 tiles apart (<= WALK_MAX_DISTANCE = 3), so everyone walks. */
function walkingCity(citizenCount: number): GameState {
  const state = createGameState(40, 40);
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      if (i % 4 !== 0 && j % 4 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 4 === 0) flags |= RoadDirection.NORTH;
      if (j < 39 && i % 4 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 4 === 0) flags |= RoadDirection.WEST;
      if (i < 39 && j % 4 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  const pairs: [string, string][] = [];
  for (let i = 1; i < 39; i += 4) {
    for (let j = 1; j < 39; j += 4) {
      state.grid.setCell(i, j, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      state.grid.setCell(i + 1, j + 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      pairs.push([`${i},${j}`, `${i + 1},${j + 1}`]);
    }
  }
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.restoreCitizen({ age: 100 });
    const [home, work] = pairs[n % pairs.length]!;
    c.homeId = home;
    c.workplaceId = work;
  }
  state.citizens.updateResidentialCapacity(citizenCount * 2);
  return state;
}

type Inner = {
  /** Called directly, because `spawnVehicles` consumes `pendingTrips` at the end. */
  spawnCommuteVehicles(grid: unknown, vehicleCap: number): void;
  pendingTrips: { count: number }[];
};

const CAP = 1_000_000;

function makeLoop(state: GameState) {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return { state, loop, inner: loop as unknown as Inner };
}

describe('抽樣之後把數字放大回去', () => {
  it('should throttle a city big enough to be worth throttling', () => {
    const { state, loop, inner } = makeLoop(walkingCity(4000));
    inner.spawnCommuteVehicles(state.grid, CAP);
    const s = loop.lastCommuteSample;

    expect(s.attempts, '前置條件:這座城市要大到會被節流')
      .toBeGreaterThan(COMMUTE_SAMPLE_SPAN);
    expect(s.samples, '節流沒有生效').toBe(commuteSampleSize(s.attempts));
    expect(s.samples).toBeLessThan(s.attempts);
    expect(s.scale, '放大倍率跟取樣量對不起來').toBeCloseTo(s.attempts / s.samples, 10);
  });

  it('should still account for everyone it did not ask', () => {
    // Everyone walks (home and workplace 2 tiles apart). Asking `samples` citizens and
    // recording `scale` people each must sum to the `attempts` originally intended;
    // under-scaling loses a batch of citizens outright.
    const { state, loop, inner } = makeLoop(walkingCity(4000));
    inner.spawnCommuteVehicles(state.grid, CAP);

    const total = inner.pendingTrips.reduce((s, t) => s + t.count, 0);
    expect(loop.lastCommuteSample.samples, '前置條件:要真的問得比想問的少')
      .toBeLessThan(loop.lastCommuteSample.attempts);
    expect(total, '放大之後的人次跟本來要問的人數對不起來')
      .toBeCloseTo(loop.lastCommuteSample.attempts, 6);
    expect(inner.pendingTrips.length, '前置條件:要真的有走路的行程')
      .toBe(loop.lastCommuteSample.samples);
  });

  it('should leave a small city completely alone', () => {
    // The early game should not pay for a late-game problem: the factor must be exactly 1 and
    // each entry must count one person.
    const { state, loop, inner } = makeLoop(walkingCity(200));
    inner.spawnCommuteVehicles(state.grid, CAP);
    const s = loop.lastCommuteSample;

    expect(s.attempts, '前置條件:這座城市要小到不該被節流')
      .toBeLessThanOrEqual(COMMUTE_SAMPLE_SPAN);
    expect(s.samples, '小城市被節流了').toBe(s.attempts);
    expect(s.scale, '小城市的放大倍率不是 1').toBe(1);
    for (const t of inner.pendingTrips) expect(t.count).toBe(1);
  });

  it('should ask a fixed number however big the city gets', () => {
    // The intended count scales with population; the actual count must not, which is exactly
    // what stalled the 100,000-citizen city.
    const small = makeLoop(walkingCity(4000));
    const big = makeLoop(walkingCity(16000));
    small.inner.spawnCommuteVehicles(small.state.grid, CAP);
    big.inner.spawnCommuteVehicles(big.state.grid, CAP);

    expect(big.loop.lastCommuteSample.attempts / small.loop.lastCommuteSample.attempts,
      '前置條件:大城市想問的量要真的多好幾倍').toBeGreaterThan(3);
    expect(big.loop.lastCommuteSample.samples / small.loop.lastCommuteSample.samples,
      '實際問的量跟著人口線性長了').toBeLessThan(2.5);
  });

  it('should keep the spread across ticks that it always had', () => {
    // The throttle applies to how many are asked, not to how the asking is spread over a day.
    // SPAWN_SPREAD_TICKS is unchanged.
    const { state, loop, inner } = makeLoop(walkingCity(4000));
    inner.spawnCommuteVehicles(state.grid, CAP);
    const eligible = loop.lastCommuteSample.attempts * SIMULATION.SPAWN_SPREAD_TICKS;
    expect(eligible, '想問的量不再是「適齡有工作的人 ÷ 8」').toBeGreaterThan(3000);
  });
});
