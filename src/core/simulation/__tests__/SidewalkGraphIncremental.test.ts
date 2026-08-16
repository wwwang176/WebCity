import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import type { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { WALK_RANGE_BY_TYPE } from '../../transport/WalkRange';

/**
 * 改一格道路，只重算那一格附近的人行道。
 *
 * `rebuildSidewalkGraph` 原本一律走 `buildFromGrid`，而它會把全圖的節點與邊丟掉
 * 重生：60×60 全鋪滿實測 80~130 ms，觸發條件是每一次道路編輯 —— 也就是玩家拉
 * 道路時的卡頓來源。`SidewalkGraph.updateCells` 早就寫好、也有自己的測試，只是
 * 從來沒有人呼叫它。
 *
 * 「有沒有重建」用節點的**物件識別**來看：全圖重建會產生全新的節點物件，增量
 * 更新則讓沒被碰到的那些原封不動。
 */

function gridCity(size = 24): GameState {
  const state = createGameState(size, size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i % 6 !== 0 && j % 6 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 6 === 0) flags |= RoadDirection.NORTH;
      if (j < size - 1 && i % 6 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 6 === 0) flags |= RoadDirection.WEST;
      if (i < size - 1 && j % 6 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  // 建築散在路邊，讓圖裡有門節點
  for (let i = 1; i < size; i += 6) {
    for (let j = 1; j < size; j += 6) {
      state.grid.setCell(i, j, { buildingId: 1 });
    }
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  loop.ensureSidewalkGraph();
  return loop;
}

/** 隨便挑一個離改動點很遠、確定存在的節點 id。 */
function farNodeId(state: GameState): string {
  // 十字路口四邊都接著路，反而不會有人行道節點 —— 挑一段直路。
  const node = state.sidewalkGraph.getNodesInCell('18,17')[0];
  expect(node, '測試佈局挑不到遠處的節點').toBeDefined();
  return node!.id;
}

describe('人行道圖的增量重建', () => {
  it('should keep untouched nodes as the very same objects', () => {
    const state = gridCity();
    const loop = makeLoop(state);
    const id = farNodeId(state);
    const before = state.sidewalkGraph.getNode(id);

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(
      state.sidewalkGraph.getNode(id),
      '改一格道路就把全圖的節點重建了一次',
    ).toBe(before);
  });

  it('should still fold the edited cell in', () => {
    // 增量不能變成「沒做」。改動的那一格必須真的長出人行道節點。
    const state = gridCity();
    const loop = makeLoop(state);
    expect(state.sidewalkGraph.getNodesInCell('1,3'), '這一格一開始就有節點，測試等於沒測')
      .toHaveLength(0);

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(state.sidewalkGraph.getNodesInCell('1,3').length, '新鋪的路沒有人行道')
      .toBeGreaterThan(0);
  });

  it('should not wipe the whole pedestrian path cache on an incremental update', () => {
    // 全量重建之後整份步行路徑都不能信，所以要清光；增量更新只有改動附近的路線
    // 死掉，`invalidateCells` 已經精準丟過了。清光的話會逼出一場多目標 A* 風暴，
    // 而那正是這次要消掉的成本。
    const state = gridCity();
    const loop = makeLoop(state);
    let cleared = 0;
    state.pedestrianManager.clearPathCache = () => { cleared++; };

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(cleared, '增量更新把整份步行路徑快取清光了').toBe(0);
  });

  it('should keep stop coverage a distant building change cannot affect', () => {
    // `applyBuildingChange` 跑在每一次建商蓋房拆房上，是全遊戲最高頻的異動。它會
    // 推進人行道圖的世代，而世代一動，站牌步行範圍的安全網就把整份快取丟掉 ——
    // 快取等於永遠活不過一個 growth tick，效能設計整個落空。所以這裡要精準失效。
    const state = gridCity();
    const loop = makeLoop(state);
    const reach = (loop as unknown as { stopReach: SidewalkStopReach }).stopReach;
    const far = reach.cellsWithin(1, 1, 5);

    state.grid.setCell(19, 19, { buildingId: 1 });
    loop.applyBuildingChange(['19,19']);

    expect(
      reach.cellsWithin(1, 1, 5),
      '遠處蓋了一棟房子，全城站牌的步行範圍都被丟掉重算',
    ).toBe(far);
  });

  it('should invalidate stop coverage as far out as the widest walk range', () => {
    // 失效半徑要蓋得住最寬的那一個運具（捷運 8 格），不是某一個運具的上限。
    // 用窄的半徑失效，5~8 格之間的站牌會保留過期的涵蓋範圍。
    const state = gridCity();
    const loop = makeLoop(state);
    const reach = (loop as unknown as { stopReach: SidewalkStopReach }).stopReach;
    const stale = reach.cellsWithin(1, 1, WALK_RANGE_BY_TYPE.WIDEST);

    // 距離 7 格：超過公車的 4 格，但在捷運的 8 格之內
    state.grid.setCell(8, 1, { buildingId: 1 });
    loop.applyBuildingChange(['8,1']);

    expect(
      reach.cellsWithin(1, 1, WALK_RANGE_BY_TYPE.WIDEST),
      '七格外的改動沒有讓這個站牌重算 —— 捷運的涵蓋範圍過期了',
    ).not.toBe(stale);
  });

  it('should rebuild everything when no cells are named', () => {
    // 存檔載入這類「不知道動了哪裡」的情形，仍然要走全量重建。
    const state = gridCity();
    const loop = makeLoop(state);
    const id = farNodeId(state);
    const before = state.sidewalkGraph.getNode(id);

    loop.markLaneGraphDirty();
    loop.ensureSidewalkGraph();

    expect(state.sidewalkGraph.getNode(id), '沒有指名格子時應該全量重建').not.toBe(before);
  });
});
