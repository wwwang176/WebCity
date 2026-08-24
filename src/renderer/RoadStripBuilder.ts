/**
 * Shared road strip generation logic used by both RoadRenderer (ground)
 * and ElevatedRoadRenderer (elevated).
 *
 * Pure functions — no Three.js, no side effects.
 */

import {
  RoadType, RoadDirection, ROAD_WIDTHS, getLaneCount, getLaneWidth,
} from '../core/road/types';
import { SIDEWALK_WIDTH, CW_OFFSET } from '../core/traffic/SidewalkGraph';
import { STOP_LINE_OFFSET } from '../core/traffic/VehicleLookahead';

/** Road widths live in `core/road/types`. Re-exported here so existing imports do not change. */
export { ROAD_WIDTHS };

export interface RoadCell {
  x: number;
  y: number;
  roadType: number;
  roadFlags: number;
}

export interface Strip {
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Rotation about the Y axis in radians. 0 on straight road; only bend arc segments use it. */
  rotY: number;
  roadType: number;
  srcX: number;
  srcY: number;
}

export interface SidewalkStrip {
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Rotation about the Y axis in radians. 0 on straight road; only bend arc segments use it. */
  rotY: number;
  srcX: number;
  srcY: number;
}

export interface LaneMarking {
  x: number;
  z: number;
  rotY: number;
  offsetPerp: number;
  srcX: number;
  srcY: number;
}

export interface CenterLine {
  x: number;
  z: number;
  rotY: number;
  offsetPerp: number;
  length: number;
  srcX: number;
  srcY: number;
}

export interface CurvedCenterLine {
  /** Arc center x */
  cx: number;
  /** Arc center z */
  cz: number;
  /** 1 or -1 to mirror the arc */
  scaleX: number;
  /** 0 or Math.PI to rotate 180° */
  rotY: number;
  srcX: number;
  srcY: number;
}

export interface CrosswalkStripe {
  x: number;
  z: number;
  sx: number;
  sz: number;
  srcX: number;
  srcY: number;
}

export interface StopLineData {
  x: number;
  z: number;
  sx: number;
  sz: number;
  srcX: number;
  srcY: number;
}

function countBits(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

/**
 * How many straight segments approximate the quarter circle of a 90 degree bend.
 *
 * Five segments of 18 degrees each leave an outer-edge sagitta of R x (1 - cos 9 degrees), about
 * 0.012 cells — narrower than the kerb itself and invisible to the eye. More segments only spend
 * instances: road surface and kerbs draw from one shared reserved pool, and a full
 * `RoadInstanceTracker` silently skips the whole cell.
 */
export const BEND_ARC_SEGMENTS = 5;

/**
 * Kerbs need finer segmentation.
 *
 * Each segment is a straight rectangle following the arc, so **its two ends** bulge outside the
 * circle by `R x (1/cos(theta/2) - 1)`. A kerb's radius is larger than the road surface's (0.94
 * against 0.8) while the kerb itself is only 0.14 wide: at five segments the bulge is 0.012,
 * close to a tenth of the kerb's width, and meeting the straight kerb of a straight road it
 * reads as a visible scalloped edge. Ten segments bring it down to 0.003.
 *
 * Asphalt does not need this many: its bulge is covered by the kerb. Separate counts avoid
 * spending instances for nothing, since both draw from the same reserved pool.
 */
export const BEND_KERB_SEGMENTS = 10;

/** Exactly two directions that are not opposite each other: an L bend. */
function isLBend(flags: number): boolean {
  if (countBits(flags) !== 2) return false;
  const hasN = (flags & RoadDirection.NORTH) !== 0;
  const hasS = (flags & RoadDirection.SOUTH) !== 0;
  const hasE = (flags & RoadDirection.EAST) !== 0;
  const hasW = (flags & RoadDirection.WEST) !== 0;
  return !(hasN && hasS) && !(hasE && hasW);
}

/**
 * Lays a constant-width band around a bend.
 *
 * Each segment is a **straight** rectangle following the arc. A straight rectangle cannot fill a
 * curved annulus, so it has to be extended — and every gap is on the **inside**, which makes the
 * extension one-sided:
 *
 * - One segment covers theta of arc. Its ends reach only `(R - w/2) * cos(theta/2)` in the
 *   radial direction, short of the annulus's inner edge, and the neighbouring segment reaches
 *   the same place symmetrically, so **neither covers** that corner. Outside it is the reverse:
 *   at delta = 0 it reaches exactly `R + w/2`, and its ends reach further still.
 * - So the outer edge sits at `R + w/2` exactly, the inner edge retreats inward until the band
 *   is covered, and the rectangle's centre therefore sits slightly inside R rather than on it.
 * - The length is measured to the **outer** edge's intersection, not the centre line's. Measured
 *   at the centre line, the outer edge opens a wedge-shaped hole, and the centre line is the one
 *   line along the whole band that never has a gap.
 *
 * The result: the outer contour is exact, the excess points inward, and it hides under the
 * neighbouring band (the kerb bites 0.01 cells into the asphalt, covering any residual seam).
 *
 * The geometry matches `emitLBendDashes`: the bend's centre is on the cell's corner, angle 0
 * points at the entering side and pi/2 at the leaving side. Dashes and double yellow lines are
 * already drawn about that centre, and only with the road surface following them do the lines
 * land in the middle of the asphalt.
 */
function arcBand(
  r: RoadCell, radius: number, width: number, segments: number,
): { x: number; z: number; sx: number; sz: number; rotY: number }[] {
  const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
  const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
  const { dirX, dirZ, cornerX, cornerZ } = getLBendParams(hasN, hasE);

  const theta = (Math.PI / 2) / segments;
  const cosHalf = Math.cos(theta / 2);
  const outer = radius + width / 2;
  const inner = radius - (radius * (1 - cosHalf) + (width / 2) * cosHalf);
  const mid = (outer + inner) / 2;
  const halfW = (outer - inner) / 2;
  const halfLen = outer * Math.tan(theta / 2);
  const out: { x: number; z: number; sx: number; sz: number; rotY: number }[] = [];

  for (let k = 0; k < segments; k++) {
    const a = (k + 0.5) * theta;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    out.push({
      x: r.x + cornerX + dirX * mid * cosA,
      z: r.y + cornerZ + dirZ * mid * sinA,
      sx: halfW * 2,
      sz: halfLen * 2,
      // Tangent direction, computed the same way as in `emitLBendDashes`.
      rotY: Math.atan2(-dirX * sinA, dirZ * cosA),
    });
  }
  return out;
}

/**
 * Generate road surface strips from cells.
 * Two-strip method: each cell emits 1-2 strips whose width comes from
 * the neighboring road type in that axis.
 *
 * @param edgeExtend If > 0, extend strips beyond map edge for border cells.
 */
export function buildRoadStrips(
  cells: RoadCell[],
  mapW = 0,
  mapH = 0,
  edgeExtend = 0,
): Strip[] {
  const strips: Strip[] = [];

  const cellMap = new Map<string, RoadCell>();
  for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

  for (const r of cells) {
    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;
    const hasVert = hasN || hasS;
    const hasHoriz = hasE || hasW;

    const ownW = ROAD_WIDTHS[r.roadType] ?? 0.6;
    let dirCount = 0;
    if (hasN) dirCount++;
    if (hasS) dirCount++;
    if (hasE) dirCount++;
    if (hasW) dirCount++;
    const isIntersection = dirCount >= 3;

    let vertW = ownW;
    let horizW = ownW;
    if (isIntersection) {
      const nN = hasN ? cellMap.get(`${r.x},${r.y - 1}`) : null;
      const nS = hasS ? cellMap.get(`${r.x},${r.y + 1}`) : null;
      const nE = hasE ? cellMap.get(`${r.x + 1},${r.y}`) : null;
      const nW = hasW ? cellMap.get(`${r.x - 1},${r.y}`) : null;
      vertW = ROAD_WIDTHS[(nN ?? nS)?.roadType ?? r.roadType] ?? ownW;
      horizW = ROAD_WIDTHS[(nE ?? nW)?.roadType ?? r.roadType] ?? ownW;
    }

    // A bend's asphalt follows the arc. Radius 0.5 is the bend centre to the road's centre line,
    // and the band width is the road width, so both ends meet the north and east boundaries
    // within half a width and line up with the neighbouring cells.
    if (isLBend(r.roadFlags)) {
      for (const seg of arcBand(r, 0.5, ownW, BEND_ARC_SEGMENTS)) {
        strips.push({ ...seg, roadType: r.roadType, srcX: r.x, srcY: r.y });
      }
      continue;
    }

    // Vertical (N-S) strip
    if (hasVert || !hasHoriz) {
      const w = hasVert ? vertW : ownW;
      const half = w / 2;
      const zMin = hasN ? -0.5 : -half;
      const zMax = hasS ? 0.5 : half;
      strips.push({ x: r.x, z: r.y + (zMin + zMax) / 2, sx: w, sz: zMax - zMin, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
    }

    // Horizontal (E-W) strip
    if (hasHoriz) {
      const w = horizW;
      const half = w / 2;
      const xMin = hasW ? -0.5 : -half;
      const xMax = hasE ? 0.5 : half;
      strips.push({ x: r.x + (xMin + xMax) / 2, z: r.y, sx: xMax - xMin, sz: w, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
    }

    // Edge extension
    if (edgeExtend > 0 && mapW > 0 && mapH > 0) {
      const ext = edgeExtend;
      if (r.y === 0 && hasN) strips.push({ x: r.x, z: r.y - 0.5 - ext / 2, sx: ownW, sz: ext, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.y === mapH - 1 && hasS) strips.push({ x: r.x, z: r.y + 0.5 + ext / 2, sx: ownW, sz: ext, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.x === 0 && hasW) strips.push({ x: r.x - 0.5 - ext / 2, z: r.y, sx: ext, sz: ownW, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.x === mapW - 1 && hasE) strips.push({ x: r.x + 0.5 + ext / 2, z: r.y, sx: ext, sz: ownW, rotY: 0, roadType: r.roadType, srcX: r.x, srcY: r.y });
    }
  }

  return strips;
}

/** Generate sidewalk strips for road cells. */
export function buildSidewalkStrips(cells: RoadCell[]): SidewalkStrip[] {
  const strips: SidewalkStrip[] = [];

  const cellMap = new Map<string, RoadCell>();
  for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

  for (const r of cells) {
    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

    const ownW = ROAD_WIDTHS[r.roadType] ?? 0.6;
    let dirCount = 0;
    if (hasN) dirCount++;
    if (hasS) dirCount++;
    if (hasE) dirCount++;
    if (hasW) dirCount++;
    const isIntersection = dirCount >= 3;

    let vertW = ownW;
    let horizW = ownW;
    if (isIntersection) {
      const nN = hasN ? cellMap.get(`${r.x},${r.y - 1}`) : null;
      const nS = hasS ? cellMap.get(`${r.x},${r.y + 1}`) : null;
      const nE = hasE ? cellMap.get(`${r.x + 1},${r.y}`) : null;
      const nW = hasW ? cellMap.get(`${r.x - 1},${r.y}`) : null;
      vertW = (hasN || hasS) ? (ROAD_WIDTHS[(nN ?? nS)?.roadType ?? r.roadType] ?? ownW) : ownW;
      horizW = (hasE || hasW) ? (ROAD_WIDTHS[(nE ?? nW)?.roadType ?? r.roadType] ?? ownW) : ownW;
    }

    // A bend needs a kerb on the outside only; both inner sides are road.
    //
    // The radius reaches the **asphalt's outer edge**, not that edge plus half a kerb. A straight
    // road's kerb straddles the asphalt edge (`x = +/-vHalf`) with its inner half hidden under
    // the road slab, so only `SIDEWALK_WIDTH/2` shows. Placed entirely outside the asphalt, a
    // bend's kerb would **look twice as wide**, and equally twice as wide at every road width.
    if (isLBend(r.roadFlags)) {
      const radius = 0.5 + ownW / 2;
      for (const seg of arcBand(r, radius, SIDEWALK_WIDTH, BEND_KERB_SEGMENTS)) {
        strips.push({ ...seg, srcX: r.x, srcY: r.y });
      }
      continue;
    }

    const hHalf = horizW / 2;
    const vHalf = vertW / 2;
    const capH = hHalf + SIDEWALK_WIDTH / 2;
    const capV = vHalf + SIDEWALK_WIDTH / 2;
    const le = hasW ? 0.5 : capH;
    const re = hasE ? 0.5 : capH;
    const te = hasN ? 0.5 : capV;
    const be = hasS ? 0.5 : capV;

    if (!hasN) strips.push({ x: r.x + (re - le) / 2, z: r.y - hHalf, sx: le + re, sz: SIDEWALK_WIDTH, rotY: 0, srcX: r.x, srcY: r.y });
    if (!hasS) strips.push({ x: r.x + (re - le) / 2, z: r.y + hHalf, sx: le + re, sz: SIDEWALK_WIDTH, rotY: 0, srcX: r.x, srcY: r.y });
    if (!hasW) strips.push({ x: r.x - vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be, rotY: 0, srcX: r.x, srcY: r.y });
    if (!hasE) strips.push({ x: r.x + vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be, rotY: 0, srcX: r.x, srcY: r.y });
  }

  return strips;
}

/** How many dashes one divider is split into on a straight road. An L bend uses 3, so the straight case is the maximum. */
const DASHES_PER_DIVIDER = 4;

/** How many dividers run between one direction's lanes on this road type, both sides combined. With one lane it is the centre dash. */
function dividerCount(roadType: number): number {
  const lanes = roadType === RoadType.ONE_WAY ? 1 : getLaneCount(roadType);
  return lanes === 1 ? 1 : 2 * (lanes - 1);
}

/**
 * The maximum number of lane dashes one cell draws.
 *
 * Both renderers size their `InstancedMesh` from it. **Computed rather than hard-coded**: a full
 * `RoadInstanceTracker` returns -1 and the caller skips the whole cell, so dashes beyond the
 * limit vanish silently with nothing reported. Six-lane roads going from 8 dashes per cell to 16
 * ran straight into a hard-coded 14.
 */
export const MAX_LANE_MARKINGS_PER_CELL = DASHES_PER_DIVIDER * Math.max(
  ...Object.keys(ROAD_WIDTHS).map(t => dividerCount(Number(t))),
);

export interface LampPosition {
  x: number;
  z: number;
  /**
   * Which way the light falls. Local +Z rotated by this angle points at the road surface.
   *
   * A ground-level lamp casts a full ring of glow, because there is ground all around it. An
   * elevated lamp stands at the deck's edge, where half of a full ring would fall into open air
   * beyond the bridge, so that one draws a half circle, and this angle is what points it.
   */
  rotY: number;
  srcX: number;
  srcY: number;
}

/**
 * Where street lamps stand.
 *
 * Both renderers, ground level and elevated, would otherwise carry identical inline copies of
 * this logic — and bends are exactly what changes here, so one copy would drift. Here it is also
 * testable.
 *
 * Straight road: one lamp per direction without road, at the centre of that side's kerb.
 * Bend: both lamps sit **on the outer arc**. Placed by the straight-road rule they land at the
 * midpoints of the south and west boundaries, 1.003 from the bend's centre, while the kerb only
 * reaches 0.87, leaving the lamps standing on grass.
 */
export function buildLampPositions(cells: RoadCell[]): LampPosition[] {
  const lamps: LampPosition[] = [];

  for (const r of cells) {
    const ownW = ROAD_WIDTHS[r.roadType] ?? 0.6;
    const half = ownW / 2 + SIDEWALK_WIDTH / 2;

    if (isLBend(r.roadFlags)) {
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const { dirX, dirZ, cornerX, cornerZ } = getLBendParams(hasN, hasE);
      const radius = 0.5 + half;
      // At 1/4 and 3/4 along the quarter circle. A straight road takes one lamp per side, while a
      // bend has only one outer arc, and two lamps keep the corner from going dark.
      for (const t of [0.25, 0.75]) {
        const a = t * (Math.PI / 2);
        const ux = dirX * Math.cos(a);
        const uz = dirZ * Math.sin(a);
        lamps.push({
          x: r.x + cornerX + radius * ux,
          z: r.y + cornerZ + radius * uz,
          // Inward means toward the bend's centre, not along a coordinate axis.
          rotY: Math.atan2(-ux, -uz),
          srcX: r.x, srcY: r.y,
        });
      }
      continue;
    }

    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;
    // rotY always points back at the cell's centre: whichever side a lamp stands on, its light
    // falls the opposite way.
    if (!hasN) lamps.push({ x: r.x, z: r.y - half, rotY: 0, srcX: r.x, srcY: r.y });
    if (!hasS) lamps.push({ x: r.x, z: r.y + half, rotY: Math.PI, srcX: r.x, srcY: r.y });
    if (!hasW) lamps.push({ x: r.x - half, z: r.y, rotY: Math.PI / 2, srcX: r.x, srcY: r.y });
    if (!hasE) lamps.push({ x: r.x + half, z: r.y, rotY: -Math.PI / 2, srcX: r.x, srcY: r.y });
  }

  return lamps;
}

/** Generate lane marking positions for road cells. */
export function buildLaneMarkingData(cells: RoadCell[]): LaneMarking[] {
  const markings: LaneMarking[] = [];

  const cellMap = new Map<string, RoadCell>();
  const intersections = new Set<string>();
  for (const c of cells) {
    cellMap.set(`${c.x},${c.y}`, c);
    if (countBits(c.roadFlags) >= 3) intersections.add(`${c.x},${c.y}`);
  }

  for (const r of cells) {
    if (r.roadType === RoadType.RURAL) continue;
    const connections = countBits(r.roadFlags);
    if (connections !== 2) continue;

    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

    // Dashes are drawn between adjacent lanes at positions from `getLaneWidth`, the same source
    // the lane graph uses. `road width / 4` with one dash regardless of lane count happens to
    // line up on four-lane roads, where `w/4` equals the lane width at two lanes per direction,
    // and gives a six-lane road one dash for three rows of traffic, with that dash between no two
    // rows at all.
    //
    // One-way roads are excepted. All their lanes run the same way, but `LaneGraph` packs the
    // vehicles to the right of the centre line, using half the road surface: the lane positions
    // themselves are not right yet, and drawing dashes from them only draws the wrong place. The
    // centre dash stays until the anchors are fixed (TODO.md).
    const laneWidth = getLaneWidth(r.roadType);
    const offsets = dividerCount(r.roadType) === 1
      ? [0]
      : Array.from({ length: getLaneCount(r.roadType) - 1 }, (_, i) => (i + 1) * laneWidth)
        .flatMap(o => [-o, o]);

    if (hasN && hasS) {
      const intN = intersections.has(`${r.x},${r.y - 1}`);
      const intS = intersections.has(`${r.x},${r.y + 1}`);
      for (const off of offsets) {
        if (!intN) markings.push({ x: r.x, z: r.y - 0.375, rotY: 0, offsetPerp: off, srcX: r.x, srcY: r.y });
        markings.push({ x: r.x, z: r.y - 0.125, rotY: 0, offsetPerp: off, srcX: r.x, srcY: r.y });
        markings.push({ x: r.x, z: r.y + 0.125, rotY: 0, offsetPerp: off, srcX: r.x, srcY: r.y });
        if (!intS) markings.push({ x: r.x, z: r.y + 0.375, rotY: 0, offsetPerp: off, srcX: r.x, srcY: r.y });
      }
    } else if (hasE && hasW) {
      const intW = intersections.has(`${r.x - 1},${r.y}`);
      const intE = intersections.has(`${r.x + 1},${r.y}`);
      for (const off of offsets) {
        if (!intW) markings.push({ x: r.x - 0.375, z: r.y, rotY: Math.PI / 2, offsetPerp: off, srcX: r.x, srcY: r.y });
        markings.push({ x: r.x - 0.125, z: r.y, rotY: Math.PI / 2, offsetPerp: off, srcX: r.x, srcY: r.y });
        markings.push({ x: r.x + 0.125, z: r.y, rotY: Math.PI / 2, offsetPerp: off, srcX: r.x, srcY: r.y });
        if (!intE) markings.push({ x: r.x + 0.375, z: r.y, rotY: Math.PI / 2, offsetPerp: off, srcX: r.x, srcY: r.y });
      }
    } else {
      // L-bend: place dashes along arc path
      emitLBendDashes(markings, r, offsets);
    }
  }

  return markings;
}

/** Half-gap between the two center lines. */
const CENTER_LINE_HALF_GAP = 0.012;

/** Generate double solid center line data for 4+ lane roads. */
export function buildCenterLineData(cells: RoadCell[]): CenterLine[] {
  const lines: CenterLine[] = [];

  const intersections = new Set<string>();
  for (const c of cells) {
    if (countBits(c.roadFlags) >= 3) intersections.add(`${c.x},${c.y}`);
  }

  for (const r of cells) {
    const isFourLane = r.roadType === RoadType.FOUR_LANE || r.roadType === RoadType.SIX_LANE
      || r.roadType === RoadType.HIGHWAY;
    if (!isFourLane) continue;
    const connections = countBits(r.roadFlags);
    if (connections !== 2) continue;

    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

    if (hasN && hasS) {
      const intN = intersections.has(`${r.x},${r.y - 1}`);
      const intS = intersections.has(`${r.x},${r.y + 1}`);
      const zMin = intN ? -0.5 + STOP_LINE_OFFSET : -0.5;
      const zMax = intS ? 0.5 - STOP_LINE_OFFSET : 0.5;
      const len = zMax - zMin;
      if (len <= 0) continue;
      const zCenter = r.y + (zMin + zMax) / 2;
      for (const sign of [-1, 1]) {
        lines.push({
          x: r.x, z: zCenter, rotY: 0,
          offsetPerp: sign * CENTER_LINE_HALF_GAP,
          length: len, srcX: r.x, srcY: r.y,
        });
      }
    } else if (hasE && hasW) {
      const intW = intersections.has(`${r.x - 1},${r.y}`);
      const intE = intersections.has(`${r.x + 1},${r.y}`);
      const xMin = intW ? -0.5 + STOP_LINE_OFFSET : -0.5;
      const xMax = intE ? 0.5 - STOP_LINE_OFFSET : 0.5;
      const len = xMax - xMin;
      if (len <= 0) continue;
      const xCenter = r.x + (xMin + xMax) / 2;
      for (const sign of [-1, 1]) {
        lines.push({
          x: xCenter, z: r.y, rotY: Math.PI / 2,
          offsetPerp: sign * CENTER_LINE_HALF_GAP,
          length: len, srcX: r.x, srcY: r.y,
        });
      }
    }
  }

  return lines;
}

// ── L-bend arc helpers ───────────────────────────────────────

/** Number of dashes placed along a 90° L-bend arc. */
const BEND_DASH_COUNT = 3;
const BEND_DASH_T = [1 / 6, 3 / 6, 5 / 6];

function getLBendParams(hasN: boolean, hasE: boolean) {
  const dirX = hasE ? -1 : 1;
  const dirZ = hasN ? 1 : -1;
  const cornerX = hasE ? 0.5 : -0.5;
  const cornerZ = hasN ? -0.5 : 0.5;
  return { dirX, dirZ, cornerX, cornerZ };
}

function emitLBendDashes(
  markings: LaneMarking[], r: RoadCell, offsets: number[],
): void {
  const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
  const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
  const { dirX, dirZ, cornerX, cornerZ } = getLBendParams(hasN, hasE);
  const R = 0.5;

  for (const off of offsets) {
    const Rl = R + dirX * off;
    for (const t of BEND_DASH_T) {
      const a = t * Math.PI / 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const x = r.x + cornerX + dirX * Rl * cosA;
      const z = r.y + cornerZ + dirZ * Rl * sinA;
      const rotY = Math.atan2(-dirX * sinA, dirZ * cosA);
      markings.push({ x, z, rotY, offsetPerp: 0, srcX: r.x, srcY: r.y });
    }
  }
}

/** Generate curved double solid center line data for 4+ lane L-bends. */
export function buildCurvedCenterLineData(cells: RoadCell[]): CurvedCenterLine[] {
  const result: CurvedCenterLine[] = [];

  for (const r of cells) {
    const isFourLane = r.roadType === RoadType.FOUR_LANE || r.roadType === RoadType.SIX_LANE
      || r.roadType === RoadType.HIGHWAY;
    if (!isFourLane) continue;
    const connections = countBits(r.roadFlags);
    if (connections !== 2) continue;

    const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

    // Skip straight segments (handled by buildCenterLineData)
    if ((hasN && hasS) || (hasE && hasW)) continue;

    // L-bend: N+E, N+W, S+E, S+W
    const cornerX = hasE ? 0.5 : -0.5;
    const cornerZ = hasN ? -0.5 : 0.5;
    // N+E, S+W → right-curving (scaleX=1); N+W, S+E → left-curving (scaleX=-1)
    const scaleX = ((hasN && hasE) || (hasS && hasW)) ? 1 : -1;
    const rotY = hasS ? Math.PI : 0;

    result.push({
      cx: r.x + cornerX,
      cz: r.y + cornerZ,
      scaleX, rotY,
      srcX: r.x, srcY: r.y,
    });
  }

  return result;
}

/**
 * Generate crosswalk stripe data for intersection neighbors.
 * Source cell (srcX/srcY) is the NEIGHBOR where the crosswalk appears, not the intersection.
 */
export function buildCrosswalkData(cells: RoadCell[]): CrosswalkStripe[] {
  const strips: CrosswalkStripe[] = [];
  const cellMap = new Map<string, RoadCell>();
  for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

  const stripeCount = 12;
  const stripeGap = 0.042;
  const stripeLen = 0.11;
  const cwOffset = CW_OFFSET;

  for (const r of cells) {
    if (countBits(r.roadFlags) < 3) continue;

    const neighbors: [number, number, number][] = [
      [0, -1, RoadDirection.NORTH],
      [0,  1, RoadDirection.SOUTH],
      [1,  0, RoadDirection.EAST],
      [-1, 0, RoadDirection.WEST],
    ];

    for (const [dx, dy, dirFlag] of neighbors) {
      if (!(r.roadFlags & dirFlag)) continue;
      const nb = cellMap.get(`${r.x + dx},${r.y + dy}`);
      if (!nb) continue;

      if (dx === 0) {
        const zPos = nb.y + (-dy) * cwOffset;
        for (let s = 0; s < stripeCount; s++) {
          strips.push({
            x: nb.x - (stripeCount - 1) * stripeGap / 2 + s * stripeGap,
            z: zPos, sx: 0.025, sz: stripeLen,
            srcX: nb.x, srcY: nb.y,
          });
        }
      } else {
        const xPos = nb.x + (-dx) * cwOffset;
        for (let s = 0; s < stripeCount; s++) {
          strips.push({
            x: xPos,
            z: nb.y - (stripeCount - 1) * stripeGap / 2 + s * stripeGap,
            sx: stripeLen, sz: 0.025,
            srcX: nb.x, srcY: nb.y,
          });
        }
      }
    }
  }
  return strips;
}

/**
 * Generate stop line data for intersection neighbors (right-hand drive).
 * Source cell (srcX/srcY) is the NEIGHBOR where the stop line appears.
 */
export function buildStopLineData(cells: RoadCell[]): StopLineData[] {
  const lines: StopLineData[] = [];
  const cellMap = new Map<string, RoadCell>();
  for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

  const stopOffset = STOP_LINE_OFFSET;
  const halfLane = 0.15;

  for (const r of cells) {
    if (countBits(r.roadFlags) < 3) continue;

    const neighbors: [number, number, number][] = [
      [0, -1, RoadDirection.NORTH],
      [0,  1, RoadDirection.SOUTH],
      [1,  0, RoadDirection.EAST],
      [-1, 0, RoadDirection.WEST],
    ];

    for (const [dx, dy, dirFlag] of neighbors) {
      if (!(r.roadFlags & dirFlag)) continue;
      const nb = cellMap.get(`${r.x + dx},${r.y + dy}`);
      if (!nb) continue;

      if (dx === 0) {
        const zPos = nb.y + (-dy) * stopOffset;
        const laneX = nb.x + dy * halfLane;
        lines.push({ x: laneX, z: zPos, sx: halfLane * 2, sz: 0.012, srcX: nb.x, srcY: nb.y });
      } else {
        const xPos = nb.x + (-dx) * stopOffset;
        const laneZ = nb.y - dx * halfLane;
        lines.push({ x: xPos, z: laneZ, sx: 0.012, sz: halfLane * 2, srcX: nb.x, srcY: nb.y });
      }
    }
  }
  return lines;
}
