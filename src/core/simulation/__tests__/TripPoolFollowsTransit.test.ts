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
    const { state, loop, line } = metroCity();
    const before = poolOf(loop).trips.length;
    expect(before, 'fixture 的池子本來就是空的').toBeGreaterThan(0);

    for (const c of state.citizens.getCitizens()) c.workplaceId = null;
    state.metro.deleteLine(line.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(poolOf(loop).trips.length, '一位市民都沒問到，池子卻被當成「零條」清掉了')
      .toBe(before);
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
