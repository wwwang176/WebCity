import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import type { AggregatedTrip, WalkingTripPool } from '../../traffic/PedestrianManager';

/**
 * 路上的行人是照「走去哪一站」的路線池生出來的。站牌拆掉之後，那些路線必須跟著消失。
 *
 * 玩家 12 500 人的存檔實測:池子裡 40 條路線**每一條**都是走向三個捷運站的第一/最後
 * 一哩。把捷運全部拆掉、再跑 12 秒，池子仍然是同樣那 40 條 —— 328 位行人繼續從
 * 已經不存在的車站走出來。
 *
 * 池子只有在 `markLaneGraphDirty()`（動到**道路**）時才會重建。動到大眾運輸不會。
 */

type Internals = {
  walkingTripPool: WalkingTripPool;
  tripPoolDirty: boolean;
};

function poolOf(loop: SimulationLoop): WalkingTripPool {
  return (loop as unknown as Internals).walkingTripPool;
}

/** 路線的兩端有沒有踩在這些格子上。 */
function touches(trips: readonly AggregatedTrip[], cells: readonly string[]): number {
  let n = 0;
  for (const t of trips) {
    if (cells.includes(`${t.fromX},${t.fromY}`) || cells.includes(`${t.toX},${t.toY}`)) n++;
  }
  return n;
}

/** 一條東西向的雙向道路。 */
function corridor(state: ReturnType<typeof createGameState>, y: number): void {
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
}

function start(state: ReturnType<typeof createGameState>): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return loop;
}

/**
 * 一條走廊、兩端一住一商，中間一條捷運。
 *
 * 距離拉到 50 格是為了讓捷運**贏過開車** —— 太近的話所有人都選開車，池子是空的，
 * 這個測試就什麼都沒驗到。
 */
function metroCity() {
  const state = createGameState(60, 60);
  corridor(state, 1);
  state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(56, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  const stations = [state.metro.addStation(7, 1), state.metro.addStation(55, 1)];
  const line = state.metro.createLine(stations, 2);
  for (let k = 0; k < 60; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '56,2' });
  }
  return { state, loop: start(state), line, stationCells: ['7,1', '55,1'] };
}

describe('行人路線池跟著大眾運輸走', () => {
  it('should stop walking to a station the player demolished', () => {
    const { state, loop, line, stationCells } = metroCity();

    expect(touches(poolOf(loop).trips, stationCells),
      '池子裡沒有半條走向捷運站的路線 —— fixture 裡沒有人搭捷運，這個測試沒驗到東西')
      .toBeGreaterThan(0);

    state.metro.deleteLine(line.id);
    for (const s of [...state.metro.getStations()]) state.metro.removeStation(s.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(touches(poolOf(loop).trips, stationCells),
      '車站拆了，行人還在走向它').toBe(0);
  });

  it('should stop walking to a station whose line was deleted but which still stands', () => {
    // 玩家在路線面板砍掉一條線，車站**留在原地**。沒有線就沒有車 ——
    // 那個站不再是任何人的目的地，走向它的路線必須跟著消失。
    const { state, loop, line, stationCells } = metroCity();

    state.metro.deleteLine(line.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(state.metro.getStations().length, '這個測試要驗的是車站還在的情形').toBe(2);
    expect(touches(poolOf(loop).trips, stationCells),
      '線砍了但車站還在，行人繼續走向一個不會有車來的站').toBe(0);
  });

  it('should empty the pool when nobody walks any more', () => {
    // 拆掉全部的大眾運輸之後，這座城市**一條**步行路線都不剩。
    // 「收集到零條」跟「還沒收集」是兩件事 —— 前者的正確答案是把池子清空。
    const { state, loop, line } = metroCity();

    expect(poolOf(loop).totalWeight, 'fixture 的池子本來就是空的').toBeGreaterThan(0);

    state.metro.deleteLine(line.id);
    for (const s of [...state.metro.getStations()]) state.metro.removeStation(s.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(poolOf(loop).trips.length, '沒有人走路了，池子卻還留著舊路線').toBe(0);
    expect(poolOf(loop).totalWeight, '權重沒歸零 —— 行人管理員會繼續照舊池子生人')
      .toBe(0);
  });

  it('should keep the routes that survive when only one line is demolished', () => {
    // 只拆其中一條線時，還有人在走路 —— 收集到的路線不是零條。
    // 這一條把「有沒有標記重建」單獨照出來:上面兩條在收集結果為空時也會紅。
    const state = createGameState(60, 60);
    corridor(state, 1);
    corridor(state, 40);
    state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(56, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(6, 41, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(56, 41, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const metroLine = state.metro.createLine(
      [state.metro.addStation(7, 1), state.metro.addStation(55, 1)], 2);
    state.rail.createRoute(
      [state.rail.addStop(7, 40), state.rail.addStop(55, 40)], 2);
    for (let k = 0; k < 60; k++) {
      state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '56,2' });
      state.citizens.createCitizen({ age: 100, homeId: '6,41', workplaceId: '56,41' });
    }
    const loop = start(state);

    const metroCells = ['7,1', '55,1'];
    const railCells = ['7,40', '55,40'];
    expect(touches(poolOf(loop).trips, metroCells), '沒有人搭捷運').toBeGreaterThan(0);
    expect(touches(poolOf(loop).trips, railCells), '沒有人搭火車').toBeGreaterThan(0);

    state.metro.deleteLine(metroLine.id);
    for (const s of [...state.metro.getStations()]) state.metro.removeStation(s.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(touches(poolOf(loop).trips, metroCells), '捷運拆了，行人還在走向捷運站')
      .toBe(0);
    expect(touches(poolOf(loop).trips, railCells), '火車站沒被動過，走向它的路線卻不見了')
      .toBeGreaterThan(0);
  });

  it('should not rebuild from a pass that never asked anybody', () => {
    // 沒有半個可以通勤的市民時，取樣迴圈提早退場，一位都沒問到。
    // 這時候把池子清空是**假的答案** —— 沒問過不等於「零條」。
    const { state, loop } = metroCity();
    const before = poolOf(loop).trips.length;
    expect(before, 'fixture 的池子本來就是空的').toBeGreaterThan(0);

    for (const c of state.citizens.getCitizens()) c.workplaceId = null;
    loop.markLaneGraphDirty();
    for (let i = 0; i < 12; i++) loop.tick();

    expect(poolOf(loop).trips.length, '一位市民都沒問到，池子卻被當成「零條」清掉了')
      .toBe(before);
  });

  it('should ask a whole sweep of commuters before committing the pool', () => {
    // 一個 tick 只問得到一小撮人，而步行路線在時間上是**成串**出現的:壅塞高峰時
    // 一批人翻去搭車，其餘時間一個都沒有。玩家 12 500 人的存檔實測，連續 45 338 次
    // 詢問收集到 260 條，全部集中在五次爆發裡 —— 隨便挑一個 tick 定案，九成的機率
    // 收集到零條，路上一個行人都不會有。
    const { loop } = metroCity();
    const inner = loop as unknown as Internals;

    loop.markLaneGraphDirty();
    loop.tick();
    expect(inner.tripPoolDirty, '只問了一個 tick 的一小撮人就定案了').toBe(true);

    for (let i = 0; i < 12; i++) loop.tick();
    expect(inner.tripPoolDirty, '問過一輪了還沒定案').toBe(false);
  });

  it('should not let the sweep target run away from the sweep', () => {
    // 一輪的長度在開輪時定下來。每個 tick 重新讀人口的話，成長中的城市會讓目標
    // 跟著進度一起往前跑 —— 問的人數跟人口是平方根關係，目標卻是線性的，那一輪
    // 永遠不會結束，池子也就永遠不定案。
    const { state, loop } = metroCity();
    const inner = loop as unknown as Internals;
    // 高層住宅，讓遷入不撞到住宅容量的上限 —— 撞到的話人口不會長，
    // 這個測試就什麼都沒驗到。
    for (let x = 8; x <= 40; x++) {
      state.grid.setCell(x, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    }

    loop.markLaneGraphDirty();
    const before = state.citizens.getPopulation();
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 200; k++) {
        state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '56,2' });
      }
      loop.tick();
    }
    expect(state.citizens.getPopulation(), '人口沒有長 —— 遷入撞到住宅容量了')
      .toBeGreaterThan(before + 2000);

    expect(inner.tripPoolDirty, '城市一邊長大，這一輪就永遠結束不了').toBe(false);
  });

  it('should still build a first pool for a city that started empty', () => {
    // 空城的取樣迴圈提早退場，一輪的長度還沒被定下來過。起始值是 0 的話
    // 「一位都還沒問」就算達標 —— 第一個 tick 就定案成空池子，而且從此不再重建，
    // 直到玩家剛好動到一條路為止。
    const state = createGameState(60, 60);
    corridor(state, 1);
    state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(56, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.metro.createLine(
      [state.metro.addStation(7, 1), state.metro.addStation(55, 1)], 2);

    // 高層住宅:市民是在迴圈跑過之後才搬進來的，這時住宅容量已經照網格算好了 ——
    // 只有一棟小房子的話 `createCitizen` 會擋掉多數人，剩下的幾位取樣不一定抽得到，
    // 這個測試就會偶爾紅。
    state.grid.setCell(8, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });

    const loop = start(state);   // 一個市民都還沒有
    expect(poolOf(loop).trips.length, '空城卻有步行路線').toBe(0);

    let moved = 0;
    for (let k = 0; k < 60; k++) {
      if (state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '56,2' })) moved++;
    }
    expect(moved, '人根本沒搬進來 —— 撞到住宅容量了').toBe(60);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(poolOf(loop).trips.length, '人搬進來了，池子卻沒有重建過')
      .toBeGreaterThan(0);
  });

  it('should drop the pool the moment a line goes, not when the sweep ends', () => {
    // 收集一輪要問過全城（玩家的存檔約 24 個 tick）。這段期間繼續照舊池子生人的話，
    // 拆掉的車站還會再吐幾秒的行人 —— 那正是這個 bug 被回報的樣子。
    const { state, loop, line, stationCells } = metroCity();
    expect(touches(poolOf(loop).trips, stationCells), 'fixture 裡沒有人搭捷運')
      .toBeGreaterThan(0);

    state.metro.deleteLine(line.id);
    loop.tick();

    expect(poolOf(loop).trips.length, '要等收集完才丟，中間繼續走向已經沒車的車站')
      .toBe(0);
  });

  it('should keep the old pool while a road edit is being swept', () => {
    // 改道路不丟池子:那些座標還是有效的，變的只是走法。而玩家畫路的頻率高得多，
    // 丟掉會讓路上的行人每畫一次路就消失一輪。
    const { loop } = metroCity();
    const before = poolOf(loop).trips.length;

    loop.markLaneGraphDirty();
    loop.tick();

    expect(poolOf(loop).trips.length, '玩家每畫一條路，行人就全部消失一輪').toBe(before);
  });

  it('should still rebuild in a city sitting at the vehicle cap', () => {
    // 路線池是搭著「生通勤車」那個取樣迴圈收集的，而那條路徑在車輛達到上限時
    // 整條被跳過 —— 大城市會永遠停在上限，於是路線池永遠不再更新。
    // 換乘圖以前也踩過同一個坑，已經搬出來了。
    const { state, loop, line, stationCells } = metroCity();
    expect(touches(poolOf(loop).trips, stationCells), 'fixture 裡沒有人搭捷運')
      .toBeGreaterThan(0);

    state.traffic.getVehicleCount = () => 999_999;
    state.metro.deleteLine(line.id);
    for (const s of [...state.metro.getStations()]) state.metro.removeStation(s.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(touches(poolOf(loop).trips, stationCells),
      '車輛滿載的城市裡，車站拆了行人還在走向它').toBe(0);
  });

  it('should not sneak a single vehicle onto the road while rebuilding at the cap', () => {
    // 這一輪只是為了重新收集步行路線才問市民的 —— 車位是滿的。
    // 不擋的話，重建就變成一道繞過車輛上限的側門。
    // 只守得住通勤車這一側。貨運車也擋著，但小 fixture 裡的工廠撐不到出貨就先被
    // 廢棄了，照不出來 —— 已在 spawnVehicles 的那道 `if (!atCap)` 上標明。
    const { state, loop, line } = metroCity();

    let spawns = 0;
    const real = state.traffic.spawnVehicleOnEdges.bind(state.traffic);
    state.traffic.spawnVehicleOnEdges = ((...a: Parameters<typeof real>) => {
      spawns++;
      return real(...a);
    }) as typeof real;

    state.traffic.getVehicleCount = () => 999_999;
    state.metro.deleteLine(line.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(spawns, '車位滿了，重建路線池的那一輪還是把車放上路了').toBe(0);
  });

  it('should still rebuild when the player edits a road', () => {
    // 原本唯一的重建觸發點。加上大眾運輸這個觸發點之後它必須還在。
    const { loop } = metroCity();
    const inner = loop as unknown as Internals;

    expect(inner.tripPoolDirty, '暖機完了池子還標著要重建').toBe(false);
    loop.markLaneGraphDirty();
    expect(inner.tripPoolDirty, '改了道路卻沒有標記行人路線池要重建').toBe(true);
  });
});
