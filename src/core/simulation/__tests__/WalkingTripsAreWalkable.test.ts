import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';
import { getInfraBuildingId } from '../../building/InfraConfig';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { SIMULATION } from '../SimulationConstants';
import type { WalkingTripPool } from '../../traffic/PedestrianManager';
import { WALK_RANGE_BY_TYPE } from '../../transport/WalkRange';

/**
 * 派出去的行人，一定走得到目的地。
 *
 * 這是玩家真正看到的那個東西：站牌在馬路對面，行人繞了一大圈走過去。繞路本身是
 * 對的（行人只在路口過馬路），錯的是模擬一開始就不該把他派去對面那個站牌 ——
 * 挑站的地方用直線距離量，對街只有兩格，於是被選中。
 *
 * 這裡不檢查「有沒有繞路」，而是檢查一條更強的性質：**每一段被派出去的步行，
 * 都要在步行上限之內真的走得到**。走不到的那些，正是會變成繞大圈或乾脆生不出來
 * 的行人。
 */

const HOME_Y = 9;
const ROAD_Y = 10;
const STOP_Y = 11;

/**
 * 一條東西向主幹道，兩端才有路口。住家全在路北，公車站牌全在路南 —— 直線量的話
 * 家家戶戶都「兩格到站」，實際上要走到地圖邊緣的路口才過得去。
 */
function cityWithStopsAcrossTheRoad(): GameState {
  const W = 24;
  const state = createGameState(W, W);

  for (let x = 0; x < W; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < W - 1) flags |= RoadDirection.EAST;
    if (x === 0 || x === W - 1) flags |= RoadDirection.NORTH | RoadDirection.SOUTH;
    state.grid.setCell(x, ROAD_Y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  // 兩端的南北向連通道，製造僅有的兩個路口
  for (const x of [0, W - 1]) {
    for (let y = HOME_Y - 2; y <= STOP_Y + 2; y++) {
      if (y === ROAD_Y) continue;
      let flags = RoadDirection.NORTH | RoadDirection.SOUTH;
      state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }

  const homes: string[] = [];
  const works: string[] = [];
  for (let x = 3; x < W - 3; x += 2) {
    state.grid.setCell(x, HOME_Y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    homes.push(`${x},${HOME_Y}`);
    state.grid.setCell(x, HOME_Y - 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    works.push(`${x},${HOME_Y - 1}`);
  }

  // 站牌全在路南
  const busId = getInfraBuildingId('bus_stop');
  const stops = [4, 12, 19].map(x => {
    state.grid.setCell(x, STOP_Y, { buildingId: busId });
    return state.bus.addStop(x, STOP_Y);
  });
  state.bus.createRoute(stops, 2);

  for (let n = 0; n < 40; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % homes.length]!;
    c.workplaceId = works[(n + 3) % works.length]!;
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function tripPoolOf(loop: SimulationLoop): WalkingTripPool {
  return (loop as unknown as { walkingTripPool: WalkingTripPool }).walkingTripPool;
}

describe('派出去的步行都走得到', () => {
  it('should produce some walking trips at all', () => {
    // 對照組：站牌改蓋在路北，也就是住家那一側 —— 這時候應該真的有行人被派出去。
    const state = cityWithStopsAcrossTheRoad();
    for (const s of state.bus.getStops()) {
      state.grid.setCell(s.x, s.y, { buildingId: 0 });
      s.y = HOME_Y + 0; // 搬到住家那一側
      state.grid.setCell(s.x, s.y, { buildingId: getInfraBuildingId('bus_stop') });
    }
    const loop = makeLoop(state);
    for (let i = 0; i < 40; i++) loop.tick();

    expect(
      tripPoolOf(loop).trips.length,
      '一條行人都沒派出去，下面那條測試等於沒測',
    ).toBeGreaterThan(0);
  });

  it('should never dispatch a walk that cannot be walked', () => {
    const state = cityWithStopsAcrossTheRoad();
    const loop = makeLoop(state);
    for (let i = 0; i < 40; i++) loop.tick();

    const reach = new SidewalkStopReach(state.sidewalkGraph);
    const limit = WALK_RANGE_BY_TYPE.WIDEST;

    for (const trip of tripPoolOf(loop).trips) {
      const walkable = reach.cellsWithin(trip.fromX, trip.fromY, limit)
        .get(`${trip.toX},${trip.toY}`);
      expect(
        walkable,
        `行人被派去走 (${trip.fromX},${trip.fromY}) → (${trip.toX},${trip.toY})，`
        + `但沿人行道在 ${limit} 格內走不到 —— 他會繞到地圖邊緣的路口再繞回來`,
      ).toBeDefined();
    }
  });
});
