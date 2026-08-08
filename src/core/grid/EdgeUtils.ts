/**
 * Shared utility for checking whether a border cell has a direction flag
 * pointing inward (perpendicular to the map edge). Used by both highway
 * and rail external connection detection to filter out parallel tracks.
 *
 * Direction flag values (shared by RoadDirection and TrackDirection):
 *   NORTH = 0b0001, SOUTH = 0b0010, WEST = 0b0100, EAST = 0b1000
 */

const SOUTH = 0b0010;
const NORTH = 0b0001;
const EAST  = 0b1000;
const WEST  = 0b0100;

/**
 * Returns true if a border cell's flags include a direction pointing
 * inward (away from the map edge). A cell not on any edge returns false.
 *
 * Examples:
 *  - Cell at y=0 (north edge) with SOUTH flag → true (goes into map)
 *  - Cell at y=0 with only EAST|WEST flags → false (runs parallel)
 *  - Corner cell (0,0) with SOUTH or EAST → true
 */
/**
 * If the last cell of a path is outside the map, returns the outward
 * direction flag for the edge cell and the truncated path length.
 * Returns null if the path does not extend beyond the map.
 */
export function extractOutOfBoundsEdge(
  path: ReadonlyArray<{ x: number; y: number }>,
  mapWidth: number, mapHeight: number,
): { outwardFlag: number; truncatedLength: number } | null {
  if (path.length < 2) return null;
  const inBounds = (p: { x: number; y: number }) =>
    p.x >= 0 && p.x < mapWidth && p.y >= 0 && p.y < mapHeight;

  if (inBounds(path[path.length - 1]!)) return null;

  // Trim the WHOLE trailing out-of-bounds run, not just one cell.
  //
  // getLShapedPath walks one axis and then the other, so a diagonal drag to the
  // border ring — legal, since GridCursor clamps the cursor to one cell beyond
  // the edge — puts an entire leg outside the map. Dragging from (5,5) to
  // (-1,3) yields ...(-1,5), (-1,4), (-1,3): removing one cell still left two
  // out of bounds, validateRoadPath returned OUT_OF_BOUNDS, and the whole build
  // was rejected. Any non-axis-aligned drag to the edge failed this way.
  // Only the one-cell ring GridCursor allows is trimmable. Anything further out
  // cannot be produced by the UI, and the existing contract is to reject it as
  // OUT_OF_BOUNDS rather than silently truncate a long drag — returning null
  // here leaves those cells in the path for validateRoadPath to refuse.
  const inBorderRing = (p: { x: number; y: number }) =>
    p.x >= -1 && p.x <= mapWidth && p.y >= -1 && p.y <= mapHeight;

  let truncatedLength = path.length;
  while (truncatedLength > 0 && !inBounds(path[truncatedLength - 1]!)) {
    if (!inBorderRing(path[truncatedLength - 1]!)) return null;
    truncatedLength--;
  }
  if (truncatedLength === 0) return null;

  // The exit direction is the step from the last in-bounds cell to the first
  // out-of-bounds one. Deriving it from the final two cells instead described
  // travel ALONG the out-of-bounds leg — NORTH for a path that leaves westward
  // (BUG-098).
  const lastInside = path[truncatedLength - 1]!;
  const firstOutside = path[truncatedLength]!;
  const dx = firstOutside.x - lastInside.x;
  const dy = firstOutside.y - lastInside.y;

  let flag = 0;
  if (dx > 0) flag |= EAST;
  if (dx < 0) flag |= WEST;
  if (dy > 0) flag |= SOUTH;
  if (dy < 0) flag |= NORTH;

  return { outwardFlag: flag, truncatedLength };
}

export function hasInwardFlag(
  x: number, y: number,
  mapWidth: number, mapHeight: number,
  flags: number,
): boolean {
  // Check each edge the cell is on; if it has a flag pointing inward, it qualifies
  if (y === 0 && (flags & SOUTH)) return true;
  if (y === mapHeight - 1 && (flags & NORTH)) return true;
  if (x === 0 && (flags & EAST)) return true;
  if (x === mapWidth - 1 && (flags & WEST)) return true;
  return false;
}
