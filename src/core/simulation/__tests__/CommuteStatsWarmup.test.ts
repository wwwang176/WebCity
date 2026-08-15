import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';

/**
 * 通勤統計要在載入結束時就算好，不是等第一個 tick。
 *
 * 統計不進存檔（可以從現有狀態重算），所以載入完成的瞬間本來就是空的。差別在於
 * 玩家什麼時候看得到：`warmup` 還在載入畫面底下，而第一個 tick 已經是進了遊戲
 * 之後 —— 一進去就開圖層會看到一張空白的地圖。
 */

function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      if (i % 3 !== 0 && j % 3 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 3 === 0) flags |= RoadDirection.NORTH;
      if (j < 23 && i % 3 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 3 === 0) flags |= RoadDirection.WEST;
      if (i < 23 && j % 3 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  const homes: string[] = [];
  const works: string[] = [];
  for (let i = 1; i < 24; i += 3) {
    for (let j = 1; j < 24; j += 3) {
      if (j <= 10) {
        state.grid.setCell(i, j, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
        homes.push(`${i},${j}`);
      } else {
        state.grid.setCell(i, j, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
        works.push(`${i},${j}`);
      }
    }
  }
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % homes.length]!;
    c.workplaceId = works[n % works.length]!;
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

describe('載入結束時的通勤統計', () => {
  it('should have nothing before warmup runs', async () => {
    const loop = makeLoop(makeCity(60));
    expect(loop.getCommuteStats().sampled, '還沒載入就有統計，這條測試等於沒測').toBe(0);
  });

  it('should be ready by the time warmup finishes', async () => {
    const state = makeCity(60);
    const loop = makeLoop(state);

    await loop.warmup(0.2);

    const stats = loop.getCommuteStats();
    expect(stats.sampled, '載入結束了統計還是空的 —— 一進遊戲開圖層會是空白的')
      .toBeGreaterThan(0);
    expect(stats.byHome.size, '沒有任何住宅格拿得到顏色').toBeGreaterThan(0);
    expect(stats.median).toBeGreaterThan(0);
  });

  it('should already account for transit at warmup, not one tick later', async () => {
    // 可及性圖如果沒有先建起來，載入時算出來的通勤完全不含大眾運輸 —— 第一個
    // tick 才會被修正，玩家會看到顏色在進遊戲後跳一次。
    const state = makeCity(60);
    const stations = [
      state.metro.addStation(4, 4), state.metro.addStation(4, 13),
      state.metro.addStation(13, 13),
    ];
    state.metro.createLine(stations, 2);
    // 保證真的有人兩端都在站上 —— 隨機配對出來的通勤不一定用得到這條線。
    const rider = state.citizens.getCitizens()[0]!;
    rider.homeId = '4,4';
    rider.workplaceId = '13,13';

    const loop = makeLoop(state);
    await loop.warmup(0.2);

    expect(
      loop.getCommuteStats().byMode['METRO'],
      '載入時算的通勤沒有把捷運算進去 —— 顏色會在進遊戲後跳一次',
    ).toBeGreaterThan(0);
  });

  it('should bump the version so the overlay knows to rebuild', async () => {
    const loop = makeLoop(makeCity(60));
    const before = loop.getCommuteStatsVersion();

    await loop.warmup(0.2);

    expect(loop.getCommuteStatsVersion(), '版本沒有前進，圖層不會知道要重建')
      .toBeGreaterThan(before);
  });
});
