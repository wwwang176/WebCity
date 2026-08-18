/**
 * Which lane a turn belongs in, and what it costs to take it from another one.
 *
 * Every lane of an approach carries a turn edge and they all cost the same, so
 * A* turned from whichever lane the vehicle already occupied. Measured on a
 * four-lane crossing, a right turn taken from the inner lane passes within
 * 0.0048 of the outer lane's through path (0.1908 from the correct lane) while
 * cars are 0.09 wide — and `findCrossEdgeGap` only compares vehicles that share
 * a destination point, so nothing keeps the two apart. Both come from the same
 * approach, so one green light releases them together (BUG-214).
 *
 * Kept here rather than in LaneGraph because two A* implementations need it and
 * they see different things: LaneGraphPathfinder walks LaneEdge objects, while
 * the worker's PooledAStar walks a SharedArrayBuffer where directions and point
 * types are already integers. The arithmetic lives in the integer form and the
 * object form maps onto it, so the two engines cannot drift apart.
 *
 * Pure logic module — no Three.js imports.
 */

/** Direction codes, matching LaneGraphBuffer's DIR_TO_INT. */
export const DIR_NORTH = 0;
export const DIR_SOUTH = 1;
export const DIR_EAST = 2;
export const DIR_WEST = 3;

/** Point type codes, matching LaneGraphBuffer's POINT_TYPE_TO_INT. */
export const POINT_ENTRY = 0;
export const POINT_EXIT = 1;

/** Returned by idealTurnLaneInt when the edge does not turn. */
export const NO_PREFERRED_LANE = -1;

const DIR_VECTORS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 }, // north
  { dx: 0, dy: 1 },  // south
  { dx: 1, dy: 0 },  // east
  { dx: -1, dy: 0 }, // west
];

const OPPOSITE_DIR: ReadonlyArray<number> = [DIR_SOUTH, DIR_NORTH, DIR_WEST, DIR_EAST];

/**
 * Extra cost per lane of deviation from the lane a turn belongs in.
 *
 * The bar is not one lane change but TWO. A vehicle that moves over to turn can
 * move back afterwards, and it will: every lane outward is 5% slower
 * (getLaneSpeedMultiplier), so a long run in the outer lane costs more than the
 * manoeuvre to leave it. The alternative to beat is therefore
 * 2 x LANE_CHANGE_COST = 0.30, plus the slower-lane cost of the cell or two
 * spent out of position. 0.35 sat inside that margin and left a second turn
 * still being taken from the wrong lane wherever the road ran on afterwards.
 *
 * Both sides scale linearly per lane, so the comparison holds at any width:
 * three lanes out of position costs 3x here against 3x there.
 *
 * Still small against a turn's own cost (~0.75-1.04), so it decides which lane
 * a turn is taken from without deciding which junction the route uses.
 */
export const TURN_LANE_PENALTY = 0.5;

/**
 * Direction of travel a connection point represents. An exit travels outward
 * along its own direction; an entry names the side the vehicle arrives FROM, so
 * it travels the opposite way.
 */
export function travelDirInt(dir: number, pointType: number): number {
  return pointType === POINT_EXIT ? dir : (OPPOSITE_DIR[dir] ?? dir);
}

/**
 * The lane a turn should be taken from, or NO_PREFERRED_LANE when the edge
 * carries straight on (or reverses) and no lane is preferred.
 *
 * Lane offsets are laid out to the right of the travel direction
 * (LaneGraph.generatePointsForCell), so a higher index sits nearer the kerb: a
 * right turn belongs in the outermost lane and a left turn in lane 0.
 */
export function idealTurnLaneInt(
  fromDir: number,
  fromType: number,
  toDir: number,
  toType: number,
  laneCount: number,
): number {
  const vIn = DIR_VECTORS[travelDirInt(fromDir, fromType)];
  const vOut = DIR_VECTORS[travelDirInt(toDir, toType)];
  if (!vIn || !vOut) return NO_PREFERRED_LANE;
  // y grows southward, so a positive cross product is a right turn.
  const cross = vIn.dx * vOut.dy - vIn.dy * vOut.dx;
  if (cross === 0) return NO_PREFERRED_LANE;
  return cross > 0 ? laneCount - 1 : 0;
}

/**
 * Cost added to a turn taken from the wrong lane, proportional to how far that
 * lane is from the right one.
 *
 * Charged on the lane the turn STARTS in, which is where the arc cuts across: a
 * right turn begun in an inner lane sweeps over the through path beside it. A
 * lane change that turns at the same time is charged too — its arc starts in
 * the same place and crosses the same traffic.
 *
 * `throughJunction` is the whole justification, so nothing is charged without
 * it. A plain bend has no through traffic to cut across: a two-direction cell
 * emits turn edges only, and the generator wires lane L to lane L, so the arcs
 * are concentric and never meet. Charging there bought nothing and cost a lane
 * change each way — on an S-shaped road the vehicle swung out for every right
 * bend and cut straight back in, five changes on a staircase of six (BUG-317).
 *
 * The condition is a parameter rather than a caller-side guard on purpose: two
 * engines call this, and a rule taught to one and not the other is a rule the
 * player never sees. That is why the arithmetic lives in this module at all.
 */
export function turnLanePenaltyInt(
  fromDir: number,
  fromType: number,
  fromLane: number,
  toDir: number,
  toType: number,
  laneCount: number,
  throughJunction: boolean,
): number {
  if (!throughJunction) return 0;
  if (laneCount <= 1) return 0;
  const ideal = idealTurnLaneInt(fromDir, fromType, toDir, toType, laneCount);
  if (ideal === NO_PREFERRED_LANE) return 0;
  return TURN_LANE_PENALTY * Math.abs(fromLane - ideal);
}
