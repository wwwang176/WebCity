import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 分片的**公平性**:一輪之內每個人剛好輪到一次，而且沒有人被無限期跳過。
 *
 * `HappinessSliceWiring` 只數了「一輪總共更新幾位」，那個數字擋不住「每個 tick
 * 都重算同一批人、其餘的人永遠不動」—— 總數照樣對得上。這裡改用哨兵值追**身分**。
 *
 * 片數以前是每個 tick 從當下人口重算的。人口跨過 `CITIZEN_SLICE_PER_TICK` 的倍數時
 * 所有人的片號會一起改變，「一輪剛好一次」的保證就沒了 —— 人口在門檻附近來回時
 * 可以構造出某人連續數百個 tick 沒被更新。
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
 * 哨兵:先把所有人的快樂度設成 NaN，跑一個 tick 之後還是數字的人就是「這個 tick
 * 被更新到的人」。用實際的副作用認人，不必去重算實作自己的分片規則 —— 實作改成
 * 別種分法時這個測試照樣有效。
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
    // 只數總數的話，「每個 tick 都重算同一批 100 人、其餘 500 人永遠不動」會通過:
    // 六個 tick 加起來剛好 600。這裡逐一認人。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick(); // 先讓情境建起來，第一輪才是完整的一輪
    const n = loop.lastHappinessSlice.slices;
    expect(n).toBeGreaterThan(0);

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    const timesUpdated = new Map<number, number>();
    for (let t = 0; t < n; t++) {
      for (const id of updatedThisTick(state, loop)) {
        timesUpdated.set(id, (timesUpdated.get(id) ?? 0) + 1);
      }
    }

    // 只看「整輪都在城裡」的人 —— 中途遷入遷出的本來就不該有保證。
    const survivors = state.citizens.getCitizens().filter(c => before.has(c.id));
    expect(survivors.length).toBeGreaterThan(100);
    for (const c of survivors) {
      expect(timesUpdated.get(c.id) ?? 0, `市民 ${c.id} 在一輪 ${n} 個 tick 裡被更新了 ${timesUpdated.get(c.id) ?? 0} 次`)
        .toBe(1);
    }
  });

  it('should not re-slice mid-cycle when the population crosses a threshold', () => {
    // 片數在一輪中途變掉 = 所有人重新分片。已經輪過的人可能又被排到後面的片，
    // 還沒輪到的人可能被排到已經走過的片 —— 後者要再等一整輪。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const startSlices = loop.lastHappinessSlice.slices;
    expect(startSlices, '600 人應該是最小片數').toBe(SIMULATION.SLOW_TICK_INTERVAL);

    // 一口氣衝過 CITIZEN_SLICE_PER_TICK × SLOW_TICK_INTERVAL —— 純函式算出來的片數
    // 一定比 startSlices 大。
    const target = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + 500;
    for (let i = state.citizens.getPopulation(); i < target; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: '2,2', workplaceId: '6,2' });
    }
    state.citizens.updateResidentialCapacity(target * 2);

    // 這一輪剩下的 tick 必須沿用開輪時的片數。
    const seen: number[] = [];
    for (let t = loop.lastHappinessSlice.index + 1; t < startSlices; t++) {
      loop.tick();
      seen.push(loop.lastHappinessSlice.slices);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s, `一輪中途片數從 ${startSlices} 變成 ${s}`).toBe(startSlices);
    }

    // 下一輪才換上新的片數。
    loop.tick();
    expect(loop.lastHappinessSlice.slices, '新的一輪還在用舊片數')
      .toBeGreaterThan(startSlices);
    expect(loop.lastHappinessSlice.index, '換片數的那個 tick 不是從第 0 片開始').toBe(0);
  });

  it('should only change the slice count at a cycle boundary', () => {
    // 上一條釘的是「這一次」，這一條釘的是通則:片數只在 index === 0 時改變。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    let prev = loop.lastHappinessSlice.slices;
    for (let t = 0; t < 40; t++) {
      // 每個 tick 都動人口，讓純函式算出來的片數一直在變。
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
