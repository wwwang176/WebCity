import { describe, it, expect } from 'vitest';
import { PooledAStar } from '../PooledAStar';
import { LaneGraphBuffer } from '../LaneGraphBuffer';
import { LaneGraph } from '../LaneGraph';
import { RoadType, RoadDirection, getLaneCount } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';
import { idealTurnLaneInt, NO_PREFERRED_LANE } from '../TurnLane';
import type { GraphReader } from '../LaneGraphBuffer';

/**
 * There are two lane-level A* implementations and the game runs on the second
 * one: SimulationLoop enqueues commute and vehicle routes to the pathfinding
 * worker (Game.ts creates it), which walks the SharedArrayBuffer with
 * PooledAStar. LaneGraphPathfinder.laneAStar only serves the synchronous
 * callers. A rule taught to one and not the other is a rule the player never
 * sees, so the turn-lane preference (BUG-214) has to hold on both.
 *
 * Charging it needs the approach road's width, which the buffer did not carry.
 * It fits in the byte already reserved as padding in the point stride, so the
 * stride and every existing offset are untouched.
 *
 * The lane-change cost has the same problem the other way round: the main
 * thread has charged LANE_CHANGE_COST since it was calibrated, and the worker
 * never has, so the worker still dives to the fast lane and climbs back for a
 * saving it cannot keep (BUG-215). The turn preference is calibrated against
 * that cost, so it is only worth what the worker charges.
 */

type Cells = Map<string, { roadType: number; roadFlags: number }>;

function makeGridLookup(cells: Cells) {
  return {
    getCellByKey(key: string) { return cells.get(key) ?? null; },
    getCompatibleNeighborKeys(_sourceKey: string, nx: number, ny: number): string[] {
      const k = toPosKey(nx, ny);
      return cells.has(k) ? [k] : [];
    },
  };
}

const ALL_DIRS = RoadDirection.NORTH | RoadDirection.SOUTH
  | RoadDirection.EAST | RoadDirection.WEST;

/** A four-way crossing at (5,5), each arm five cells long. */
function crossroads(roadType: RoadType): Cells {
  const cells: Cells = new Map();
  for (let y = 0; y <= 10; y++) cells.set(toPosKey(5, y), { roadType, roadFlags: ALL_DIRS });
  for (let x = 0; x <= 10; x++) cells.set(toPosKey(x, 5), { roadType, roadFlags: ALL_DIRS });
  return cells;
}

/**
 * An L-bend at (5,5): south down x=5, then west along y=5.
 *
 * Two directions, so no through traffic — the preference has nothing to protect
 * and must charge nothing. `crossroads` above gives every cell all four
 * directions, so it cannot show this.
 */
function bend(roadType: RoadType): Cells {
  const cells: Cells = new Map();
  const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
  const EW = RoadDirection.EAST | RoadDirection.WEST;
  for (let y = 0; y < 5; y++) cells.set(toPosKey(5, y), { roadType, roadFlags: NS });
  cells.set(toPosKey(5, 5), { roadType, roadFlags: RoadDirection.NORTH | RoadDirection.WEST });
  for (let x = 0; x < 5; x++) cells.set(toPosKey(x, 5), { roadType, roadFlags: EW });
  return cells;
}

/** A straight east-west road, `length` cells long. */
function straight(roadType: RoadType, length: number): Cells {
  const cells: Cells = new Map();
  const flags = RoadDirection.EAST | RoadDirection.WEST;
  for (let x = 0; x < length; x++) cells.set(toPosKey(x, 0), { roadType, roadFlags: flags });
  return cells;
}

function workerSetup(cells: Cells, roadType: RoadType) {
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);

  const buf = new LaneGraphBuffer(4096, 16384);
  // The live game takes this path whenever a road lookup exists
  // (SimulationLoop.rebuildGraphBuffer); plain writeFromGraph still hardcodes
  // TWO_LANE for speed limits, so it cannot know a road's width either.
  const mapping = buf.writeFromGraphWithLookup(graph, () => roadType);
  return { graph, mapping, reader: buf.createReader(), astar: new PooledAStar(4096) };
}

/**
 * Every edge on the path that changes the direction of travel, whatever its
 * stored type: at a four-way junction A* often takes the turn on a lane-change
 * edge, which turns and moves over at once. Counting `type === turn` alone
 * would miss exactly the manoeuvre in question.
 */
function turnsOn(reader: GraphReader, path: number[]): number[] {
  return path.filter(i => {
    const from = reader.getPoint(reader.getEdgeFromIdx(i));
    const to = reader.getPoint(reader.getEdgeToIdx(i));
    return idealTurnLaneInt(from.dir, from.type, to.dir, to.type, from.laneCount)
      !== NO_PREFERRED_LANE;
  });
}

/** Exit points of a cell restricted to one lane, so the start lane is a fixture. */
function exitsInLane(mapping: { pointIdToIndex: Map<string, number> }, cell: string, lane: number) {
  const out: number[] = [];
  for (const [pointId, idx] of mapping.pointIdToIndex) {
    if (pointId.startsWith(cell + ':') && pointId.endsWith(`:${lane}:exit`)) out.push(idx);
  }
  return out;
}

function endpoints(mapping: { pointIdToIndex: Map<string, number> }, from: string, to: string) {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const [pointId, idx] of mapping.pointIdToIndex) {
    if (pointId.startsWith(from + ':') && pointId.endsWith(':exit')) starts.push(idx);
    if (pointId.startsWith(to + ':') && pointId.endsWith(':entry')) ends.push(idx);
  }
  return { starts, ends };
}

describe('the buffer carries what the rule needs', () => {
  it('should record the width of the road each point sits on', () => {
    const { mapping, reader } = workerSetup(crossroads(RoadType.FOUR_LANE), RoadType.FOUR_LANE);
    const someIdx = [...mapping.pointIdToIndex.values()][0]!;
    expect(reader.getPoint(someIdx).laneCount).toBe(getLaneCount(RoadType.FOUR_LANE));
  });

  it('should record one lane for a road with one lane each way', () => {
    const { mapping, reader } = workerSetup(crossroads(RoadType.TWO_LANE), RoadType.TWO_LANE);
    const someIdx = [...mapping.pointIdToIndex.values()][0]!;
    expect(reader.getPoint(someIdx).laneCount).toBe(1);
  });
});

describe('the worker leaves plain bends alone, like the main thread does', () => {
  it('should carry the junction flag on every edge', () => {
    // 直接守住 buffer 那一格。旗標沒寫進去的話，worker 會以為全世界都是彎道，
    // 連路口都不再站位 —— 而下面那條行為測試看不出差別（它本來就期待不換道）。
    const cross = workerSetup(crossroads(RoadType.FOUR_LANE), RoadType.FOUR_LANE);
    const flat = workerSetup(bend(RoadType.FOUR_LANE), RoadType.FOUR_LANE);
    const anyFlagged = (w: ReturnType<typeof workerSetup>) => {
      for (let i = 0; i < w.reader.getEdgeCount(); i++) {
        if (w.reader.getEdgeInsideJunction(i)) return true;
      }
      return false;
    };
    expect(anyFlagged(cross), '十字路口的邊沒有被標成路口').toBe(true);
    expect(anyFlagged(flat), '彎道的邊被標成路口了').toBe(false);
  });

  it('should not move over for a bend the way it does for a junction', () => {
    // 起始車道要釘死，否則多起點 A* 會直接從理想車道出發，換不換道看不出來。
    const roadType = RoadType.FOUR_LANE;
    const { mapping, reader, astar } = workerSetup(bend(roadType), roadType);
    const starts = exitsInLane(mapping, toPosKey(5, 0), 0);   // 內側出發
    const { ends } = endpoints(mapping, toPosKey(5, 0), toPosKey(0, 5));
    expect(starts.length, '找不到內側車道的起點').toBeGreaterThan(0);

    const path = astar.findPath(reader, starts, ends, { x: 0, y: 5 });
    expect(path, 'the worker found no route at all').not.toBeNull();

    // EDGE_TYPE_TO_INT: 2 = lane_change
    const changes = path!.filter(i => reader.getEdgeType(i) === 2);
    expect(changes, `worker 為了一個彎道換了 ${changes.length} 次道`).toHaveLength(0);
  });
});

describe('the worker turns from the same lane the main thread does', () => {
  it('should take a right turn from the outermost lane', () => {
    const roadType = RoadType.FOUR_LANE;
    const { mapping, reader, astar } = workerSetup(crossroads(roadType), roadType);
    // Southbound down x=5, then west along y=5 — a right turn at (5,5).
    const { starts, ends } = endpoints(mapping, toPosKey(5, 0), toPosKey(0, 5));
    expect(starts.length).toBeGreaterThan(0);
    expect(ends.length).toBeGreaterThan(0);

    const path = astar.findPath(reader, starts, ends, { x: 0, y: 5 });
    expect(path, 'the worker found no route at all').not.toBeNull();

    const turns = turnsOn(reader, path!);
    expect(turns, 'the trip should contain exactly one turn').toHaveLength(1);
    const from = reader.getPoint(reader.getEdgeFromIdx(turns[0]!));
    expect(from.lane, 'the worker took the right turn from an inner lane')
      .toBe(getLaneCount(roadType) - 1);
  });

  it('should take a left turn from the innermost lane', () => {
    const roadType = RoadType.FOUR_LANE;
    const { mapping, reader, astar } = workerSetup(crossroads(roadType), roadType);
    // Southbound down x=5, then east along y=5 — a left turn at (5,5).
    const { starts, ends } = endpoints(mapping, toPosKey(5, 0), toPosKey(10, 5));
    const path = astar.findPath(reader, starts, ends, { x: 10, y: 5 });
    expect(path).not.toBeNull();

    const turns = turnsOn(reader, path!);
    expect(turns).toHaveLength(1);
    const from = reader.getPoint(reader.getEdgeFromIdx(turns[0]!));
    expect(from.lane, 'the worker took the left turn from an outer lane').toBe(0);
  });

  it('should leave one-lane-per-direction roads alone', () => {
    const { mapping, reader, astar } = workerSetup(
      crossroads(RoadType.TWO_LANE), RoadType.TWO_LANE);
    const { starts, ends } = endpoints(mapping, toPosKey(5, 0), toPosKey(0, 5));
    const path = astar.findPath(reader, starts, ends, { x: 0, y: 5 });
    expect(path).not.toBeNull();
    for (const i of path!) {
      expect(reader.getPoint(reader.getEdgeFromIdx(i)).lane).toBe(0);
    }
  });
});

describe('the worker charges for changing lane, as the main thread does', () => {
  it('should not dive to the fast lane on a road too short to repay it', () => {
    // The case LANE_CHANGE_COST was calibrated on: three cells of four-lane
    // road. Every lane inward is 5% faster, so without a cost for the manoeuvre
    // the cheapest path is lane 1 → lane 0 → back, gaining nothing.
    const roadType = RoadType.FOUR_LANE;
    const { mapping, reader, astar } = workerSetup(straight(roadType, 3), roadType);
    // Seeded in the OUTER lane, so moving over is a decision. Seeding every exit
    // point of the origin cell would start it in lane 0 already and the case
    // would pass without the cost existing.
    const starts = exitsInLane(mapping, toPosKey(0, 0), 1);
    const { ends } = endpoints(mapping, toPosKey(0, 0), toPosKey(2, 0));
    expect(starts.length).toBeGreaterThan(0);

    const path = astar.findPath(reader, starts, ends, { x: 2, y: 0 });
    expect(path).not.toBeNull();

    const changes = path!.filter(i => reader.getEdgeType(i) === 2);
    expect(changes, 'the worker changed lane on a three-cell road').toHaveLength(0);
  });

  it('should still move over when the run is long enough to repay it', () => {
    const roadType = RoadType.FOUR_LANE;
    const { mapping, reader, astar } = workerSetup(straight(roadType, 12), roadType);
    // Start from the outer lane only, so moving over is a decision and not the
    // default: A* is seeded with every exit point of the origin cell otherwise.
    const outerStarts = exitsInLane(mapping, toPosKey(0, 0), 1);
    const { ends } = endpoints(mapping, toPosKey(0, 0), toPosKey(11, 0));
    expect(outerStarts.length).toBeGreaterThan(0);

    const path = astar.findPath(reader, outerStarts, ends, { x: 11, y: 0 });
    expect(path).not.toBeNull();
    const changes = path!.filter(i => reader.getEdgeType(i) === 2);
    expect(changes.length, 'a twelve-cell run never moved into the faster lane')
      .toBeGreaterThan(0);
  });
});
