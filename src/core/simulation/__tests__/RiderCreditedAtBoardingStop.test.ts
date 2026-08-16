import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * 搭車的人要記在他真正上車的那一站。
 *
 * 估計時間是照某一條路線的某兩站算的。選完運具之後再用「整個系統裡最近的站」重挑
 * 一次，同運具多條路線時就會挑到別條線上 —— 人被記到他沒搭的那條路線頭上，
 * `getRouteRiders` 把它加總成載重，兩條線的擁擠程度同時被扭曲（BUG-283）。
 *
 * 面板上的 Riders/Week 是同一個數字乘七，所以顯示跟模擬是一起錯的，對不出來。
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 56, y: 2 };

/**
 * 一條長路，家與公司都蓋在**路旁**。
 *
 * 蓋在路的盡頭不行：人行道沿著路的兩側走，路的端點沒有人行道，那棟房子的門
 * 接不上任何東西，住戶哪一站都走不到。
 *
 * 通勤也要夠長，公車才贏得過開車 —— 走路是開車的三倍多慢，短程時光是走到站牌
 * 就把時間差吃光了。
 */
function setupCity(state: GameState): void {
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
}

function advanceToHour(state: GameState, targetHour: number): void {
  let ticks = targetHour - state.clock.getHourOfDay();
  if (ticks < 0) ticks += 24;
  state.clock.tick += ticks;
}

describe('搭乘記在上車的那一站', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(60, 60);
    setupCity(state);
  });

  it('should credit the ridden route, not the nearest stop of another route', () => {
    // 他真正搭的那條：兩端都碰得到，上車站離家 2.6 格。
    const ridden = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(ridden, 4);

    // 幌子：站就在家門口（0.3 格，比上面近得多），但另一端在圖裡什麼都沒有，
    // 到不了公司，所以這條路線根本不會被回報。「挑最近的站」會挑中它。
    const decoyNear = state.bus.addStop(HOME.x, 1);
    state.bus.createRoute([decoyNear, state.bus.addStop(2, 50)], 4);

    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: `${HOME.x},${HOME.y}`,
        workplaceId: `${WORK.x},${WORK.y}`,
      });
    }

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    for (let i = 0; i < 4; i++) loop.tick();

    const riddenRiders = ridden[0]!.dailyRiders + ridden[1]!.dailyRiders;
    expect(riddenRiders, '沒有人被記到他真正搭的那條路線上').toBeGreaterThan(0);
    expect(decoyNear.dailyRiders, '記到了他沒搭、也到不了公司的那條路線頭上').toBe(0);
  });
});
