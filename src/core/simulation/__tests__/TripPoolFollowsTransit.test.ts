import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import type { AggregatedTrip, WalkingTripPool } from '../../traffic/PedestrianManager';

/**
 * Pedestrians on the street are generated from the pool of "walk to which stop" trips. When
 * a stop is demolished, those trips must disappear with it.
 *
 * Measured on a 12,500-citizen save: **every one** of the 40 trips in the pool was a first or
 * last mile to one of three metro stations. Demolishing every metro station and running 12
 * seconds left the same 40 trips, with 328 pedestrians still walking out of stations that no
 * longer existed.
 *
 * The pool is rebuilt only on `markLaneGraphDirty()`, i.e. a **road** change. Transit changes
 * do not trigger it on their own.
 */

type Internals = {
  walkingTripPool: WalkingTripPool;
  tripPoolDirty: boolean;
};

function poolOf(loop: SimulationLoop): WalkingTripPool {
  return (loop as unknown as Internals).walkingTripPool;
}

/** How many trips have either end on one of these cells. */
function touches(trips: readonly AggregatedTrip[], cells: readonly string[]): number {
  let n = 0;
  for (const t of trips) {
    if (cells.includes(`${t.fromX},${t.fromY}`) || cells.includes(`${t.toX},${t.toY}`)) n++;
  }
  return n;
}

/** One east-west two-way road. */
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
 * A corridor with housing at one end, commerce at the other, and a metro line between them.
 *
 * The 50-tile distance exists to make the metro **beat driving**: any closer and everyone
 * drives, the pool is empty, and the test checks nothing.
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
    // The player deletes a line from the route panel and the stations **stay where they
    // are**. No line means no vehicles, so the station is nobody's destination and the trips
    // to it must go.
    const { state, loop, line, stationCells } = metroCity();

    state.metro.deleteLine(line.id);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(state.metro.getStations().length, '這個測試要驗的是車站還在的情形').toBe(2);
    expect(touches(poolOf(loop).trips, stationCells),
      '線砍了但車站還在，行人繼續走向一個不會有車來的站').toBe(0);
  });

  it('should empty the pool when nobody walks any more', () => {
    // With every transit line demolished, this city has **no** walking trips left.
    // "Collected zero" and "has not collected yet" are different states, and the right answer
    // to the first is an empty pool.
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
    // With only one line demolished, people are still walking and the collection is not
    // empty. This isolates whether a rebuild was marked at all: the two tests above also turn
    // red when the collection comes back empty.
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
    // With no commuting citizens at all the sampling loop exits early and asks nobody.
    // Clearing the pool then would be a **false answer**: not having asked is not "zero".
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
    // A single tick only reaches a handful of citizens, and walking trips arrive in
    // **bursts**: a batch switches to transit at a congestion peak and none appear otherwise.
    // Measured on a 12,500-citizen save, 260 trips arrived across 45,338 consecutive samples,
    // all in five bursts — committing at an arbitrary tick collects zero of them nine times
    // out of ten and leaves no pedestrians on the streets.
    const { loop } = metroCity();
    const inner = loop as unknown as Internals;

    loop.markLaneGraphDirty();
    loop.tick();
    expect(inner.tripPoolDirty, '只問了一個 tick 的一小撮人就定案了').toBe(true);

    for (let i = 0; i < 12; i++) loop.tick();
    expect(inner.tripPoolDirty, '問過一輪了還沒定案').toBe(false);
  });

  it('should not let the sweep target run away from the sweep', () => {
    // A sweep's length is fixed when it starts. Re-reading the population each tick lets a
    // growing city push the target along with the progress: the number asked grows as a
    // square root of population while the target grows linearly, so the sweep never ends and
    // the pool never commits.
    const { state, loop } = metroCity();
    const inner = loop as unknown as Internals;
    // High-rise housing so arrivals do not hit the residential capacity ceiling; hitting it
    // stops the population growing and the test checks nothing.
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
    // An empty city's sampling loop exits early and a sweep length is never set. With an
    // initial value of 0, "nothing asked yet" already meets the target: the first tick commits
    // an empty pool and never rebuilds again until the player happens to edit a road.
    const state = createGameState(60, 60);
    corridor(state, 1);
    state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(56, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.metro.createLine(
      [state.metro.addStation(7, 1), state.metro.addStation(55, 1)], 2);

    // High-rise housing: the citizens move in after the loop has run, by which point
    // residential capacity is already computed from the grid. With one small house,
    // `createCitizen` would reject most of them and the sampling might not draw the few that
    // remain, making the test flaky.
    state.grid.setCell(8, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });

    const loop = start(state);   // no citizens yet
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
    // Collecting a sweep takes a full pass over the city (about 24 ticks on that save).
    // Generating from the old pool meanwhile keeps emitting pedestrians from demolished
    // stations for several seconds.
    const { state, loop, line, stationCells } = metroCity();
    expect(touches(poolOf(loop).trips, stationCells), 'fixture 裡沒有人搭捷運')
      .toBeGreaterThan(0);

    state.metro.deleteLine(line.id);
    loop.tick();

    expect(poolOf(loop).trips.length, '要等收集完才丟，中間繼續走向已經沒車的車站')
      .toBe(0);
  });

  it('should keep the old pool while a road edit is being swept', () => {
    // A road change does not discard the pool: those coordinates are still valid and only the
    // walking route changes. Players edit roads far more often, so discarding would make the
    // pedestrians on screen vanish for a sweep after every road drawn.
    const { loop } = metroCity();
    const before = poolOf(loop).trips.length;

    loop.markLaneGraphDirty();
    loop.tick();

    expect(poolOf(loop).trips.length, '玩家每畫一條路，行人就全部消失一輪').toBe(before);
  });

  it('should still rebuild in a city sitting at the vehicle cap', () => {
    // The trip pool is collected by the commute-vehicle sampling loop, and that whole path is
    // skipped once vehicles reach the cap. A large city sits at the cap permanently, so the
    // pool would never update again.
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
    // This pass only asks citizens in order to recollect walking trips; the vehicle cap is
    // full. Without the guard, the rebuild becomes a side door around the cap.
    // Only the commute-vehicle side is covered here. Freight is guarded too, but factories in
    // a small fixture are abandoned before they ever ship, so it cannot be exercised — noted
    // on the `if (!atCap)` in spawnVehicles.
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
    // The original rebuild trigger, which must survive the addition of the transit trigger.
    const { loop } = metroCity();
    const inner = loop as unknown as Internals;

    expect(inner.tripPoolDirty, '暖機完了池子還標著要重建').toBe(false);
    loop.markLaneGraphDirty();
    expect(inner.tripPoolDirty, '改了道路卻沒有標記行人路線池要重建').toBe(true);
  });
});
