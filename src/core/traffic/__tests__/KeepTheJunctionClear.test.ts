import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../TrafficSimulation';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph, isIntersectionCell, type LaneEdge } from '../LaneGraph';
import { EdgeVehicleIndex, type EdgeVehicleView } from '../EdgeVehicleIndex';

/**
 * A shell for fixtures: keeps a `Map`-shaped API while building a real `EdgeVehicleIndex`
 * underneath.
 *
 * Production goes through `begin()` / `add()` / `finish()` (rebuilt per frame, no allocation).
 * This wrapper lets assertions talk about who is on an edge rather than about index
 * arithmetic.
 */
class TestIndex extends EdgeVehicleIndex {
  private started = false;
  constructor(init?: Array<[string, EdgeVehicleView[]]>) {
    super();
    if (init) for (const [k, v] of init) this.set(k, v);
  }
  set(edgeId: string, entries: EdgeVehicleView[]): void {
    if (!this.started) { this.begin(); this.started = true; }
    for (const e of entries) this.add(edgeId, e.vid, e.progress, e.halfLen, e.queueing);
  }
}

import { STOP_LINE_OFFSET, findBlockedJunctionDistance } from '../VehicleLookahead';

/**
 * Do not leave a vehicle stopped inside a junction.
 *
 * Car-following only asks where the vehicle ahead's rear is, so when that vehicle stops just
 * past the junction its follower creeps right up and stops in the middle of the box. The next
 * green hands the cross direction a junction with a stationary vehicle in it and the whole
 * crossroads locks up.
 *
 * The right question is **can I get out before entering**: the vehicle's centre must be able
 * to clear the far side, otherwise it waits at the stop line.
 *
 * The centre rather than the rear leaves deliberate slack: real drivers nose in, and the
 * traffic looks far smoother. The cost is bounded — at most half a body stays inside (0.11
 * cells, about 1.3 metres, a tenth of the junction's width).
 */

const J = 10;   // index of the junction edge within edgePath
const RED_AT = 13;

/** A straight lane path of unit-length edges, with edge `junctionAt` marked as a junction. */
function path(n: number, junctionAt = -1): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}`,
      from: {
        id: `e${i}_f`, cellKey: `${i},0`, position: { x: i, y: 0 },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0,
      type: 'straight',
      ...(i === junctionAt ? { insideJunction: true } : {}),
    });
  }
  return edges;
}

/** How far the centre has travelled. Edges are unit length, so index + progress. */
function centre(v: { edgeIndex: number; edgeProgress: number }): number {
  return v.edgeIndex + v.edgeProgress;
}

/** Whether the body overlaps the span [from, to]. */
function overlaps(v: { edgeIndex: number; edgeProgress: number; length: number }, from: number, to: number): boolean {
  const c = centre(v);
  return c + v.length / 2 > from && c - v.length / 2 < to;
}

/** Queues a line of vehicles up behind the red light at `RED_AT`, returning the simulation and
 *  the queue. */
function gridlock(junctionAt: number) {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 20; i++) {
    const v = sim.addVehicleOnEdges(path(40, junctionAt));
    // Queueing means not moving, so do not let the stall detector despawn them.
    v.stallTime = -1e6;
    v.speedMultiplier = 1;
    cars.push(v);
  }
  const red = (_from: string, next: string) => next !== `${RED_AT},0`;
  for (let t = 0; t < 60 / 0.02; t++) sim.advanceEdgeVehicles(0.02, red);
  return { sim, cars, red };
}

describe('路口要淨空', () => {
  it('should let at most a nose into the junction when the queue beyond is full', () => {
    // Entry is allowed when the **centre** can clear the exit, so at most half a body stays
    // inside. This is a bound, not an average: a whole vehicle inside the junction (centre not
    // past the exit) is caught.
    const { cars } = gridlock(J);
    for (const v of cars) {
      if (!overlaps(v, J, J + 1)) continue;
      expect(centre(v), `一台車的中心停在路口裡（${centre(v).toFixed(2)}）`)
        .toBeGreaterThanOrEqual(J + 1 - 1e-6);
    }
  });

  it('should still pack the queue tight where there is no junction', () => {
    // The control for the test above, which "every vehicle stops a cell early" would also
    // satisfy while doubling queue lengths everywhere. Where there is no junction, vehicles
    // must still stop right behind the one ahead.
    const { cars } = gridlock(-1);
    const stopped = cars.filter(v => v.edgeIndex < RED_AT).sort((a, b) => centre(b) - centre(a));
    expect(stopped.length, '沒有車在排隊，這條測不出東西').toBeGreaterThan(3);
    for (let i = 1; i < stopped.length; i++) {
      const front = stopped[i - 1]!, back = stopped[i]!;
      const bumperGap = centre(front) - centre(back) - front.length / 2 - back.length / 2;
      expect(bumperGap, `第 ${i} 台跟前車差了 ${bumperGap.toFixed(3)}`)
        .toBeLessThan(TRAFFIC.MIN_GAP + 0.05);
    }
  });

  it('should wait exactly at the stop line, not tailgate up to the box', () => {
    // The head of the queue stops at the stop line, the same line a red light uses.
    //
    // Asserting only that the nose is outside the junction is not enough: stopping right
    // behind the vehicle ahead also leaves the head 0.19 short (the leader's half-body plus
    // MIN_GAP) and would pass. The real difference is that it keeps **the whole junction**
    // clear, so the line itself is what must be pinned.
    const { cars } = gridlock(J);
    const waiting = cars.filter(v => centre(v) + v.length / 2 <= J).sort((a, b) => centre(b) - centre(a));
    expect(waiting.length, '路口前面沒有車在等，這條測不出東西').toBeGreaterThan(0);
    const nose = centre(waiting[0]!) + waiting[0]!.length / 2;
    expect(J - nose, `排頭的車頭離路口 ${(J - nose).toFixed(3)}`)
      .toBeCloseTo(STOP_LINE_OFFSET, 2);
  });

  it('should drive straight through a junction that is clear', () => {
    // The control against "just never enter a junction".
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(path(20, J));
    v.speedMultiplier = 1;
    for (let t = 0; t < 30 / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
    expect(sim.getVehicleCount(), '路口清空的時候車卻卡住沒過去').toBe(0);
  });

  it('should release the queue once the far side clears', () => {
    // A vehicle held at the stop line must move off once the far side clears, not deadlock.
    const { sim, cars } = gridlock(J);
    const before = cars.filter(v => centre(v) > J).length;
    for (let t = 0; t < 30 / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
    expect(cars.filter(v => centre(v) > J).length, '綠燈之後車隊沒有前進')
      .toBeGreaterThan(before);
  });
});

describe('進去之前的那一問', () => {
  // The queue tests can measure whether anyone stopped inside a junction, but not by how many
  // centimetres: the decision boundary is one body length wide and is masked by the queue
  // spacing. These feed the numbers in directly.
  const CAR = { id: 1, length: 0.22, edgeIndex: 0, edgeProgress: 0 };
  const ROUTE = path(6, 1);   // edge 1 is the junction, so the centre's span across it is [1, 2]
  const ENTER = 1, EXIT = 2, HALF = CAR.length / 2;
  const MIN_GAP = TRAFFIC.MIN_GAP;

  /**
   * Places a vehicle `d` **ahead of** the centre and asks whether this vehicle may enter the
   * junction.
   *
   * The position is relative to `car`: measured from the path start, the "already inside the
   * junction" case would put the blocker behind the vehicle, the scan would find nobody, and
   * the check would be vacuous.
   */
  function ask(d: number, queueing: boolean, route = ROUTE, car = CAR): number {
    const at = car.edgeIndex + car.edgeProgress + d;   // unit-length edges, so index is distance
    const ei = Math.floor(at);
    const index = new TestIndex([
      [route[ei]!.id, [{ vid: 2, progress: at - ei, halfLen: HALF, queueing }]],
    ]);
    return findBlockedJunctionDistance(car, route, index, d - HALF * 2, MIN_GAP);
  }

  /** How far ahead the blocking vehicle must sit for this centre to be able to reach `r`. */
  const distFor = (r: number) => r + HALF * 2 + MIN_GAP;

  // The boundary is pinned at `exit` and closer than half a body: with the rule written as
  // `exit +- halfLen`, a larger offset gives the same answer and tests nothing.
  const NEAR = 0.05;   // < HALF

  it('should let the car in when its midpoint can clear the junction', () => {
    expect(ask(distFor(EXIT + NEAR), true)).toBe(Infinity);
  });

  it('should keep it out when it cannot even get its midpoint across', () => {
    // A centre that cannot clear means the whole vehicle is stuck in the junction.
    expect(ask(distFor(EXIT - NEAR), true)).toBeCloseTo(ENTER - HALF - STOP_LINE_OFFSET, 9);
  });

  it('should ignore a car that is still moving', () => {
    // The rule's biggest flaw without this: `findGapAhead` does not distinguish queueing from
    // moving, so any vehicle within two cells blocks — and two cells is a normal following
    // distance.
    expect(ask(distFor(EXIT - NEAR), false), '被一台還在開的車擋住了').toBe(Infinity);
  });

  it('should never brake a car that is already inside the box', () => {
    // Once inside there is nothing to do but drive out. Braking inside is exactly what this
    // rule exists to prevent.
    expect(ask(distFor(0.2), true, ROUTE, { ...CAR, edgeIndex: 1, edgeProgress: 0.5 })).toBe(Infinity);
  });

  it('should not look at all when the road ahead is empty', () => {
    // Free-flowing traffic is the overwhelming majority and must return on the first line,
    // which is why this rule costs nothing.
    const empty = new TestIndex();
    expect(findBlockedJunctionDistance(CAR, ROUTE, empty, Infinity, MIN_GAP)).toBe(Infinity);
    expect(ask(distFor(0.5), true, path(6, -1))).toBe(Infinity);
  });
});


/** A route with a junction every `every` edges. */
function pathEvery(n: number, every: number): LaneEdge[] {
  const edges = path(n, -1);
  if (every > 0) for (let i = every; i < n; i += every) edges[i]!.insideJunction = true;
  return edges;
}

/** Total distance covered by a stream of constant-speed vehicles after `seconds`. */
function distanceCovered(every: number, seconds: number): number {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 24; i++) {
    const v = sim.addVehicleOnEdges(pathEvery(200, every));
    // addVehicleOnEdges picks a random body type and speed multiplier; this needs a
    // reproducible stream.
    v.length = 0.22; v.width = 0.09;
    v.speedMultiplier = 1;
    v.stallTime = 0;
    v.edgeIndex = i * 2;
    cars.push(v);
  }
  for (let t = 0; t < seconds / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
  return cars.reduce((sum, v) => sum + v.edgeIndex + v.edgeProgress, 0);
}

describe('路口不該拖慢正常車流', () => {
  it('should not cost a moving stream any distance at all', () => {
    // A two-cell following distance is **normal**, not congestion. A rule that does not
    // distinguish stopped from moving brakes this stream at every junction, which is mostly
    // what "even right-turning vehicles wait at the stop line" looked like.
    const withJunctions = distanceCovered(4, 20);
    const plain = distanceCovered(0, 20);
    expect(withJunctions / plain, `有路口跑了 ${withJunctions.toFixed(1)}，沒路口 ${plain.toFixed(1)}`)
      .toBeGreaterThan(0.99);
  });

  it('fixture sanity: the stream really does pass junctions, packed close', () => {
    // The test above would be vacuous with a following distance so large the rule never fires,
    // or with no junctions on the route at all.
    const route = pathEvery(200, 4);
    expect(route.filter(e => e.insideJunction).length, '路線上沒有路口').toBeGreaterThan(10);
    // A two-cell gap, below the clearance the stricter rule demands (exit plus half a body,
    // about 2.1 cells).
    expect(2 - 0.22, '車距大到原本的規則也不會觸發，這條測不出東西').toBeLessThan(2.11);
  });
});

/**
 * A map containing a crossroads, a T junction, an L bend, straight road and a six-lane road.
 *
 * The six-lane road exists to produce `lane_change` edges, which are another way of traversing
 * a junction: unmarked, a vehicle can stop inside one by changing lanes.
 */
function mixedCity() {
  const grid = new Grid(24, 24);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 2, y: 5 }, { x: 14, y: 5 }, RoadType.TWO_LANE, 1e6);   // main street
  rb.buildRoad({ x: 5, y: 2 }, { x: 5, y: 9 }, RoadType.TWO_LANE, 1e6);    // crossroads at 5,5
  rb.buildRoad({ x: 9, y: 5 }, { x: 9, y: 9 }, RoadType.TWO_LANE, 1e6);    // T junction at 9,5
  rb.buildRoad({ x: 14, y: 5 }, { x: 14, y: 9 }, RoadType.TWO_LANE, 1e6);  // L bend at 14,5
  rb.buildRoad({ x: 2, y: 15 }, { x: 12, y: 15 }, RoadType.SIX_LANE, 1e6);
  rb.buildRoad({ x: 7, y: 12 }, { x: 7, y: 18 }, RoadType.SIX_LANE, 1e6);  // six-lane crossroads at 7,15

  const lookup = UnifiedRoadLookup.fromGrid(grid);
  const graph = new LaneGraph();
  graph.buildFromGrid(lookup, lookup.getAllCellKeys());
  return { graph, lookup };
}

/** Whether this edge stays within one cell, returning that cell if so. */
function stayInsideCell(e: LaneEdge): string | null {
  if (e.viaCellKey) return e.viaCellKey;
  return e.from.cellKey === e.to.cellKey ? e.from.cellKey : null;
}

describe('哪一段算在路口裡', () => {
  it('should mark exactly the edges that traverse a 3+ way cell', () => {
    // A full characterisation rather than a sample: every edge is checked. Checking only which
    // cells got marked is not enough — a crossroads carries within-cell, cross-intersection
    // turn and lane_change edges at once, and missing one of them leaves the set of marked
    // cells identical.
    const { graph, lookup } = mixedCity();
    for (const e of graph.getAllEdges()) {
      const owner = stayInsideCell(e);
      const cell = owner ? lookup.getCellByKey(owner) : null;
      const expected = cell !== null && isIntersectionCell(cell.roadFlags);
      expect(!!e.insideJunction, `${e.type} ${e.id}`).toBe(expected);
    }
  });

  it('fixture sanity: really has all four kinds of edge to classify', () => {
    // The test above would be vacuous with no junctions on the map, or no lane-change edges.
    const { graph } = mixedCity();
    const marked = graph.getAllEdges().filter(e => e.insideJunction);
    const counts = (list: LaneEdge[]) => new Set(list.map(e => e.type));
    expect(counts(marked), '路口裡少了某一種邊').toEqual(new Set(['straight', 'turn', 'lane_change']));
    expect(graph.getAllEdges().some(e => !e.insideJunction), '整張圖都是路口').toBe(true);
  });

  it('should not mark an L bend', () => {
    // A bend also changes direction, but with only two directions there is no cross traffic to
    // block, so queueing there is fine.
    const { graph } = mixedCity();
    const bend = graph.getAllEdges().filter(e => stayInsideCell(e) === '14,5');
    expect(bend.length, '(14,5) 那個彎沒有任何邊，這條測不出東西').toBeGreaterThan(0);
    expect(bend.filter(e => e.insideJunction), '轉角被當成路口了').toEqual([]);
  });
});
