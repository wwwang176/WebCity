import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType, RoadDirection, getLaneCount } from '../../road/types';
import { RailType } from '../../rail/types';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ElevatedRoadBuilder } from '../../elevation/ElevatedRoadBuilder';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph, isIntersectionCell } from '../LaneGraph';
import { findLanePath, findBuildingAccessPoints } from '../LaneGraphPathfinder';
import { parseLevelFromKey } from '../../grid/GridHelpers';

/**
 * A building's driveway opens onto the ground.
 *
 * An elevated road has no access points: there is no link between the deck and the ground
 * below it, and the only way up or down is a ramp. But a building looks for nearby roads with
 * `getAllKeysAtPosition`, which returns **every level**, so a house beside an elevated road
 * attaches directly to a lane point on the deck and its vehicles fly off the roof onto the
 * bridge.
 *
 * What is pinned here is that origins and destinations can only be on the ground. The bridge
 * must still be usable; the difference is that vehicles reach it from the ground, via a ramp.
 */

const EAST = RoadDirection.EAST;
const WEST = RoadDirection.WEST;

/**
 * Two ground streets with a seven-cell gap between them, spanned only by an elevated bridge
 * with a ramp at each end.
 *
 *   y=3  ground   x=1..3          gap x=4..10          ground x=11..13
 *   y=3  level 1  x=3 (ramp)  x=4..10  x=11 (ramp)
 *
 * One house at each of three positions:
 *   (2,2)  reaches both the ground and the ramp — vehicles must start on the ground
 *   (7,2)  reaches only the deck              — must have no vehicles
 *   (12,2) reaches only the ground            — the destination
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
    // Within two cells of (7,2) there is only the deck. Without the rule this returns a
    // complete route and a vehicle sets off in mid-air on the first floor.
    const { graph, lookup } = bridgedCity();
    expect(findLanePath(graph, lookup, HOUSE_UNDER_THE_BRIDGE, SHOP_ACROSS_THE_GAP))
      .toBeNull();
  });

  it('should still let a car reach the far side over the bridge', () => {
    // The control for the test above, which "never allow elevated roads at all" would also
    // satisfy, turning the bridge into decoration.
    const { graph, lookup } = bridgedCity();
    const path = findLanePath(graph, lookup, HOUSE_ON_THE_GROUND, SHOP_ACROSS_THE_GAP);
    expect(path, '地面的房子連對岸都到不了 —— 橋被整個封死了').not.toBeNull();
    const levels = path!.map(e => parseLevelFromKey(e.to.cellKey));
    expect(Math.max(...levels), '這條路根本沒上橋，測不出東西').toBe(1);
  });

  it('should start that car on the ground, not on the ramp deck', () => {
    // (2,2) reaches both the ground cells (1..3,3) and the ramp at (3,3,1). Multi-origin A*
    // picks by cost, and the ramp origin is closer to the destination, so it wins and the
    // vehicle appears on the ramp.
    const { graph, lookup } = bridgedCity();
    const path = findLanePath(graph, lookup, HOUSE_ON_THE_GROUND, SHOP_ACROSS_THE_GAP)!;
    expect(parseLevelFromKey(path[0]!.from.cellKey), '車從高架上出發').toBe(0);
  });

  it('should offer only ground cells as a building`s way onto the road', () => {
    // Tests the shared function directly: the main thread's findLanePath and the worker's
    // collectPointIndices both go through it, and the rule exists only there.
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
 * Which cells a house can drive onto within two cells.
 *
 * The shared observation point for three rules: elevated roads do not count (BUG-312), ramps
 * do not count, junctions do not count.
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
 * The ground cell beneath a ramp.
 *
 * `RAMP_OVER_ROAD` prevents building a ramp over an existing ground road, but **nothing
 * prevents the reverse**: build the ramp first and then draw a ground road underneath it. That
 * cell then carries both a ground road and a slope climbing to the first floor, and a house
 * attaches to it.
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
    // This whole group rests on a ground road being drawable under a ramp. If that direction is
    // ever blocked too, this turns red first and signals that the two tests below have stopped
    // testing anything.
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
    // The control: the test above would also be satisfied by the house having no exit at all.
    const { graph, lookup, rampX } = rampWithARoadUnderIt();
    expect(accessCells(graph, lookup, rampX + 1, 8), '整棟房子都沒有出口了')
      .toContain(`${rampX - 1},10`);
  });
});

/** A crossroads at (5,5) with an ordinary street in each of the four directions. */
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
    // Nobody's driveway opens onto the middle of a crossroads.
    const { graph, lookup } = crossroads();
    expect(accessCells(graph, lookup, 6, 6), '車從路口正中央出現').not.toContain('5,5');
  });

  it('should still offer the streets around it', () => {
    // The control: a house beside a junction must still have vehicles, entering from the
    // street segment next to it.
    const { graph, lookup } = crossroads();
    const cells = accessCells(graph, lookup, 6, 6);
    expect(cells, '路口旁邊的房子完全沒有出口了').toContain('6,5');
    expect(cells).toContain('5,6');
  });
});
/** A straight multi-lane street, plus a perpendicular one so routes include a turn. */
function twoLaneEachWay(type = RoadType.FOUR_LANE) {
  const grid = new Grid(30, 20);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 2, y: 8 }, { x: 26, y: 8 }, type, 1e9);
  return { grid, lanes: getLaneCount(type), ...graphOf(grid) };
}

describe('車從靠建築那一側上路', () => {
  it('should offer only the outermost lane of each cell', () => {
    // A driveway opens onto the kerb, so a vehicle emerges into the outermost lane and cannot
    // appear in an inner one. Lanes are numbered rightwards from the direction of travel, so
    // the outermost is the highest-numbered.
    const { graph, lookup, lanes } = twoLaneEachWay();
    for (const type of ['entry', 'exit'] as const) {
      const pts = findBuildingAccessPoints(graph, 10, 6, lookup, type);
      expect(pts.length, `${type} 一個都沒有，這條測不出東西`).toBeGreaterThan(0);
      for (const p of pts) {
        expect(p.lane, `${type} 掛到了內線 ${p.cellKey} lane ${p.lane}`).toBe(lanes - 1);
      }
    }
  });

  it('fixture sanity: the road really has more than one lane each way', () => {
    // On a single-lane road the outermost is the only one, and the test above is vacuous.
    expect(twoLaneEachWay().lanes).toBeGreaterThan(1);
  });

  it('should start and end a whole trip on the outermost lane', () => {
    // End to end. The middle may use any lane; this pins only the two ends.
    const { graph, lookup, lanes } = twoLaneEachWay();
    const path = findLanePath(graph, lookup, { x: 5, y: 6 }, { x: 23, y: 6 });
    expect(path, '找不到路線').not.toBeNull();
    expect(path![0]!.from.lane, '車從內線出發').toBe(lanes - 1);
    expect(path![path!.length - 1]!.to.lane, '車停在內線').toBe(lanes - 1);
  });

  it('should still leave one-lane roads alone', () => {
    // The control: on a single-lane road the outermost is lane 0, which must not leave it with
    // no access points.
    const { graph, lookup, lanes } = twoLaneEachWay(RoadType.TWO_LANE);
    expect(lanes).toBe(1);
    const pts = findBuildingAccessPoints(graph, 10, 6, lookup, 'exit');
    expect(pts.length, '單車道的路變得沒有出入口了').toBeGreaterThan(0);
    for (const p of pts) expect(p.lane).toBe(0);
  });
});

