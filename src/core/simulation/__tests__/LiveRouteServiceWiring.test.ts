import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { CROWDING } from '../../transport/RouteLoad';
import type { FlatRoute } from '../../transport/MultiModalRouter';

/**
 * 模擬迴圈要把每條路線的班距與載重率更新成當下的數字。
 *
 * 這兩個值算在 `flattenSystems()` 裡，而扁平路線只有玩家動到路網**拓樸**時才重建
 * —— 沒有人每個 tick 把它們刷新的話，搭乘人數怎麼漲都回不到這裡。玩家 12 500 人的
 * 存檔實測:記著的載重率 0.0000192，照當下人數重算是 **308**。於是 `isOverCapacity()`
 * 永遠拿舊值，路線永遠不拒載;等車也永遠不會因為擠而變久（BUG-343）。
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
  state.grid.setCell(56, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  const route = state.bus.createRoute(
    [state.bus.addStop(7, 1), state.bus.addStop(55, 1)], 1);
  for (let k = 0; k < 40; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '56,2' });
  }

  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop, route };
}

function flatOf(loop: SimulationLoop): FlatRoute[] {
  return (loop as unknown as { flatRoutes: FlatRoute[] }).flatRoutes;
}

describe('迴圈餵給路線的班距與載重率', () => {
  it('should notice riders who boarded without the player touching the network', () => {
    const { state, loop, route } = busCity();
    expect(flatOf(loop), 'fixture 裡沒有扁平路線 —— 這個測試沒驗到東西')
      .toHaveLength(1);
    expect(flatOf(loop)[0]!.loadFactor, '一開始就滿載了').toBeLessThan(1);

    // 有人搭車了。站牌、路線、車輛數一個都沒動 —— 拓樸版本不會跳號。
    for (const s of route.stops) { s.dailyRiders = 50_000; s.smoothedDailyRiders = 50_000; }
    loop.tick();

    expect(flatOf(loop)[0]!.loadFactor, '扁平路線還記著人還沒上車時的載重率')
      .toBeGreaterThan(CROWDING.REFUSE_LOAD);
    void state;
  });

  it('should slow the estimated ride down once the corridor jams up', () => {
    // 運具選擇是把「開車要多久」跟「搭車要多久」擺在一起比大小，而開車那一側滿滿地
    // 計入壅塞。公車那一側如果讀設定車速，塞車的城市裡公車會看起來不合理地好 ——
    // 路上的車全部慢下來，只有公車照跑。
    //
    // 而車速跟載重率一樣會變:幹道是逐 tick 在塞的。只在重建時算一次的話，就是把
    // BUG-343 換一個欄位再犯一次。
    const { state, loop, route } = busCity();
    const flat = () => flatOf(loop).find(r => r.routeId === route.id)!;
    // 這座小 fixture 幾乎不塞，所以起點就是設定車速（差在小數第八位）。
    expect(flat().speed, 'fixture 一開始就不是設定車速')
      .toBeCloseTo(state.bus.getSpeed(), 4);

    state.bus.setRouteCongestion(route.id, 1);
    loop.tick();

    expect(flat().speed, '幹道塞死了，估計時間用的還是設定車速')
      .toBeLessThan(state.bus.getSpeed() * 0.9);
  });

  it('should let the load fall again once the riders go away', () => {
    // 只往上不往下的話，一條曾經爆滿的路線會永遠被判定為拒載。
    const { loop, route } = busCity();
    for (const s of route.stops) { s.dailyRiders = 50_000; s.smoothedDailyRiders = 50_000; }
    loop.tick();
    expect(flatOf(loop)[0]!.loadFactor).toBeGreaterThan(CROWDING.REFUSE_LOAD);

    for (const s of route.stops) { s.dailyRiders = 0; s.smoothedDailyRiders = 0; }
    loop.tick();

    expect(flatOf(loop)[0]!.loadFactor, '人走光了，路線還被判定為擠不上去')
      .toBeLessThan(CROWDING.COMFORT_LOAD);
  });
});
