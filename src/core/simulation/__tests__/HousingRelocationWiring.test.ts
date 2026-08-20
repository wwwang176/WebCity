import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 換房子從「每 60 個 tick 把全部人跑一次」改成「每個慢速槽跑一批，10 批輪完」。
 *
 * `10 × SLOW_TICK_INTERVAL = 60` —— 每位市民輪到一次的間隔與改動前完全相同，
 * 變的只是把一次 195ms 換成十次 20ms（BUG-331）。
 *
 * 這裡釘的是**接線**:批次真的有在輪、每次只處理一部分人、而且整件事在同一個
 * tick 內做完（沒有跨 tick 的快照要維護）。
 */

/** 住宅等級交錯，讓學歷 NONE 的市民有明顯更好的選擇可搬。 */
function unhappyCity(citizens: number): GameState {
  const state = createGameState(40, 40);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  // 高密度住宅，等級交錯:4 = Small Apartment（level 1、80 人）、
  // 6 = High Rise（level 3、320 人）。容量要夠 —— 全部爆滿的話每個候選都會被
  // `occ >= capacity` 刷掉，一個人也搬不動，測試就變成什麼都沒測到。
  for (let x = 2; x < 20; x++) {
    state.grid.setCell(x, 2, {
      zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: x % 2 === 0 ? 4 : 6,
    });
  }
  state.grid.setCell(25, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: `${2 + (i % 18)},2`, workplaceId: '25,2', happiness: 10,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

const CYCLE = SIMULATION.SLOW_TICK_INTERVAL * SIMULATION.HOUSING_RELOCATION_SLICES;

/** 這座城市的住宅與工作地。每個 tick 重放一次，把無關的衰退隔離掉。 */
function placeBuildings(state: GameState): void {
  for (let x = 2; x < 20; x++) {
    state.grid.setCell(x, 2, {
      zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: x % 2 === 0 ? 4 : 6,
      reserved: 0,
    });
  }
  state.grid.setCell(25, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7, reserved: 0 });
}

/**
 * 推一個 tick，並在推之前把城市維持在「有人不開心、有房子可搬」的狀態。
 *
 * 兩件事都要:靠高稅率製造不開心會同時觸發建築廢棄，而長期不開心本身也會 ——
 * 實測跑到第 58 個 tick 時候選住宅已經歸零，最後一批根本沒執行。那是**別的**
 * 子系統的行為，不是這個測試要釘的東西。
 */
function tickUnhappy(state: GameState, loop: SimulationLoop): void {
  placeBuildings(state);
  for (const c of state.citizens.getCitizens()) c.happiness = 10;
  loop.tick();
}

describe('換房子的接線', () => {
  it('should run one slice per slow cycle and walk through all of them', () => {
    // 沒接上批號的話（例如永遠跑第 0 批），其餘九成的市民永遠不會被考慮。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const seen = new Set<number>();

    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      const s = loop.lastHousingRelocation.slice;
      if (s >= 0) seen.add(s);
    }
    expect(seen.size, `輪了一圈只走到 ${seen.size} 批`)
      .toBe(SIMULATION.HOUSING_RELOCATION_SLICES);
  });

  it('should consider only about one slice worth of citizens each time', () => {
    // 這是省下來的東西本身。一次跑全部人的話這個數字會是全城人口。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);

    let maxConsidered = 0;
    let ran = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (loop.lastHousingRelocation.slice >= 0) {
        ran++;
        maxConsidered = Math.max(maxConsidered, loop.lastHousingRelocation.considered);
      }
    }
    expect(ran, '一圈裡一次都沒跑過').toBeGreaterThan(0);
    expect(maxConsidered, '一次都沒看到任何人').toBeGreaterThan(0);
    const pop = state.citizens.getPopulation();
    expect(maxConsidered, `一次就看了 ${maxConsidered} 位，全城才 ${pop} 位`)
      .toBeLessThan(pop / (SIMULATION.HOUSING_RELOCATION_SLICES / 2));
  });

  it('should keep the per-citizen interval at MEDIUM_TICK_INTERVAL', () => {
    // 批數 × 慢速槽 = 每位市民輪到一次的間隔。這個乘積換掉，搬家的節奏就變了。
    expect(SIMULATION.HOUSING_RELOCATION_SLICES * SIMULATION.SLOW_TICK_INTERVAL)
      .toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
  });

  it('should still move somebody', () => {
    // 分批之後一個人都搬不動的話，這一整套等於把功能關掉了。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const homesBefore = new Map(state.citizens.getCitizens().map(c => [c.id, c.homeId]));

    let moved = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      moved += loop.lastHousingRelocation.relocated;
    }
    expect(moved, '輪完一圈一個人都沒搬').toBeGreaterThan(0);

    const changed = state.citizens.getCitizens()
      .filter(c => homesBefore.has(c.id) && homesBefore.get(c.id) !== c.homeId).length;
    expect(changed, '回報有人搬家，實際上住址沒變').toBeGreaterThan(0);
  });

  it('should not hold any relocation state between ticks', () => {
    // 整件事在同一個 tick 內做完 —— 沒有跨 tick 的快照要維護，那一整類過期問題
    // 因此不存在（BUG-331）。留著任何一個殘件就代表設計又倒回去了。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL * 3; t++) tickUnhappy(state, loop);

    const inner = loop as unknown as Record<string, unknown>;
    for (const leftover of ['housingRelocationSlicer', 'housingRelocationBudget']) {
      expect(inner[leftover], `${leftover} 還在 —— 又有跨 tick 的狀態了`).toBeUndefined();
    }
  });
});
