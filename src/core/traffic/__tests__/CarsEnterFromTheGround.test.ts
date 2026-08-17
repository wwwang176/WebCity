import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType, RoadDirection } from '../../road/types';
import { RailType } from '../../rail/types';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph } from '../LaneGraph';
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
