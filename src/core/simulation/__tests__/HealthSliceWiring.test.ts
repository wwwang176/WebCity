import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { citizenSliceCount, CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 健康原本也是慢速槽 4 裡逐市民重算一次 —— 12 萬人實測 28ms。跟快樂度同一種病，
 * 同一招。
 *
 * 兩者共用同一個分片雜湊，所以同一位市民的快樂度與健康落在同一個 tick 更新 ——
 * 那一個 tick 裡他的住址只查一次（`homeFactsFor`）。
 */

const HOME = '2,2';
const OTHER = '4,2';

function city(citizens: number, homes: string[] = [HOME]): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  for (const h of homes) {
    const [x, y] = h.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  state.grid.setCell(8, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    // 住址**不能**照 i 的奇偶分:雜湊的乘數是奇數，所以片號的奇偶等於 id 的奇偶
    // （見 CitizenSlicing）。照奇偶分的話每一片剛好只含一棟樓，兩棟樓永遠不會
    // 在同一個 tick 被查到 —— 記憶串到別的住址的 bug 就照不出來。
    state.citizens.restoreCitizen({
      age: 100, homeId: homes[i % 3 === 0 ? homes.length - 1 : 0]!, workplaceId: '8,2',
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** 這個 tick 健康被重算的人。用 NaN 當哨兵認人。 */
function healthUpdated(state: GameState, loop: SimulationLoop): Set<number> {
  const citizens = state.citizens.getCitizens();
  for (const c of citizens) c.health = NaN;
  loop.tick();
  const hit = new Set<number>();
  for (const c of citizens) if (!Number.isNaN(c.health)) hit.add(c.id);
  return hit;
}

describe('健康的分片', () => {
  it('should update each citizen exactly once per cycle', () => {
    // 只數總數的話「每個 tick 都重算同一批人」會通過。逐一認人。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();
    const n = loop.lastHealthSlice.slices;
    expect(n).toBeGreaterThan(0);

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    const times = new Map<number, number>();
    for (let t = 0; t < n; t++) {
      for (const id of healthUpdated(state, loop)) times.set(id, (times.get(id) ?? 0) + 1);
    }
    const survivors = state.citizens.getCitizens().filter(c => before.has(c.id));
    expect(survivors.length).toBeGreaterThan(100);
    for (const c of survivors) {
      expect(times.get(c.id) ?? 0, `市民 ${c.id} 一輪裡被算了 ${times.get(c.id) ?? 0} 次`).toBe(1);
    }
  });

  it('should use the slice count the pure function decided', () => {
    // 城市要大到純函式算出來不是下限，否則寫死 6 也會過。
    const pop = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + 1000;
    const state = city(pop);
    expect(citizenSliceCount(state.citizens.getPopulation()))
      .toBeGreaterThan(SIMULATION.SLOW_TICK_INTERVAL);

    const loop = new SimulationLoop(state);
    loop.tick();
    expect(loop.lastHealthSlice.slices)
      .toBe(citizenSliceCount(state.citizens.getPopulation()));
  });

  it('should update happiness and health for the same citizen on the same tick', () => {
    // 這是共用住址記憶的前提。分開的話同一位市民的住址一個 tick 要查兩次。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const citizens = state.citizens.getCitizens();
    for (const c of citizens) { c.health = NaN; c.happiness = NaN; }
    loop.tick();

    const healthHit = new Set(citizens.filter(c => !Number.isNaN(c.health)).map(c => c.id));
    const happyHit = new Set(citizens.filter(c => !Number.isNaN(c.happiness)).map(c => c.id));
    expect(healthHit.size).toBeGreaterThan(0);
    expect([...healthHit].sort(), '快樂度與健康算的不是同一批人')
      .toEqual([...happyHit].sort());
  });
});

describe('住址記憶', () => {
  it('should not carry stale environment across ticks', () => {
    // 記憶是每個 tick 清空的。跨 tick 留著的話，斷電、缺水、污染這些玩家看得見而且
    // 會突然改變的東西會慢半拍 —— 而一輪最長 72 個 tick。
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const clean = healthUpdated(state, loop);
    const byId = new Map(state.citizens.getCitizens().map(c => [c.id, c]));
    const cleanHealth = [...clean].map(id => byId.get(id)!.health);

    // 下一個 tick 之前把住址弄髒。同一輪的下一片必須看得到。
    state.grid.setCell(2, 2, { pollution: 255 });

    const dirty = healthUpdated(state, loop);
    const dirtyHealth = [...dirty].map(id => byId.get(id)!.health)
      .filter(h => !Number.isNaN(h));

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(dirtyHealth.length).toBeGreaterThan(0);
    expect(mean(dirtyHealth), `乾淨時 ${mean(cleanHealth).toFixed(1)}，污染 255 之後還是 ${mean(dirtyHealth).toFixed(1)}`)
      .toBeLessThan(mean(cleanHealth));
  });

  it('should keep different addresses apart', () => {
    // 記憶的鍵錯了（例如全城共用一筆）的話，住在乾淨那一棟的人也會被算成髒的。
    const state = city(600, [HOME, OTHER]);
    const loop = new SimulationLoop(state);
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL * 2; t++) loop.tick();
    // 污染要在中速塊（每 60 tick 重算全城污染）之後才弄髒，不然會被蓋回去。
    state.grid.setCell(4, 2, { pollution: 255 });
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL; t++) loop.tick();

    const citizens = state.citizens.getCitizens();
    const atClean = citizens.filter(c => c.homeId === HOME).map(c => c.health);
    const atDirty = citizens.filter(c => c.homeId === OTHER).map(c => c.health);
    expect(atClean.length).toBeGreaterThan(50);
    expect(atDirty.length).toBeGreaterThan(50);

    // 同一棟樓的住戶年齡相同、環境相同，健康值必須完全一致。記憶把兩棟樓混在一起
    // 的話，乾淨那一棟裡會混進髒的值 —— 平均看不太出來，逐一看才擋得住。
    expect(new Set(atClean).size, '同一棟樓的人健康值不一致 —— 記憶串到別的住址了').toBe(1);
    expect(new Set(atDirty).size, '同一棟樓的人健康值不一致 —— 記憶串到別的住址了').toBe(1);
    expect(Math.min(...atClean), '兩棟樓的污染差 255，健康卻一樣')
      .toBeGreaterThan(Math.max(...atDirty));
  });
});
