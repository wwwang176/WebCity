import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType, RoadDirection } from '../../road/types';
import { RailType } from '../../rail/types';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ElevatedRoadBuilder } from '../../elevation/ElevatedRoadBuilder';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph, isIntersectionCell } from '../LaneGraph';
import { findLanePath, findBuildingAccessPoints } from '../LaneGraphPathfinder';
import { parseLevelFromKey } from '../../grid/GridHelpers';

/**
 * 建築的車庫開在地面上。
 *
 * 高架橋沒有出入口 —— 橋面與底下的地面之間沒有任何連結，上下橋只能走匝道。
 * 但是建築找附近道路的時候是 `getAllKeysAtPosition`，那個方法回的是**所有樓層**，
 * 於是一棟緊鄰高架的房子會直接掛到橋面上的車道點，車就從屋頂飛上橋開走。
 *
 * 這裡釘的是「起點與終點只能是地面」。橋還是要能開 —— 差別在於車必須從地面上橋，
 * 走匝道。
 */

const EAST = RoadDirection.EAST;
const WEST = RoadDirection.WEST;

/**
 * 兩條地面街道，中間七格沒有路，只有一座高架橋跨過去，兩端各一個匝道。
 *
 *   y=3  地面 x=1..3            斷開 x=4..10            地面 x=11..13
 *   y=3  高架 level 1  x=3(匝道) x=4..10  x=11(匝道)
 *
 * 三種位置各有一棟房子：
 *   (2,2)  地面與匝道都碰得到  —— 車該從地面出發
 *   (7,2)  只碰得到橋面        —— 不該有車
 *   (12,2) 只碰得到地面        —— 終點
 */
function bridgedCity() {
  const grid = new Grid(20, 20);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 1, y: 3 }, { x: 3, y: 3 }, RoadType.TWO_LANE, 1e6);
  rb.buildRoad({ x: 11, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);

  const em = new ElevationManager();
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.TWO_LANE,
    roadFlags: EAST | WEST,
    railType: RailType.NONE,
    railFlags: 0,
    isRamp,
    rampAscendDirection: ascend,
  });
  em.set(3, 3, 1, seg(true, EAST));
  for (let x = 4; x <= 10; x++) em.set(x, 3, 1, seg(false, 0));
  em.set(11, 3, 1, seg(true, WEST));

  const lookup = new UnifiedRoadLookup(grid, em);
  const graph = new LaneGraph();
  graph.buildFromGrid(lookup, lookup.getAllCellKeys());
  return { graph, lookup };
}

const HOUSE_ON_THE_GROUND = { x: 2, y: 2 };
const HOUSE_UNDER_THE_BRIDGE = { x: 7, y: 2 };
const SHOP_ACROSS_THE_GAP = { x: 12, y: 2 };

describe('車子從地面上路', () => {
  it('should give a house next to the bridge and nothing else no car at all', () => {
    // (7,2) 兩格內只有橋面。以前這裡拿得到一條完整的路 —— 車從二樓的空中出發。
    const { graph, lookup } = bridgedCity();
    expect(findLanePath(graph, lookup, HOUSE_UNDER_THE_BRIDGE, SHOP_ACROSS_THE_GAP))
      .toBeNull();
  });

  it('should still let a car reach the far side over the bridge', () => {
    // 反向對照。上一條可以靠「高架完全不給走」滿足，那會讓橋變成裝飾品。
    const { graph, lookup } = bridgedCity();
    const path = findLanePath(graph, lookup, HOUSE_ON_THE_GROUND, SHOP_ACROSS_THE_GAP);
    expect(path, '地面的房子連對岸都到不了 —— 橋被整個封死了').not.toBeNull();
    const levels = path!.map(e => parseLevelFromKey(e.to.cellKey));
    expect(Math.max(...levels), '這條路根本沒上橋，測不出東西').toBe(1);
  });

  it('should start that car on the ground, not on the ramp deck', () => {
    // (2,2) 同時碰得到地面的 (1..3,3) 與匝道的 (3,3,1)。多起點 A* 是照成本挑的，
    // 匝道那個起點離終點更近，所以以前贏的是它 —— 車直接出現在匝道上。
    const { graph, lookup } = bridgedCity();
    const path = findLanePath(graph, lookup, HOUSE_ON_THE_GROUND, SHOP_ACROSS_THE_GAP)!;
    expect(parseLevelFromKey(path[0]!.from.cellKey), '車從高架上出發').toBe(0);
  });

  it('should offer only ground cells as a building`s way onto the road', () => {
    // 直接測共用的那一支 —— 主執行緒的 findLanePath 與 worker 的
    // collectPointIndices 都走它，規則只有這一份。
    const { graph, lookup } = bridgedCity();
    for (const type of ['entry', 'exit'] as const) {
      const pts = findBuildingAccessPoints(graph, HOUSE_ON_THE_GROUND.x, HOUSE_ON_THE_GROUND.y, lookup, type);
      expect(pts.length, `${type} 一個都沒有，這條測不出東西`).toBeGreaterThan(0);
      for (const p of pts) {
        expect(parseLevelFromKey(p.cellKey), `${type} 掛到了 ${p.cellKey}`).toBe(0);
      }
    }
  });
});
/**
 * 一棟房子兩格內能開上哪些格。
 *
 * 這是三條規則共用的觀測點:高架不算（BUG-312）、匝道不算、路口不算。
 */
function accessCells(graph: LaneGraph, lookup: UnifiedRoadLookup, bx: number, by: number): string[] {
  return [...new Set(
    findBuildingAccessPoints(graph, bx, by, lookup, 'exit').map(p => p.cellKey),
  )].sort();
}

function graphOf(grid: Grid, em = new ElevationManager()) {
  const lookup = new UnifiedRoadLookup(grid, em);
  const graph = new LaneGraph();
  graph.buildFromGrid(lookup, lookup.getAllCellKeys());
  return { graph, lookup };
}

/**
 * 匝道底下的地面格。
 *
 * 建高架時 `RAMP_OVER_ROAD` 擋著，不能把匝道蓋在既有的地面路上 —— 但**反過來
 * 沒人擋**:先蓋匝道，再從它底下畫一條地面路，成立。於是那一格同時有地面道路
 * 與一段從地面爬到二樓的斜坡，房子就掛上去了。
 */
function rampWithARoadUnderIt() {
  const grid = new Grid(24, 24);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 2, y: 10 }, { x: 4, y: 10 }, RoadType.TWO_LANE, 1e6);
  const em = new ElevationManager();
  new ElevatedRoadBuilder(grid, em).buildElevatedRoad(
    { x: 4, y: 10 }, { x: 14, y: 10 }, RoadType.TWO_LANE, 1e9, 1);
  const rampX = [...Array(20).keys()].find(x => em.get(x, 10, 1)?.isRamp)!;
  rb.buildRoad({ x: rampX, y: 10 }, { x: rampX, y: 14 }, RoadType.TWO_LANE, 1e6);
  return { grid, em, rampX, ...graphOf(grid, em) };
}

describe('斜坡不是出入口', () => {
  it('fixture sanity: the ground under a ramp really can carry a road', () => {
    // 這一整組建立在「地面路畫得到匝道底下」之上。哪天那個方向也被擋掉，
    // 這條會先紅，提醒下面兩條已經測不到東西了。
    const { grid, em, rampX } = rampWithARoadUnderIt();
    expect(em.get(rampX, 10, 1)?.isRamp, '沒有匝道').toBe(true);
    expect(grid.getCell(rampX, 10)?.roadType, '匝道底下沒有地面路').toBeGreaterThan(0);
  });

  it('should not let a building open onto the cell a ramp sits on', () => {
    const { graph, lookup, rampX } = rampWithARoadUnderIt();
    const cells = accessCells(graph, lookup, rampX + 1, 8);
    expect(cells, `車會出現在匝道裡（${rampX},10）`).not.toContain(`${rampX},10`);
  });

  it('should still offer the plain street next door', () => {
    // 反向對照:上一條可以靠「這棟房子根本沒有出口」滿足。
    const { graph, lookup, rampX } = rampWithARoadUnderIt();
    expect(accessCells(graph, lookup, rampX + 1, 8), '整棟房子都沒有出口了')
      .toContain(`${rampX - 1},10`);
  });
});

/** 十字路口 @ (5,5)，四個方向都是普通街道。 */
function crossroads() {
  const grid = new Grid(20, 20);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 2, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 1e6);
  rb.buildRoad({ x: 5, y: 2 }, { x: 5, y: 8 }, RoadType.TWO_LANE, 1e6);
  return graphOf(grid);
}

describe('路口不是出入口', () => {
  it('fixture sanity: (5,5) really is a junction', () => {
    const { lookup } = crossroads();
    expect(isIntersectionCell(lookup.getCellByKey('5,5')!.roadFlags), '(5,5) 不是路口').toBe(true);
  });

  it('should not let a building open onto the middle of a junction', () => {
    // 沒有人的車庫開在十字路口正中央。
    const { graph, lookup } = crossroads();
    expect(accessCells(graph, lookup, 6, 6), '車從路口正中央出現').not.toContain('5,5');
  });

  it('should still offer the streets around it', () => {
    // 反向對照。路口旁邊的房子照樣要有車 —— 它從隔壁那一段街道上路。
    const { graph, lookup } = crossroads();
    const cells = accessCells(graph, lookup, 6, 6);
    expect(cells, '路口旁邊的房子完全沒有出口了').toContain('6,5');
    expect(cells).toContain('5,6');
  });
});

