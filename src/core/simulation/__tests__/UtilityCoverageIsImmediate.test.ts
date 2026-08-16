import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * 剛蓋好的建築要馬上算得到水電。
 *
 * `isPowered` / `isSupplied` 不計算任何東西，只是查一個快取的 Set，而那個 Set 只在
 * slot 1 重建（六個 tick 輪一次）。剛蓋好的那一格在上一次重算時還不存在，於是面板
 * 照實回報缺水缺電，要等下一輪才消失 —— 暫停時則永遠不會消失，因為沒有 tick
 * （BUG-284）。
 *
 * 這不只是顯示問題：`isFacilityOperational` 拿的是同一個數字，那幾個 tick 裡設施是
 * 真的沒在運作。
 */

/** 一條路，一座電廠，一座水廠，全都接在路上。 */
function setupCity(state: GameState): void {
  for (let x = 1; x <= 12; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 1) flags = RoadDirection.EAST;
    if (x === 12) flags = RoadDirection.WEST;
    state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(1, 6, { buildingId: 200 });
  state.grid.setCell(2, 6, { buildingId: 201 });
  state.power.addPlant({ x: 1, y: 6, output: 5000, pollution: 0, type: 'coal' });
  state.water.addPlant({ x: 2, y: 6, output: 5000 });
}

describe('剛蓋好的建築馬上算得到水電', () => {
  let state: GameState;
  let loop: SimulationLoop;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupCity(state);
    loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    // 跑滿一輪，讓涵蓋範圍先算好一次 —— 這就是玩家按下建造鍵之前的狀態。
    for (let i = 0; i < 6; i++) loop.tick();
  });

  it('should power a building placed after the last recalculation', () => {
    state.grid.setCell(8, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    // 快取是舊的 —— 這一格上次重算時還不存在。
    expect(state.power.isPowered(8, 6), '這一格已經在快取裡了，測試沒有測到過期那一刻')
      .toBe(false);

    loop.recalculateUtilityCoverage();

    expect(state.power.isPowered(8, 6), '剛蓋好的建築還是沒電').toBe(true);
    expect(state.water.isSupplied(8, 6), '剛蓋好的建築還是沒水').toBe(true);
  });

  it('should not need a tick — the player may be paused', () => {
    // 暫停時一個 tick 都不會跑（GameClock.shouldTick 直接回 false），所以重算
    // 不能綁在 tick 上，否則那個警告會一直掛著。
    state.clock.pause();
    state.grid.setCell(9, 6, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    loop.recalculateUtilityCoverage();

    expect(state.clock.tick, '測試自己偷跑了 tick').toBe(6);
    expect(state.power.isPowered(9, 6), '暫停時蓋的建築算不到電').toBe(true);
  });
});
