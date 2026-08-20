import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { HAPPINESS } from '../../citizen/Happiness';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 全城情境每 `SLOW_TICK_INTERVAL` 個 tick 才重算一次，而分片每個 tick 都跑 ——
 * 所以一輪之內大部分的片看到的是**開輪時**拍下的那份情境。
 *
 * 情境裡大部分的東西本來就是慢的（污染、地價、服務覆蓋），舊幾個 tick 沒差。
 * 但屍體與垃圾的待處理佇列不是:它們是短命事件，而且只要幾個 tick 就會被收走。
 * 拿舊快照的話，事件發生在兩次重算之間的那幾片市民永遠不會知道門口有屍體。
 *
 * 佇列本身只有「還沒收走的幾筆」那麼長 —— 跟人口無關，每個 tick 重建不花錢。
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

/** 這個 tick 被更新到的人的平均快樂度。用 NaN 當哨兵認人。 */
function meanOfUpdated(state: GameState, loop: SimulationLoop): number {
  const citizens = state.citizens.getCitizens();
  for (const c of citizens) c.happiness = NaN;
  loop.tick();
  let sum = 0, n = 0;
  for (const c of citizens) if (!Number.isNaN(c.happiness)) { sum += c.happiness; n++; }
  return n > 0 ? sum / n : NaN;
}

/** 跑到「情境剛剛重算完」的那個 tick 為止。下一個 tick 就是拿快照的片。 */
function tickToJustAfterRefresh(state: GameState, loop: SimulationLoop): void {
  for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL * 3; i++) {
    loop.tick();
    if (state.clock.tick % SIMULATION.SLOW_TICK_INTERVAL === 4) return;
  }
  throw new Error('沒跑到慢速槽 4');
}

describe('待處理佇列的新鮮度', () => {
  it('should let a slice see a body reported after the context was built', () => {
    // 情境重算完之後才報的屍體，會被這一輪剩下五片完全忽略。片數愈多漏得愈兇 ——
    // 72 片的城市只有 6/72 的人知道門口有屍體。
    const state = city(600);
    const loop = new SimulationLoop(state);
    tickToJustAfterRefresh(state, loop);

    const before = meanOfUpdated(state, loop);
    expect(Number.isNaN(before)).toBe(false);

    // 上一個 tick 不是慢速槽 4，所以底下這一個 tick 也不會重算情境。
    expect(state.clock.tick % SIMULATION.SLOW_TICK_INTERVAL)
      .not.toBe(SIMULATION.SLOW_TICK_INTERVAL - 2);

    // 四具屍體吃滿上限。上限 -20 遠大於通勤抖動的 ±3。
    for (let i = 0; i < 4; i++) state.deathCare.reportDeath(2, 2);

    const after = meanOfUpdated(state, loop);
    const drop = before - after;
    expect(drop, `報了四具屍體，這一片的平均只掉了 ${drop.toFixed(1)}`)
      .toBeGreaterThan(-HAPPINESS.DEATH_BODY_PENALTY_CAP * 0.75);
  });

  it('should stop penalising once the garbage is collected', () => {
    // 只能測「收走」這個方向:住宅每個 tick 都在產垃圾，量 before 的時候門口本來
    // 就有幾袋，再加袋子只會撞到同一個上限，看不出差別。
    const state = city(600);
    const loop = new SimulationLoop(state);
    // 遠多於吃滿上限所需的五袋，確定 before 是頂在上限上的。
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
    // 反方向:屍體收走了，快照卻還記著。這一片的人會繼續不爽到下一次重算。
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
    // `pop === 0` 時重算會直接 return，舊情境留在原地。人口歸零期間玩家改了稅率、
    // 拆了服務、污染跑掉了 —— 重新遷入的人會照著那份舊的算，直到下一次慢速槽 4。
    //
    // 這裡直接看快取欄位而不是比較快樂度數值:空城再重建的城市，地價、犯罪、服務
    // 覆蓋全都跟著重來，數值上的差異蓋不住稅率那一項，比不出東西。要釘的不變量
    // 本來就是「沒有人的時候不要留著情境」。
    const state = city(400, 0.05);
    const loop = new SimulationLoop(state);
    tickToJustAfterRefresh(state, loop);
    expect((loop as unknown as Inner).happinessContext, '情境根本沒建起來').not.toBeNull();

    // 清空。住宅也一起拆掉 —— 容量是每個 tick 從格子重算的，光把數字歸零，同一個
    // tick 的移民又會把人塞回來，城市根本沒空過。
    for (const c of [...state.citizens.getCitizens()]) state.citizens.removeCitizen(c.id);
    state.grid.setCell(2, 2, { zoneType: ZoneType.NONE, buildingId: 0 });
    loop.tick();
    expect(state.citizens.getPopulation(), '城市沒有真的空過').toBe(0);

    expect((loop as unknown as Inner).happinessContext, '空城了還留著上一座城市的情境')
      .toBeNull();
  });

  it('should rebuild the context for citizens who move back in', () => {
    // 情境作廢之後，重新遷入的人在下一個 tick 就要有快樂度 —— 不能等到下一次慢速槽 4。
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
