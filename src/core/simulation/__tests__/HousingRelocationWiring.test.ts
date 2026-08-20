import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { citizenSliceOf } from '../CitizenSlicing';
import { DEFAULT_RELOCATION_CONFIG } from '../../citizen/Relocation';

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

/**
 * 這一個 tick 真的跑過換房子嗎。
 *
 * `lastHousingRelocation` 會**留到下一次**才被覆寫，而它每 6 個 tick 才跑一次 ——
 * 每個 tick 都讀的話，同一次的結果會被數六遍。
 */
function ranThisTick(state: GameState, loop: SimulationLoop): boolean {
  return loop.lastHousingRelocation.tick === state.clock.tick;
}

/**
 * 這座城市的住宅與工作地。每個 tick 補一次，把無關的衰退（廢棄、火災）隔離掉。
 *
 * **只補缺的那些。** 無條件重寫格子會被當成「這裡的建築換掉了」，住戶會被驅離
 * —— 全城 homeId 一起變成 null，那個 tick 一個不開心的人都沒有。
 */
function placeBuildings(state: GameState): void {
  const want = (x: number) => x === 25
    ? { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 }
    : { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: x % 2 === 0 ? 4 : 6 };
  for (const x of [...Array.from({ length: 18 }, (_, i) => i + 2), 25]) {
    const cell = state.grid.getCell(x, 2);
    const w = want(x);
    if (cell && cell.buildingId === w.buildingId && cell.reserved === 0) continue;
    state.grid.setCell(x, 2, { ...w, reserved: 0 });
  }
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
  for (const c of state.citizens.getCitizens()) {
    c.happiness = 10;
    // 移出的門檻也是看快樂度。不關掉的話一圈之內城市會少一半 —— 而配額是每次用
    // 當下的人數重算的，總和就對不上任何一個固定的數字，測試會時紅時綠。
    c.emigrationTolerance = 0;
  }
  loop.tick();
}

describe('換房子的接線', () => {
  it('should run one slice per slow cycle and walk through all of them', () => {
    // 沒接上批號的話（例如永遠跑第 0 批），其餘九成的市民永遠不會被考慮。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const seen = new Set<number>();

    let ran = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (!ranThisTick(state, loop)) continue;
      ran++;
      seen.add(loop.lastHousingRelocation.slice);
    }
    expect(ran, `一圈跑了 ${ran} 次，應該是 ${SIMULATION.HOUSING_RELOCATION_SLICES} 次`)
      .toBe(SIMULATION.HOUSING_RELOCATION_SLICES);
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
      if (!ranThisTick(state, loop)) continue;
      ran++;
      maxConsidered = Math.max(maxConsidered, loop.lastHousingRelocation.considered);
    }
    expect(ran, '一圈裡一次都沒跑過').toBeGreaterThan(0);
    expect(maxConsidered, '一次都沒看到任何人').toBeGreaterThan(0);
    const pop = state.citizens.getPopulation();
    expect(maxConsidered, `一次就看了 ${maxConsidered} 位，全城才 ${pop} 位`)
      .toBeLessThan(pop / (SIMULATION.HOUSING_RELOCATION_SLICES / 2));
  });

  it('should come round to the same citizen every MEDIUM_TICK_INTERVAL ticks', () => {
    // 只比較兩個常數相乘是恆真的 —— 要看排程真的每 60 個 tick 讓同一位市民輪到。
    expect(SIMULATION.HOUSING_RELOCATION_SLICES * SIMULATION.SLOW_TICK_INTERVAL)
      .toBe(SIMULATION.MEDIUM_TICK_INTERVAL);

    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const victim = state.citizens.getCitizens()[0]!.id;
    const mine = citizenSliceOf(victim, SIMULATION.HOUSING_RELOCATION_SLICES);

    const hitTicks: number[] = [];
    for (let t = 0; t < CYCLE * 2 + SIMULATION.SLOW_TICK_INTERVAL; t++) {
      tickUnhappy(state, loop);
      if (ranThisTick(state, loop) && loop.lastHousingRelocation.slice === mine) {
        hitTicks.push(state.clock.tick);
      }
    }
    expect(hitTicks.length, `這位市民在兩圈裡輪到 ${hitTicks.length} 次`)
      .toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hitTicks.length; i++) {
      expect(hitTicks[i]! - hitTicks[i - 1]!, '兩次輪到之間的間隔不是 MEDIUM_TICK_INTERVAL')
        .toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
    }
  });

  it('should still move somebody', () => {
    // 分批之後一個人都搬不動的話，這一整套等於把功能關掉了。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const homesBefore = new Map(state.citizens.getCitizens().map(c => [c.id, c.homeId]));

    let moved = 0;
    let quotaSum = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (!ranThisTick(state, loop)) continue;
      moved += loop.lastHousingRelocation.relocated;
      quotaSum += loop.lastHousingRelocation.quota;
    }
    expect(moved, '輪完一圈一個人都沒搬').toBeGreaterThan(0);
    // 十批的配額加起來就是一次跑完的 5%。每批各自取 5% 的話這個數字會爆掉。
    expect(moved, `搬了 ${moved} 位，一圈的配額總共才 ${quotaSum} 位`)
      .toBeLessThanOrEqual(quotaSum);

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

describe('一圈的配額', () => {
  it('should keep a whole cycle inside the city-wide 5% cap', () => {
    // **這是分批最容易搞砸的地方。** 每批各自取自己的 5% 的話，
    // `Math.max(1, Math.floor(n × 0.05))` 會讓小批全部進位到 1 —— 100 位不開心的人
    // 分十批，一圈會搬 10 位，而一次跑完只搬 5 位。
    //
    // 小城市才照得出來:900 人時錯的算法是 40 vs 45（差 11%），100 人時是 10 vs 5
    // （差一倍）。
    //
    // 這裡**直接驅動 `runRelocation`**，不跑完整的 tick。跑完整 tick 的話這座城市
    // 會在一圈之內自己崩掉:快樂度 10 讓建築廢棄，補建築又會驅離住戶，跑到第 58 個
    // tick 全城無家可歸 —— 配額每次用當下人數重算，總和就對不上任何固定的數字。
    // 排程本身（每 6 tick 一次、每 60 tick 輪回同一位）由上面幾條測試守著。
    // 全部人先住進 level 3 的樓（學歷 NONE 不喜歡），旁邊整排 level 1 空著 ——
    // 這樣每一位都真的想搬，配額才是唯一的限制。散住的話多數人本來就不會動，
    // 「搬的人數 ≤ 配額」就咬不到任何東西。
    const state = unhappyCity(100);
    for (const [i, c] of state.citizens.getCitizens().entries()) {
      c.homeId = `${3 + 2 * (i % 9)},2`;   // 奇數格 = buildingId 6 = level 3
    }
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as { runRelocation(): void };
    const slices = SIMULATION.HOUSING_RELOCATION_SLICES;

    let quotaSum = 0, moved = 0;
    const cityCounts: number[] = [];
    for (let s = 0; s < slices; s++) {
      state.clock.tick = 4 + s * SIMULATION.SLOW_TICK_INTERVAL;   // 直接擺到第 s 批
      for (const c of state.citizens.getCitizens()) c.happiness = 10;
      inner.runRelocation();
      expect(loop.lastHousingRelocation.slice, `第 ${s} 批算出來的批號不對`).toBe(s);
      quotaSum += loop.lastHousingRelocation.quota;
      moved += loop.lastHousingRelocation.relocated;
      cityCounts.push(loop.lastHousingRelocation.cityUnhappy);
    }

    // 城市沒有跑 tick，人數應該完全不動。
    expect(new Set(cityCounts).size, `不開心的人數在一圈裡變了:${cityCounts.join(',')}`).toBe(1);

    const expected = Math.max(1,
      Math.floor(cityCounts[0]! * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
    expect(quotaSum,
      `一圈的配額總和 ${quotaSum}，全城 ${cityCounts[0]} 位不開心的 5% 是 ${expected}`)
      .toBe(expected);
    expect(moved, `搬了 ${moved} 位，配額總共 ${quotaSum} 位`).toBeLessThanOrEqual(quotaSum);
  });
});
