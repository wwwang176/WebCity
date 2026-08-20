import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { citizenSliceCount, CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 分片是**輪流**不是抽樣:每位市民身上都存著自己的快樂度，沒被輪到的人沿用上次的值。
 * 所以要釘的是「每個人都輪得到」與「不會有人被跳過或算兩次」，不是統計誤差。
 *
 * 70 891 人實測，改動前這一整包是 68.5ms 落在單一個 tick 上，玩家感覺到每 1.5 秒
 * 卡一下（BUG-330）。
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
    // 接線斷掉（例如寫死 6 片）的話，大城市的成本會退回線性，而所有看數值的
    // 斷言都還是綠的。城市要大到純函式算出來**不是**下限，否則寫死 6 照樣過。
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
    // 精確相等釘不住:這幾個 tick 之間有人遷入遷出，人口本身在動。
    // 少走一片的話會掉到六分之五，這個門檻擋得住。
    const pop = state.citizens.getPopulation();
    expect(total / pop, `一輪只算到 ${total} 位，人口 ${pop}`).toBeGreaterThan(0.95);
    expect(total / pop).toBeLessThan(1.05);
  });

  it('should keep a small city on the cadence it always had', () => {
    // 小城市每位市民仍然每 SLOW_TICK_INTERVAL 個 tick 更新一次 —— 頻率沒有變。
    const state = city(600);
    expect(citizenSliceCount(state.citizens.getPopulation()))
      .toBe(SIMULATION.SLOW_TICK_INTERVAL);
  });

  it('should spread the work evenly instead of dumping it on one tick', () => {
    // 這是整件事的重點。全部擠在慢速槽 4 的話，那一個 tick 會做完全部的工作。
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
    // 情境裡有一個 O(人口) 的成年人計數。每個 tick 重跑會把分片省下的吃掉，
    // 而且結果完全一樣 —— 沒有任何看數值的斷言會紅。
    const state = city(600);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Inner;
    let calls = 0;
    const orig = inner.refreshHappinessContext.bind(inner);
    inner.refreshHappinessContext = () => { calls++; orig(); };

    const n = SIMULATION.SLOW_TICK_INTERVAL;
    for (let t = 0; t < n * 3; t++) loop.tick();

    // 三輪慢速槽 = 三次。開頭補建一次是允許的（情境還沒有的時候）。
    expect(calls, `${n * 3} 個 tick 裡重算了 ${calls} 次全城情境`).toBeLessThanOrEqual(4);
    expect(calls, '全城情境根本沒被重算').toBeGreaterThanOrEqual(3);
  });

  it('should have happiness for everyone after the first cycle', () => {
    // 開局的頭幾個 tick 還沒有情境可用。不補建的話那幾片會被白白跳過，
    // 第一輪只蓋得到一部分市民。
    //
    // 逐一認人，不看總數:「每個 tick 都重算同一批人」的總數也對得上。哨兵用
    // NaN —— 開局時每個人的快樂度是預設值，光看「有沒有值」分不出誰被算過。
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
