import { describe, it, expect } from 'vitest';
import { LaneGraph, type LaneEdge, turnLanePenalty, idealTurnLane, isIntersectionCell } from '../LaneGraph';
import { findLanePath } from '../LaneGraphPathfinder';
import { Grid } from '../../grid/Grid';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { RoadNetwork } from '../../road/RoadNetwork';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType, getLaneCount } from '../../road/types';
import { LANE_CHANGE_COST } from '../Pathfinding';

/**
 * Every lane carries a turn edge, and they all cost exactly the same, so A*
 * turned from whichever lane the vehicle already occupied — moving over costs
 * LANE_CHANGE_COST (0.15) and turning where you stand cost nothing extra.
 *
 * Measured on a four-lane crossing: a right turn taken from the INNER lane
 * passes within 0.0048 of the outer lane's through path, against 0.1908 when
 * taken from the correct lane. Cars are 0.09 wide, so the bodies overlap
 * completely — and `findCrossEdgeGap` only compares vehicles that share a
 * destination point (`other.toId !== me.toId` is skipped), so the two never
 * see each other. Both come from the same approach, so one green light
 * releases them together and no signal separates them. (BUG-214)
 *
 * The preference is deliberately SOFT: a penalty proportional to how far the
 * lane is from the right one, not a missing edge. Removing the wrong-lane turn
 * edges would leave a six-lane road with no route at all when the junction is
 * fewer cells away than the lane changes need — lane changes advance one lane
 * per cell.
 */

/** Widest car body in TrafficSimulation's dimension table. */
const CAR_WIDTH = 0.09;

interface Pos { x: number; y: number }
interface Road { from: Pos; to: Pos }

function cityWith(type: RoadType, roads: Road[]) {
  const grid = new Grid(24, 24);
  const net = new RoadNetwork();
  const builder = new RoadBuilder(grid, net);
  for (const r of roads) builder.buildRoad(r.from, r.to, type, 1e9);

  const lookup = UnifiedRoadLookup.fromGrid(grid);
  const graph = new LaneGraph();
  graph.buildFromGrid(lookup as never, lookup.getAllCellKeys());
  return { grid, lookup, graph, lanes: getLaneCount(type) };
}

/**
 * A full four-way crossing at (5,5): both arms carry on past the junction, so
 * traffic going straight through exists to be cut across.
 *
 * Southbound → westbound is a RIGHT turn, southbound → eastbound a LEFT one.
 *
 * Every case below uses a real junction. An L-bend has no through traffic —
 * every lane rounds the bend concentrically and no two paths cross — so the
 * preference does not apply there at all (see the bend group below).
 */
const CROSSROADS_CITY: Road[] = [
  { from: { x: 5, y: 0 }, to: { x: 5, y: 10 } },
  { from: { x: 0, y: 5 }, to: { x: 10, y: 5 } },
];

/** Two four-way crossings: south, left (east) at (5,5), right (south) at (10,5). */
const TWO_JUNCTION_CITY: Road[] = [
  { from: { x: 5, y: 0 }, to: { x: 5, y: 10 } },
  { from: { x: 0, y: 5 }, to: { x: 15, y: 5 } },
  { from: { x: 10, y: 0 }, to: { x: 10, y: 10 } },
];

/** A staircase of plain bends — no junction anywhere on it. */
const STAIRCASE_CITY: Road[] = [
  { from: { x: 2, y: 4 }, to: { x: 8, y: 4 } },
  { from: { x: 8, y: 4 }, to: { x: 8, y: 8 } },
  { from: { x: 8, y: 8 }, to: { x: 14, y: 8 } },
  { from: { x: 14, y: 8 }, to: { x: 14, y: 12 } },
  { from: { x: 14, y: 12 }, to: { x: 20, y: 12 } },
];

/** A dead straight road, as long as the staircase's total run. */
const STRAIGHT_CITY: Road[] = [
  { from: { x: 2, y: 4 }, to: { x: 22, y: 4 } },
];

/** A single L-bend, nothing else. */
const BEND_CITY: Road[] = [
  { from: { x: 5, y: 0 }, to: { x: 5, y: 5 } },
  { from: { x: 0, y: 5 }, to: { x: 5, y: 5 } },
];

/** Sample an edge's path — quadratic Bézier when it has a control point, else a segment. */
function samples(e: LaneEdge, n = 60): Array<{ x: number; y: number }> {
  const p0 = e.from.position, p2 = e.to.position;
  const cp = e.bezierControl?.[0];
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (cp) {
      const u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * cp.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * cp.y + t * t * p2.y,
      });
    } else {
      out.push({ x: p0.x + (p2.x - p0.x) * t, y: p0.y + (p2.y - p0.y) * t });
    }
  }
  return out;
}

function minDistance(a: LaneEdge, b: LaneEdge): number {
  let m = Infinity;
  for (const p of samples(a)) {
    for (const q of samples(b)) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < m) m = d;
    }
  }
  return m;
}

/** Every edge that changes the direction of travel, whatever its `type`. */
function turningEdges(path: LaneEdge[]): LaneEdge[] {
  return path.filter(e => idealTurnLane(e, 2) !== null);
}

describe('a turn is taken from the lane it belongs in', () => {
  it('should make a right turn from the outermost lane, not the one it is in', () => {
    const { graph, lookup, lanes } = cityWith(RoadType.FOUR_LANE, CROSSROADS_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 0 }, { x: 0, y: 5 });
    expect(path, 'no lane path was found at all').not.toBeNull();

    const turns = turningEdges(path!);
    expect(turns, 'the trip should contain exactly one turn').toHaveLength(1);
    expect(turns[0]!.from.lane, 'the right turn was taken from an inner lane')
      .toBe(lanes - 1);
  });

  it('should make a left turn from the innermost lane', () => {
    const { graph, lookup } = cityWith(RoadType.FOUR_LANE, CROSSROADS_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 0 }, { x: 10, y: 5 });
    expect(path).not.toBeNull();

    const turns = turningEdges(path!);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.from.lane, 'the left turn was taken from an outer lane').toBe(0);
  });

  it('should move back across for the second turn when the two disagree', () => {
    // Left then right: the vehicle finishes the left turn in an inner lane and
    // has to move out again. Before the preference existed it simply stayed
    // put and took the right turn from the inner lane.
    const { graph, lookup, lanes } = cityWith(RoadType.FOUR_LANE, TWO_JUNCTION_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 0 }, { x: 10, y: 10 });
    expect(path).not.toBeNull();

    const turns = turningEdges(path!);
    expect(turns, 'the trip should contain two turns').toHaveLength(2);
    expect(turns[0]!.from.lane, 'first turn (left) came from an outer lane').toBe(0);
    expect(turns[1]!.from.lane, 'second turn (right) came from an inner lane')
      .toBe(lanes - 1);
  });
});

describe('the turn no longer cuts across the parallel through lane', () => {
  it('should clear a car body from the through path it used to overlap', () => {
    const { graph, lookup } = cityWith(RoadType.FOUR_LANE, CROSSROADS_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 0 }, { x: 0, y: 5 });
    const turn = turningEdges(path!)[0]!;

    // The southbound through path in the OTHER lane of the same approach —
    // a vehicle carrying straight on beside the one that is turning.
    const through = graph.getAllEdges().find(e =>
      e.type === 'straight'
      && e.from.cellKey === '5,5' && e.to.cellKey === '5,5'
      && e.from.direction === 'north' && e.to.direction === 'south'
      && e.from.lane !== turn.from.lane);
    expect(through, 'fixture found no parallel through edge to conflict with')
      .toBeDefined();

    // findCrossEdgeGap skips these two (different toId), so nothing else will
    // stop them occupying the same ground.
    expect(minDistance(turn, through!),
      'the turning car still drives through the car going straight beside it')
      .toBeGreaterThan(CAR_WIDTH);
  });
});

describe('the preference is a preference, not a rule', () => {
  it('should still route when there is no room to reach the right lane', () => {
    // Six lanes each way and the junction one cell from the origin: reaching
    // the outermost lane needs two changes and there is room for none.
    const { graph, lookup } = cityWith(RoadType.SIX_LANE, CROSSROADS_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 4 }, { x: 0, y: 5 });
    expect(path, 'a vehicle with no room to move over was left with no route')
      .not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  it('should leave one-lane-per-direction roads completely alone', () => {
    const { graph, lookup } = cityWith(RoadType.TWO_LANE, CROSSROADS_CITY);
    const path = findLanePath(graph, lookup, { x: 5, y: 0 }, { x: 0, y: 5 });
    expect(path).not.toBeNull();
    expect(path!.every(e => e.from.lane === 0 && e.to.lane === 0),
      'a single-lane road grew a lane preference').toBe(true);
    expect(path!.filter(e => e.type === 'lane_change'),
      'a single-lane road cannot change lane at all').toHaveLength(0);
  });
});

describe('只有路口才需要站位', () => {
  /**
   * The reason for turn lanes is that a turning arc cuts across the through lane beside it. A
   * bend has no through lane: a two-direction cell only produces turn edges, and the generator
   * connects lane L to lane L, so the arcs are concentric and never intersect. The rule buys
   * nothing there and costs a lane change.
   *
   * Deciding the ideal lane from the cross product of the in and out directions alone, without
   * looking at how many directions the cell has, makes every right bend on an S-shaped road
   * demand a move out and back — two lane changes per bend.
   */
  it('should charge nothing at a plain bend, whatever lane the car is in', () => {
    const { graph } = cityWith(RoadType.FOUR_LANE, BEND_CITY);
    const bends = graph.getAllEdges().filter(e => idealTurnLane(e, 3) !== null);
    expect(bends.length, '這張圖上沒有彎道，測不出東西').toBeGreaterThan(0);
    for (const e of bends) {
      for (let lane = 0; lane < 3; lane++) {
        expect(turnLanePenalty({ ...e, from: { ...e.from, lane } }, 3),
          `彎道對 lane ${lane} 收了錢`).toBe(0);
      }
    }
  });

  it('fixture sanity: the bend really is a bend and the crossroads really a junction', () => {
    // If both fixtures classify the same way, either the test above or the ones below are
    // vacuous.
    const bend = cityWith(RoadType.FOUR_LANE, BEND_CITY);
    const cross = cityWith(RoadType.FOUR_LANE, CROSSROADS_CITY);
    expect(isIntersectionCell(bend.lookup.getCellByKey('5,5')!.roadFlags), '彎道被當成路口')
      .toBe(false);
    expect(isIntersectionCell(cross.lookup.getCellByKey('5,5')!.roadFlags), '十字沒被當成路口')
      .toBe(true);
  });

  it('should need no more lane changes than a dead straight road', () => {
    // On a multi-lane S-shaped road a vehicle moved out before every right bend and back
    // afterwards: 5 lane changes measured.
    //
    // Asserting 0 or 1 outright will not do. Origin and destination are pinned to the outer
    // lane beside a building while LANE_SPEED_DECAY still makes inner lanes 5% cheaper, so
    // "move in on departure, move back out before arrival" is outside this rule's scope.
    //
    // Comparing against an equally long straight road cancels those two on both sides, so the
    // remaining difference **can only come from the bends**.
    const changesOn = (roads: Road[], from: Pos, to: Pos) => {
      const { graph, lookup } = cityWith(RoadType.FOUR_LANE, roads);
      const path = findLanePath(graph, lookup, from, to);
      expect(path, '找不到路線').not.toBeNull();
      return path!.filter(e => e.type === 'lane_change').length;
    };
    const bendy = changesOn(STAIRCASE_CITY, { x: 3, y: 2 }, { x: 19, y: 14 });
    const straight = changesOn(STRAIGHT_CITY, { x: 3, y: 2 }, { x: 21, y: 6 });
    expect(bendy, `階梯路換了 ${bendy} 次，同樣長的直路只要 ${straight} 次`)
      .toBeLessThanOrEqual(straight);
  });
});

describe('the penalty itself', () => {
  const { graph } = cityWith(RoadType.FOUR_LANE, CROSSROADS_CITY);
  const turns = graph.getAllEdges().filter(e => e.insideJunction && idealTurnLane(e, 2) !== null);

  it('should charge nothing on a road with one lane each way', () => {
    for (const e of turns) expect(turnLanePenalty(e, 1)).toBe(0);
  });

  it('should charge nothing at the ideal lane and more the further away', () => {
    for (const e of turns) {
      const ideal = idealTurnLane(e, 3)!;
      expect(turnLanePenalty({ ...e, from: { ...e.from, lane: ideal } }, 3)).toBe(0);

      const one = turnLanePenalty({ ...e, from: { ...e.from, lane: Math.abs(ideal - 1) } }, 3);
      const two = turnLanePenalty({ ...e, from: { ...e.from, lane: Math.abs(ideal - 2) } }, 3);
      expect(one).toBeGreaterThan(0);
      expect(two).toBeGreaterThan(one);
    }
  });

  it('should cost more than moving over and back, or nothing would move over', () => {
    // Not one lane change but two: a vehicle that moves over to turn moves back
    // afterwards, because every lane outward is 5% slower to drive. If a lane of
    // deviation cost less than the round trip, staying put would remain the
    // bargain and the preference would do nothing wherever the road runs on.
    const e = turns[0]!;
    const ideal = idealTurnLane(e, 2)!;
    const wrong = turnLanePenalty({ ...e, from: { ...e.from, lane: 1 - ideal } }, 2);
    expect(wrong).toBeGreaterThan(2 * LANE_CHANGE_COST);
  });

  it('should charge nothing for carrying straight on', () => {
    const straights = graph.getAllEdges().filter(e => e.type === 'straight');
    expect(straights.length).toBeGreaterThan(0);
    for (const e of straights) expect(turnLanePenalty(e, 3)).toBe(0);
  });
});
