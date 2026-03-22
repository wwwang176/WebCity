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
  const last = path[path.length - 1]!;
  if (last.x >= 0 && last.x < mapWidth && last.y >= 0 && last.y < mapHeight) return null;

  const prev = path[path.length - 2]!;
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;

  let flag = 0;
  if (dx > 0) flag |= EAST;
  if (dx < 0) flag |= WEST;
  if (dy > 0) flag |= SOUTH;
  if (dy < 0) flag |= NORTH;

  return { outwardFlag: flag, truncatedLength: path.length - 1 };
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
