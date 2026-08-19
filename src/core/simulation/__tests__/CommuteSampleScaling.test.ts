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
 * 生成通勤車的迴圈同時在做兩件事:決定畫哪幾台車，以及估「今天多少人走路、搭捷運」。
 * 問的人數現在會被節流（見 `CommuteSampling`），所以每問到一位就要放大回去 ——
 * 漏掉任何一個下游計數，那個數字就會憑空縮水。
 *
 * 小城市（想問的 ≤ SPAN）倍率是 1，行為一個字都沒改 —— 這也表示既有的測試全部
 * 走不到放大那條路徑。這裡刻意把城市造大到會被節流。
 */

/** 家與公司相距 2 格（≤ WALK_MAX_DISTANCE = 3），所有人都用走的。 */
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
  /** 直接呼叫這一支 —— `spawnVehicles` 最後會把 `pendingTrips` 消化掉。 */
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
    // 每個人都用走的（家與公司相距 2 格）。問了 samples 位、每位記 scale 人，
    // 加起來必須等於「本來要問的 attempts 位」—— 少放大就等於憑空少掉一批人。
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
    // 前期不該為了後期的問題付代價。倍率必須正好是 1，而且每一筆記一個人。
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
    // 想問的量跟人口成正比，實際問的量不該跟著長 —— 那正是 10 萬人卡死的原因。
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
    // 節流的是「問幾位」，不是「一天分幾次問」。SPAWN_SPREAD_TICKS 還是照舊。
    const { state, loop, inner } = makeLoop(walkingCity(4000));
    inner.spawnCommuteVehicles(state.grid, CAP);
    const eligible = loop.lastCommuteSample.attempts * SIMULATION.SPAWN_SPREAD_TICKS;
    expect(eligible, '想問的量不再是「適齡有工作的人 ÷ 8」').toBeGreaterThan(3000);
  });
});
