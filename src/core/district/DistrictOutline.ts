import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/**
 * One segment of a district boundary, in grid coordinates. Cell centres are on integers, so
 * boundaries fall on .5.
 */
export interface OutlineSegment {
  x1: number; y1: number;
  x2: number; y2: number;
}

/** The four neighbours and the edge on each side. */
const SIDES = [
  { dx: 0, dy: -1, ox1: -0.5, oy1: -0.5, ox2: 0.5, oy2: -0.5 },   // north
  { dx: 0, dy: 1, ox1: -0.5, oy1: 0.5, ox2: 0.5, oy2: 0.5 },      // south
  { dx: -1, dy: 0, ox1: -0.5, oy1: -0.5, ox2: -0.5, oy2: 0.5 },   // west
  { dx: 1, dy: 0, ox1: 0.5, oy1: -0.5, ox2: 0.5, oy2: 0.5 },      // east
] as const;

/**
 * The outline drawn on the map for the selected district.
 *
 * An outline rather than a highlight: the district overlay already tints those cells, and a
 * translucent white on top makes the area look faded rather than selected.
 *
 * An edge is drawn only when the cell on its other side is not in this district, so holes are
 * outlined too. Subtract mode often leaves a district shaped like a ring, and without the hole's
 * boundary the middle still looks selected.
 */
export function districtOutline(cells: ReadonlySet<string>): OutlineSegment[] {
  const segments: OutlineSegment[] = [];
  for (const key of cells) {
    const { x, y } = parsePosKeyUnsafe(key);
    for (const s of SIDES) {
      if (cells.has(`${x + s.dx},${y + s.dy}`)) continue;
      segments.push({
        x1: x + s.ox1, y1: y + s.oy1,
        x2: x + s.ox2, y2: y + s.oy2,
      });
    }
  }
  return segments;
}
