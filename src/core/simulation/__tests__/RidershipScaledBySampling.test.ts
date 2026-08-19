import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * 生成通勤車的迴圈現在只問一部分市民（見 `CommuteSampling`），所以每問到一位搭車的
 * 就要記成 `scale` 位。漏掉放大的話，**搭乘數會憑空縮水好幾倍** —— 而載客率是照它算的，
 * 於是永遠擠不滿，加開班次也不會有回饋。
 *
 * 這件事只在大城市看得到:小城市倍率正好是 1，`+= scale` 與 `++` 完全等價。
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 56, y: 2 };

/** 一條長路，家與公司都蓋在路旁。通勤要夠長，公車才贏得過開車。 */
function longRoadCity(citizens: number): GameState {
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: `${HOME.x},${HOME.y}`, workplaceId: `${WORK.x},${WORK.y}`,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 2);
  return state;
}

function ridership(state: GameState): number {
  let total = 0;
  for (const r of state.bus.getRoutes()) for (const s of r.stops) total += s.dailyRiders;
  return total;
}

describe('搭乘數跟著抽樣一起放大', () => {
  it('should count the people it never asked', () => {
    const state = longRoadCity(16_000);
    const stops = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(stops, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();   // 建人行道圖、轉乘圖，並跑一次生成迴圈

    const s = loop.lastCommuteSample;
    expect(s.samples, '前置條件:這座城市要大到會被節流').toBeLessThan(s.attempts);
    expect(s.scale, '前置條件:倍率要大到看得出差別').toBeGreaterThan(2);

    const riders = ridership(state);
    expect(riders, '前置條件:要真的有人搭到公車').toBeGreaterThan(0);
    // 沒有放大的話，記到的人數最多就是問到的人數。
    expect(riders, '搭乘數沒有放大 —— 只記了問到的那幾位')
      .toBeGreaterThan(s.samples);
  });

  it('should count the people it never asked on a trip that changes buses', () => {
    // 轉乘走的是另一條分支（`multiLeg`），而且轉乘次數也是顯示用的數字。
    // 只有一條路線的測資走不到那裡，兩行放大改壞了都不會紅。
    // 四萬人:倍率約 5.8。一趟轉乘最多三段，所以「沒放大」時記到的人次最多是
    // 三倍的 samples —— 要比 attempts 還小，界才咬得住。
    const state = longRoadCity(40_000);
    const west = [state.bus.addStop(9, 1), state.bus.addStop(30, 1)];
    const east = [state.bus.addStop(31, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(west, 40);
    state.bus.createRoute(east, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    const s = loop.lastCommuteSample;
    expect(s.scale, '前置條件:倍率要大到咬得住三段的上界').toBeGreaterThan(3.5);

    const transfers = loop.getTransferHistory().today;
    let transferCount = 0;
    for (const n of transfers.values()) transferCount += n;
    expect(transferCount, '前置條件:要真的有人換車').toBeGreaterThan(0);
    expect(transferCount, '轉乘次數沒有放大').toBeGreaterThan(s.samples);

    // 有放大:每一段都記 scale 人，所以總人次 ≥ attempts。
    // 沒放大:每一段記一個人，總人次 ≤ 3 × samples < attempts。
    expect(ridership(state), '轉乘路段的搭乘數沒有放大')
      .toBeGreaterThan(s.attempts);
  });

  it('should leave a small city counting one person as one person', () => {
    const state = longRoadCity(40);
    const stops = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(stops, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    expect(loop.lastCommuteSample.scale, '小城市的倍率不是 1').toBe(1);
    expect(ridership(state) % 1, '小城市記出了不是整數的人次').toBe(0);
  });
});
