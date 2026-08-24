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
 * The simulation loop must refresh each route's headway and load factor to their current
 * values.
 *
 * Both are computed in `flattenSystems()`, and flat routes are only rebuilt when the player
 * changes the network **topology**, so without a per-tick refresh ridership growth never
 * reaches them. Measured on a 12,500-citizen save: stored load factor 0.0000192, recomputed
 * against current ridership **308**. Waiting then never lengthens with crowding and the whole
 * crowding model is inert (BUG-343).
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

    // Riders boarded. No stop, route or vehicle count moved, so the topology version does not
    // change.
    for (const s of route.stops) { s.dailyRiders = 50_000; s.smoothedDailyRiders = 50_000; }
    loop.tick();

    expect(flatOf(loop)[0]!.loadFactor, '扁平路線還記著人還沒上車時的載重率')
      .toBeGreaterThan(CROWDING.HOPELESS_LOAD);
    void state;
  });

  it('should slow the estimated ride down once the corridor jams up', () => {
    // Mode choice compares driving time against transit time, and the driving side charges
    // congestion in full. Reading the configured speed on the bus side makes buses look
    // implausibly good in a congested city: every car slows down while the bus keeps its
    // timetable.
    //
    // Speed is as live as load factor, since arterials congest tick by tick. Computing it only
    // at rebuild time repeats BUG-343 in a different field.
    const { state, loop, route } = busCity();
    const flat = () => flatOf(loop).find(r => r.routeId === route.id)!;
    // This small fixture barely congests, so the starting point is the configured speed to
    // eight decimal places.
    expect(flat().speed, 'fixture 一開始就不是設定車速')
      .toBeCloseTo(state.bus.getSpeed(), 4);

    state.bus.setRouteCongestion(route.id, 1);
    loop.tick();

    expect(flat().speed, '幹道塞死了，估計時間用的還是設定車速')
      .toBeLessThan(state.bus.getSpeed() * 0.9);
  });

  it('should let the load fall again once the riders go away', () => {
    // Rising without falling would leave a once-overloaded route permanently judged unusable.
    const { loop, route } = busCity();
    for (const s of route.stops) { s.dailyRiders = 50_000; s.smoothedDailyRiders = 50_000; }
    loop.tick();
    expect(flatOf(loop)[0]!.loadFactor).toBeGreaterThan(CROWDING.HOPELESS_LOAD);

    for (const s of route.stops) { s.dailyRiders = 0; s.smoothedDailyRiders = 0; }
    loop.tick();

    expect(flatOf(loop)[0]!.loadFactor, '人走光了，路線還被判定為擠不上去')
      .toBeLessThan(1);
  });
});
