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

/** 路寬的家在 `core/road/types`。這裡轉出去，既有的 import 不必動。 */
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
  roadType: number;
  srcX: number;
  srcY: number;
}

export interface SidewalkStrip {
  x: number;
  z: number;
  sx: number;
  sz: number;
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
      strips.push({ x: r.x, z: r.y + (zMin + zMax) / 2, sx: w, sz: zMax - zMin, roadType: r.roadType, srcX: r.x, srcY: r.y });
    }

    // Horizontal (E-W) strip
    if (hasHoriz) {
      const w = horizW;
      const half = w / 2;
      const xMin = hasW ? -0.5 : -half;
      const xMax = hasE ? 0.5 : half;
      strips.push({ x: r.x + (xMin + xMax) / 2, z: r.y, sx: xMax - xMin, sz: w, roadType: r.roadType, srcX: r.x, srcY: r.y });
    }

    // Edge extension
    if (edgeExtend > 0 && mapW > 0 && mapH > 0) {
      const ext = edgeExtend;
      if (r.y === 0 && hasN) strips.push({ x: r.x, z: r.y - 0.5 - ext / 2, sx: ownW, sz: ext, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.y === mapH - 1 && hasS) strips.push({ x: r.x, z: r.y + 0.5 + ext / 2, sx: ownW, sz: ext, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.x === 0 && hasW) strips.push({ x: r.x - 0.5 - ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType, srcX: r.x, srcY: r.y });
      if (r.x === mapW - 1 && hasE) strips.push({ x: r.x + 0.5 + ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType, srcX: r.x, srcY: r.y });
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

    if (!hasN) strips.push({ x: r.x + (re - le) / 2, z: r.y - hHalf, sx: le + re, sz: SIDEWALK_WIDTH, srcX: r.x, srcY: r.y });
    if (!hasS) strips.push({ x: r.x + (re - le) / 2, z: r.y + hHalf, sx: le + re, sz: SIDEWALK_WIDTH, srcX: r.x, srcY: r.y });
    if (!hasW) strips.push({ x: r.x - vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be, srcX: r.x, srcY: r.y });
    if (!hasE) strips.push({ x: r.x + vHalf, z: r.y + (be - te) / 2, sx: SIDEWALK_WIDTH, sz: te + be, srcX: r.x, srcY: r.y });
  }

  return strips;
}

/** 一條虛線在直路上分成幾段。L 形彎是 3 段，所以直路是上限。 */
const DASHES_PER_DIVIDER = 4;

/** 這種路的單向車道之間有幾條虛線（左右兩側合計）。只有一條車道時是中心虛線。 */
function dividerCount(roadType: number): number {
  const lanes = roadType === RoadType.ONE_WAY ? 1 : getLaneCount(roadType);
  return lanes === 1 ? 1 : 2 * (lanes - 1);
}

/**
 * 一格最多畫幾條車道虛線。
 *
 * 兩個 renderer 的 `InstancedMesh` 容量以它為準。**算出來而不是寫死**：
 * `RoadInstanceTracker` 放不下時回傳 −1，呼叫端就整格跳過 —— 超出的虛線是
 * 靜靜地消失，不會報錯。六車道從一格 8 條變成 16 條時就撞上了原本的 14。
 */
export const MAX_LANE_MARKINGS_PER_CELL = DASHES_PER_DIVIDER * Math.max(
  ...Object.keys(ROAD_WIDTHS).map(t => dividerCount(Number(t))),
);

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

    // 虛線畫在相鄰兩條車道之間，位置從 `getLaneWidth` 來 —— 與車道圖同一個
    // 來源。原本是 `路寬/4` 且不管幾車道都只畫一條：四車道剛好對上（兩條車道
    // 時 `w/4` 正好等於車道寬），六車道則是一條虛線配三排車，而且那條線不在
    // 任何兩排車之間。
    //
    // 單行道除外。它所有車道同向，但 `LaneGraph` 把車全排在中心線右側，只用到
    // 半邊路面 —— 車道位置本身還沒對，虛線跟著它畫只會把錯的地方畫出來。維持
    // 原本的中心虛線，等錨點修好再說（TODO.md）。
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
