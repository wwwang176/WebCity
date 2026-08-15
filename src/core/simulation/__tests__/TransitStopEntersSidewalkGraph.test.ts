import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { getInfraBuildingId } from '../../building/InfraConfig';

/**
 * 新蓋的站牌要立刻進得了人行道圖。
 *
 * 站牌在圖裡的身分就是一棟 1×1 建築的四個門節點 —— 行人靠那幾個門走進站牌，
 * 站牌的涵蓋範圍也是從那幾個門往外量的。沒有門節點，這個站牌服務不到任何人。
 *
 * 人行道圖的重建旗標只由 `markLaneGraphDirty` 設定，而蓋交通設施刻意不呼叫它
 * （設施不改變路網，拖著 lane graph 與通勤快取一起重算太貴）。於是站牌被關在
 * 門外，要等玩家隨手動一次道路才補得上。
 */

function cityWithRoad(): GameState {
  const state = createGameState(20, 20);
  for (let x = 0; x < 20; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < 19) flags |= RoadDirection.EAST;
    state.grid.setCell(x, 10, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function doorsAt(state: GameState, x: number, y: number): number {
  return state.sidewalkGraph.getNodesInCell(`${x},${y}`)
    .filter(n => n.type === 'building_entrance').length;
}

describe('新蓋的站牌與人行道圖', () => {
  it('should have no doors before anything is built there', () => {
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();
    expect(doorsAt(state, 5, 11), '什麼都還沒蓋就有門，這條測試等於沒測').toBe(0);
  });

  it('should give a freshly placed bus stop its doors right away', () => {
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();

    state.bus.addStop(5, 11);
    state.grid.setCell(5, 11, { buildingId: getInfraBuildingId('bus_stop') });
    loop.applyBuildingChange(['5,11']);

    expect(
      doorsAt(state, 5, 11),
      '站牌沒有進人行道圖 —— 它服務不到任何人，行人也走不進去',
    ).toBeGreaterThan(0);
  });

  it('should connect the new stop to the pavement beside it', () => {
    // 有門還不夠，門要接得上旁邊那條路的人行道，否則一樣沒有人走得到。
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();

    state.grid.setCell(5, 11, { buildingId: getInfraBuildingId('bus_stop') });
    loop.applyBuildingChange(['5,11']);

    const doors = state.sidewalkGraph.getNodesInCell('5,11')
      .filter(n => n.type === 'building_entrance');
    const linked = doors.some(d =>
      state.sidewalkGraph.getEdgesFrom(d.id).some(e => e.type === 'building_access'));

    expect(linked, '站牌的門沒有接上任何人行道').toBe(true);
  });
});
