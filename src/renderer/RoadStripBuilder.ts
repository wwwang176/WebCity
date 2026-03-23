/**
 * Shared road strip generation logic used by both RoadRenderer (ground)
 * and ElevatedRoadRenderer (elevated).
 *
 * Pure functions — no Three.js, no side effects.
 */

import { RoadType, RoadDirection, ROAD_CONFIGS } from '../core/road/types';
import { SIDEWALK_WIDTH } from '../core/traffic/SidewalkGraph';

export const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};

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
  roadType: number;
}

export interface SidewalkStrip {
  x: number;
  z: number;
  sx: number;
  sz: number;
}

export interface LaneMarking {
  x: number;
  z: number;
  rotY: number;
  offsetPerp: number;
}

function countBits(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
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

    // Vertical (N-S) strip
    if (hasVert || !hasHoriz) {
      const w = hasVert ? vertW : ownW;
      const half = w / 2;
      const zMin = hasN ? -0.5 : -half;
      const zMax = hasS ? 0.5 : half;
      strips.push({ x: r.x, z: r.y + (zMin + zMax) / 2, sx: w, sz: zMax - zMin, roadType: r.roadType });
    }

    // Horizontal (E-W) strip
    if (hasHoriz) {
      const w = horizW;
      const half = w / 2;
      const xMin = hasW ? -0.5 : -half;
      const xMax = hasE ? 0.5 : half;
      strips.push({ x: r.x + (xMin + xMax) / 2, z: r.y, sx: xMax - xMin, sz: w, roadType: r.roadType });
    }

    // Edge extension
    if (edgeExtend > 0 && mapW > 0 && mapH > 0) {
      const ext = edgeExtend;
      if (r.y === 0 && hasN) strips.push({ x: r.x, z: r.y - 0.5 - ext / 2, sx: ownW, sz: ext, roadType: r.roadType });
      if (r.y === mapH - 1 && hasS) strips.push({ x: r.x, z: r.y + 0.5 + ext / 2, sx: ownW, sz: ext, roadType: r.roadType });
      if (r.x === 0 && hasW) strips.push({ x: r.x - 0.5 - ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType });
      if (r.x === mapW - 1 && hasE) strips.push({ x: r.x + 0.5 + ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType });
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

    const hHalf = horizW / 2;
    const vHalf = vertW / 2;
    const capH = hHalf + SIDEWALK_WIDTH / 2;
    const capV = vHalf + SIDEWALK_WIDTH / 2;
    const le = hasW ? 0.5 : capH;
    const re = hasE ? 0.5 : capH;
    const te = hasN ? 0.5 : capV;
    const be = hasS ? 0.5 : capV;

    if (!hasN) strips.push({ x: r.x + (re - le) / 2, z: r.y - hHalf, sx: le + re, sz: SIDEWALK_WIDTH });
    if (!hasS) strips.push({ x: r.x + (re - le) / 2, z: r.y + hHalf, sx: le + re, sz: SIDEWALK_WIDTH });
    if (!hasW) strips.push({ x: r.x - vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be });
    if (!hasE) strips.push({ x: r.x + vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be });
  }

  return strips;
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

    const isFourLane = r.roadType === RoadType.FOUR_LANE || r.roadType === RoadType.SIX_LANE;
    const w = ROAD_WIDTHS[r.roadType] ?? 0.7;
    const laneOffset = w / 4;
    const offsets = isFourLane ? [-laneOffset, 0, laneOffset] : [0];

    if (hasN && hasS) {
      const intN = intersections.has(`${r.x},${r.y - 1}`);
      const intS = intersections.has(`${r.x},${r.y + 1}`);
      for (const off of offsets) {
        if (!intN) markings.push({ x: r.x, z: r.y - 0.375, rotY: 0, offsetPerp: off });
        markings.push({ x: r.x, z: r.y - 0.125, rotY: 0, offsetPerp: off });
        markings.push({ x: r.x, z: r.y + 0.125, rotY: 0, offsetPerp: off });
        if (!intS) markings.push({ x: r.x, z: r.y + 0.375, rotY: 0, offsetPerp: off });
      }
    } else if (hasE && hasW) {
      const intW = intersections.has(`${r.x - 1},${r.y}`);
      const intE = intersections.has(`${r.x + 1},${r.y}`);
      for (const off of offsets) {
        if (!intW) markings.push({ x: r.x - 0.375, z: r.y, rotY: Math.PI / 2, offsetPerp: off });
        markings.push({ x: r.x - 0.125, z: r.y, rotY: Math.PI / 2, offsetPerp: off });
        markings.push({ x: r.x + 0.125, z: r.y, rotY: Math.PI / 2, offsetPerp: off });
        if (!intE) markings.push({ x: r.x + 0.375, z: r.y, rotY: Math.PI / 2, offsetPerp: off });
      }
    }
  }

  return markings;
}
