import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { routeCongestion } from '../../traffic/RouteCongestion';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';

/**
 * 公車的壅塞由模擬迴圈**逐路線**餵進去。
 *
 * `BaseTransportSystem.congestionOn()` 本身只是一張表，餵不進去就永遠是全城平均 ——
 * 而公車跟著幹道跑，幹道本來就比平均塞。玩家 12 600 人的存檔實測:全城平均 0.211，
 * 那條公車路線沿線 0.380（1.8 倍）。
 */

function busCity() {
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(16, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  const route = state.bus.createRoute(
    [state.bus.addStop(7, 1), state.bus.addStop(15, 1), state.bus.addStop(57, 1)], 1);
  for (let k = 0; k < 40; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '16,2' });
  }

  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop, route };
}

describe('公車的逐路線壅塞', () => {
  it('should give two routes on different corridors different numbers', () => {
    // 只有一條路線的話，「每條都餵第一條的值」跟正確行為完全一樣 —— 照不出來。
    // 兩條路線走**不同的走廊**，而通勤車流只壓在其中一條上。
    const state = createGameState(60, 60);
    for (const y of [1, 40]) {
      for (let x = 2; x <= 58; x++) {
        let flags = RoadDirection.EAST | RoadDirection.WEST;
        if (x === 2) flags = RoadDirection.EAST;
        if (x === 58) flags = RoadDirection.WEST;
        state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
      }
    }
    // 住商都在 y=1 那條走廊上，所以車流全壓在它身上;y=40 那條沒有人用。
    state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(16, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const busy = state.bus.createRoute(
      [state.bus.addStop(7, 1), state.bus.addStop(15, 1), state.bus.addStop(57, 1)], 1);
    const quiet = state.bus.createRoute(
      [state.bus.addStop(7, 40), state.bus.addStop(15, 40), state.bus.addStop(57, 40)], 1);
    for (let k = 0; k < 40; k++) {
      state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '16,2' });
    }

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    for (let i = 0; i < 12; i++) loop.tick();

    const onBusy = state.bus.congestionOn(busy.id);
    const onQuiet = state.bus.congestionOn(quiet.id);
    expect(onBusy, '有人通勤的那條走廊壅塞是 0 —— fixture 沒有產生車流')
      .toBeGreaterThan(0);
    expect(onQuiet, '沒有人用的那條走廊跟繁忙的那條一樣塞 —— 兩條共用了同一個值')
      .toBeLessThan(onBusy);
  });

  it('should feed each route the congestion along its own path', () => {
    const { state, loop, route } = busCity();
    const flow = state.traffic.getPredictedFlow();
    expect(flow, '流量圖還沒算出來 —— 這個測試什麼都沒驗').not.toBeNull();

    const cells = state.bus.getRouteCells(route.id);
    expect(cells, '路線沒有段落 —— fixture 有問題').not.toBeNull();
    expect(cells!.size, '路線一格都沒蓋到').toBeGreaterThan(0);

    const expected = routeCongestion(cells!, (c) => flow!.get(c) ?? 0);
    expect(expected, '算不出沿線壅塞').not.toBeNull();

    expect(state.bus.congestionOn(route.id), '公車拿到的不是自己這條路線的壅塞')
      .toBeCloseTo(expected!, 10);

    void loop;
  });

  it('should still leave the system-wide level as the fallback', () => {
    // 逐路線是疊在全城平均上面的，不是取代它 —— 沒有段落的路線還是要有個數字可用。
    const { state } = busCity();

    expect(state.bus.congestionOn(999), '沒見過的路線沒有退回全城平均')
      .toBe(state.bus.congestionLevel);
  });

  it('should forget a route once the player deletes it', () => {
    // 路線編號只增不減。不清的話，一場改很多次路線的遊戲會一直長。
    const { state, route } = busCity();
    // 設一個看得出來的值 —— 這個小 fixture 的車流太少，算出來的逐路線值跟全城平均
    // 都趨近 0，拿它當前提的話刪掉之後也分不出差別。
    state.bus.setRouteCongestion(route.id, 0.9);
    expect(state.bus.congestionOn(route.id)).toBe(0.9);

    state.bus.deleteRoute(route.id);

    expect(state.bus.congestionOn(route.id), '路線刪了還記著它的壅塞值')
      .toBe(state.bus.congestionLevel);
  });
});
