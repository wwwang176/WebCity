import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../core/road/types';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';
import { injectHighlightShader, addHighlightAttribute } from './HighlightManager';
import { SIDEWALK_WIDTH, CW_OFFSET } from '../core/traffic/SidewalkGraph';

export const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};

const ROAD_Y = 0.025;
const SIDEWALK_Y = 0.028;
const MARKING_Y = 0.052;

interface RoadCell {
  x: number;
  y: number;
  roadType: number;
  roadFlags: number;
}

function countBits(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

export class RoadRenderer {
  private roadMesh: THREE.InstancedMesh | null = null;
  private sidewalkMesh: THREE.InstancedMesh | null = null;
  private markingMesh: THREE.InstancedMesh | null = null;
  private crosswalkMesh: THREE.InstancedMesh | null = null;
  private stopLineMesh: THREE.InstancedMesh | null = null;
  private lampMesh: THREE.InstancedMesh | null = null;
  private lampGlowMesh: THREE.InstancedMesh | null = null;
  private lampGlowMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly maxRoads = 10000;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const roadCells: RoadCell[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.roadType !== RoadType.NONE) {
          roadCells.push({ x, y, roadType: cell.roadType, roadFlags: cell.roadFlags });
        }
      }
    }

    if (roadCells.length === 0) return;

    this.buildRoadSurface(scene, roadCells, grid.width, grid.height);
    this.buildSidewalks(scene, roadCells);
    this.buildLaneMarkings(scene, roadCells);
    this.buildCrosswalkMarkings(scene, roadCells);
    this.buildStopLines(scene, roadCells);
    this.buildStreetLamps(scene, roadCells);
  }

  /** Length of the visual road extension beyond the map edge. */
  private static readonly EDGE_EXTEND = 0.5;

  private buildRoadSurface(scene: THREE.Scene, cells: RoadCell[], mapW: number, mapH: number): void {
    // Two-strip method: each cell emits 1-2 strips whose width comes from
    // the neighboring road type in that axis, so mixed intersections (e.g.
    // 4-lane × 2-lane) naturally become rectangular.
    type Strip = { x: number; z: number; sx: number; sz: number; roadType: number };
    const strips: Strip[] = [];

    // Lookup map for neighbor road types
    const cellMap = new Map<string, RoadCell>();
    for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

    for (const r of cells) {
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;
      const hasVert = hasN || hasS;
      const hasHoriz = hasE || hasW;

      // Determine per-axis width. Intersections (≥3 directions) use neighbor
      // road types so mixed intersections (e.g. 4-lane × 2-lane) become rectangular.
      // Straight/curve segments (≤2 directions) use their own width to prevent
      // curb jumps when adjacent to a wider intersection.
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

      // Vertical (N-S) strip — width from vertical neighbors
      if (hasVert || !hasHoriz) {
        const w = hasVert ? vertW : ownW;
        const half = w / 2;
        const zMin = hasN ? -0.5 : -half;
        const zMax = hasS ? 0.5 : half;
        strips.push({ x: r.x, z: r.y + (zMin + zMax) / 2, sx: w, sz: zMax - zMin, roadType: r.roadType });
      }

      // Horizontal (E-W) strip — width from horizontal neighbors
      if (hasHoriz) {
        const w = horizW;
        const half = w / 2;
        const xMin = hasW ? -0.5 : -half;
        const xMax = hasE ? 0.5 : half;
        strips.push({ x: r.x + (xMin + xMax) / 2, z: r.y, sx: xMax - xMin, sz: w, roadType: r.roadType });
      }

      // Edge extension: if road cell is at map border with outward flag, extend 0.5 beyond
      const ext = RoadRenderer.EDGE_EXTEND;
      if (r.y === 0 && hasN) {
        strips.push({ x: r.x, z: r.y - 0.5 - ext / 2, sx: ownW, sz: ext, roadType: r.roadType });
      }
      if (r.y === mapH - 1 && hasS) {
        strips.push({ x: r.x, z: r.y + 0.5 + ext / 2, sx: ownW, sz: ext, roadType: r.roadType });
      }
      if (r.x === 0 && hasW) {
        strips.push({ x: r.x - 0.5 - ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType });
      }
      if (r.x === mapW - 1 && hasE) {
        strips.push({ x: r.x + 0.5 + ext / 2, z: r.y, sx: ext, sz: ownW, roadType: r.roadType });
      }
    }

    if (strips.length === 0) return;

    const geometry = new THREE.BoxGeometry(1, 0.05, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    injectHighlightShader(material);
    const count = Math.min(strips.length, this.maxRoads * 2);
    this.roadMesh = new THREE.InstancedMesh(geometry, material, count);
    addHighlightAttribute(this.roadMesh);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const s = strips[i]!;

      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, ROAD_Y, s.z);
      this.roadMesh.setMatrixAt(i, matrix);

      // Asphalt color varies by road type
      const cfg = ROAD_CONFIGS[s.roadType as keyof typeof ROAD_CONFIGS];
      const base = cfg ? Math.max(0.18, 0.30 - cfg.lanes * 0.02) : 0.25;
      color.setRGB(base, base, base + 0.01);
      this.roadMesh.setColorAt(i, color);
    }

    this.roadMesh.instanceMatrix.needsUpdate = true;
    if (this.roadMesh.instanceColor) this.roadMesh.instanceColor.needsUpdate = true;
    scene.add(this.roadMesh);
  }

  private buildSidewalks(scene: THREE.Scene, cells: RoadCell[]): void {
    // Sidewalk strips on edges that don't connect to another road
    type Strip = { x: number; z: number; sx: number; sz: number };
    const strips: Strip[] = [];

    const cellMap = new Map<string, RoadCell>();
    for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

    for (const r of cells) {
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      // Per-axis width: intersections use neighbor types, straight segments use own type
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

      // N/S sidewalks use horizW (horizontal road width), E/W use vertW
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

    if (strips.length === 0) return;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2); // lay flat
    const mat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    injectHighlightShader(mat);
    const count = Math.min(strips.length, this.maxRoads * 4);
    this.sidewalkMesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(this.sidewalkMesh);
    this.sidewalkMesh.receiveShadow = true;
    this.sidewalkMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = strips[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, SIDEWALK_Y, s.z);
      this.sidewalkMesh.setMatrixAt(i, matrix);
    }

    this.sidewalkMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.sidewalkMesh);
  }

  private buildLaneMarkings(scene: THREE.Scene, cells: RoadCell[]): void {
    // Lane markings differ by road type:
    // RURAL: no markings
    // TWO_LANE: dashed center line
    // FOUR_LANE: 3 lines (left lane divider + center line + right lane divider)
    type Marking = { x: number; z: number; rotY: number; offsetPerp: number };
    const markings: Marking[] = [];

    // Build set of intersection positions to check neighbors
    const cellMap = new Map<string, RoadCell>();
    const intersections = new Set<string>();
    for (const c of cells) {
      cellMap.set(`${c.x},${c.y}`, c);
      if (countBits(c.roadFlags) >= 3) intersections.add(`${c.x},${c.y}`);
    }

    for (const r of cells) {
      // Skip RURAL roads — no lane markings
      if (r.roadType === RoadType.RURAL) continue;

      const connections = countBits(r.roadFlags);
      if (connections !== 2) continue;

      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      const isFourLane = r.roadType === RoadType.FOUR_LANE || r.roadType === RoadType.SIX_LANE;
      const w = ROAD_WIDTHS[r.roadType] ?? 0.7;
      // For FOUR_LANE: lane offsets at +/- quarter-width from center
      const laneOffset = w / 4;

      // Perpendicular offsets for the lines we want to draw
      // TWO_LANE: [0] (center only)
      // FOUR_LANE: [-laneOffset, 0, +laneOffset] (left divider, center, right divider)
      const offsets = isFourLane ? [-laneOffset, 0, laneOffset] : [0];

      // Only straight segments (N+S or E+W) — 4 dashes per cell
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

    if (markings.length === 0) return;

    // Dashed center line: ~12cm wide, ~1.2m long per dash
    const geo = new THREE.BoxGeometry(0.01, 0.005, 0.1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    injectHighlightShader(mat);
    const count = Math.min(markings.length, this.maxRoads * 3);
    this.markingMesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(this.markingMesh);
    this.markingMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      const m = markings[i]!;
      // Apply perpendicular offset: for N-S road (rotY=0), offset is in X; for E-W (rotY=PI/2), offset is in Z
      const perpX = m.rotY === 0 ? m.offsetPerp : 0;
      const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;
      matrix.makeTranslation(m.x + perpX, MARKING_Y, m.z + perpZ);
      if (m.rotY !== 0) {
        rot.makeRotationY(m.rotY);
        matrix.multiply(rot);
      }
      this.markingMesh.setMatrixAt(i, matrix);
    }

    this.markingMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.markingMesh);
  }

  private buildCrosswalkMarkings(scene: THREE.Scene, cells: RoadCell[]): void {
    // Crosswalks go on the neighboring cells that connect INTO an intersection
    type CWStrip = { x: number; z: number; sx: number; sz: number };
    const strips: CWStrip[] = [];

    // Build lookup for quick neighbor check
    const cellMap = new Map<string, RoadCell>();
    for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

    const stripeCount = 12;
    const stripeGap = 0.042;
    const stripeLen = 0.11;
    // Place stripes near the end of the cell closest to the intersection
    const cwOffset = CW_OFFSET;

    for (const r of cells) {
      const connections = countBits(r.roadFlags);
      if (connections < 3) continue; // only intersections

      // For each direction connected to this intersection,
      // place crosswalk on that neighbor cell, near the intersection end
      const neighbors: [number, number, number, number][] = [
        // [dx, dy, dirFlag, dirFromNeighbor] — neighbor coords & which direction faces intersection
        // N neighbor is at (x, y-1), crosswalk at its south end (z + offset)
        [0, -1, RoadDirection.NORTH, RoadDirection.SOUTH],
        [0,  1, RoadDirection.SOUTH, RoadDirection.NORTH],
        [1,  0, RoadDirection.EAST,  RoadDirection.WEST],
        [-1, 0, RoadDirection.WEST,  RoadDirection.EAST],
      ];

      for (const [dx, dy, dirFlag] of neighbors) {
        if (!(r.roadFlags & dirFlag)) continue;
        const nb = cellMap.get(`${r.x + dx},${r.y + dy}`);
        if (!nb) continue;

        // Crosswalk is perpendicular to the road direction
        if (dx === 0) {
          // Vertical road neighbor — crosswalk is horizontal stripes
          const zPos = nb.y + (-dy) * cwOffset; // near intersection end
          for (let s = 0; s < stripeCount; s++) {
            strips.push({
              x: nb.x - (stripeCount - 1) * stripeGap / 2 + s * stripeGap,
              z: zPos,
              sx: 0.025, sz: stripeLen,
            });
          }
        } else {
          // Horizontal road neighbor — crosswalk is vertical stripes
          const xPos = nb.x + (-dx) * cwOffset;
          for (let s = 0; s < stripeCount; s++) {
            strips.push({
              x: xPos,
              z: nb.y - (stripeCount - 1) * stripeGap / 2 + s * stripeGap,
              sx: stripeLen, sz: 0.025,
            });
          }
        }
      }
    }

    if (strips.length === 0) return;

    const geo = new THREE.BoxGeometry(1, 0.005, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
    injectHighlightShader(mat);
    const count = Math.min(strips.length, this.maxRoads * 4);
    this.crosswalkMesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(this.crosswalkMesh);
    this.crosswalkMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = strips[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, MARKING_Y, s.z);
      this.crosswalkMesh.setMatrixAt(i, matrix);
    }

    this.crosswalkMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.crosswalkMesh);
  }

  private buildStopLines(scene: THREE.Scene, cells: RoadCell[]): void {
    // Stop lines on cells adjacent to intersections (right-hand drive = drive on LEFT)
    // Stop line is on the LEFT half of the road (incoming lane), between crosswalk and intersection
    type StopLine = { x: number; z: number; sx: number; sz: number };
    const lines: StopLine[] = [];

    const cellMap = new Map<string, RoadCell>();
    for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

    // Stop line position: closer to intersection than crosswalk
    // Crosswalk is at cwOffset=0.35 from center, stop line at 0.25 (between crosswalk and intersection)
    const stopOffset = 0.25;
    const halfLane = 0.15; // half the road width for one lane side

    for (const r of cells) {
      const connections = countBits(r.roadFlags);
      if (connections < 3) continue;

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
          // Vertical road: stop line is horizontal, on LEFT side (right-hand drive)
          // Vehicle approaching from south (dy=1): drives on left (x - offset)
          // Vehicle approaching from north (dy=-1): drives on left (x + offset) — wait, right-hand drive means left side of road
          const zPos = nb.y + (-dy) * stopOffset;
          // Right-hand drive: incoming lane is on the LEFT side of the road
          // For N→S traffic (dy=-1, approaching intersection from north): left side = +x
          // For S→N traffic (dy=1, approaching intersection from south): left side = -x
          const laneX = nb.x + dy * halfLane;
          lines.push({ x: laneX, z: zPos, sx: halfLane * 2, sz: 0.012 });
        } else {
          // Horizontal road: stop line is vertical, on LEFT side
          const xPos = nb.x + (-dx) * stopOffset;
          // For W→E traffic (dx=1): left side = -z
          // For E→W traffic (dx=-1): left side = +z
          const laneZ = nb.y - dx * halfLane;
          lines.push({ x: xPos, z: laneZ, sx: 0.012, sz: halfLane * 2 });
        }
      }
    }

    if (lines.length === 0) return;

    const geo = new THREE.BoxGeometry(1, 0.005, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
    injectHighlightShader(mat);
    const count = Math.min(lines.length, this.maxRoads * 4);
    this.stopLineMesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(this.stopLineMesh);
    this.stopLineMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = lines[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, MARKING_Y, s.z);
      this.stopLineMesh.setMatrixAt(i, matrix);
    }

    this.stopLineMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.stopLineMesh);
  }

  private buildStreetLamps(scene: THREE.Scene, cells: RoadCell[]): void {
    type LampPos = { x: number; z: number };
    const lamps: LampPos[] = [];

    for (const r of cells) {
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      const ownW = ROAD_WIDTHS[r.roadType] ?? 0.6;
      const half = ownW / 2 + SIDEWALK_WIDTH / 2;

      // Place lamp on BOTH sides of each open sidewalk edge
      if (!hasN) lamps.push({ x: r.x, z: r.y - half });
      if (!hasS) lamps.push({ x: r.x, z: r.y + half });
      if (!hasW) lamps.push({ x: r.x - half, z: r.y });
      if (!hasE) lamps.push({ x: r.x + half, z: r.y });
    }

    if (lamps.length === 0) return;

    // Lamp pole + head geometry — real street lamp ~8m, 1 cell = 12m → 0.67 units
    const poleH = 0.28;  // ~3.4m pole height
    const pole = new THREE.CylinderGeometry(0.008, 0.01, poleH, 4);
    pole.translate(0, poleH / 2, 0);
    const head = new THREE.SphereGeometry(0.018, 4, 3);
    head.translate(0, poleH + 0.01, 0);
    const merged = mergeGeometries([pole, head]);
    pole.dispose();
    head.dispose();
    if (!merged) return;

    const lampMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    injectHighlightShader(lampMat);
    const count = Math.min(lamps.length, this.maxRoads * 4);
    this.lampMesh = new THREE.InstancedMesh(merged, lampMat, count);
    addHighlightAttribute(this.lampMesh);
    this.lampMesh.castShadow = true;
    this.lampMesh.frustumCulled = false;

    // Ground glow disc with radial gradient (center bright, edges fade out)
    const glowSegs = 12;
    const glowRadius = 0.4;
    const glowGeo = new THREE.CircleGeometry(glowRadius, glowSegs);
    glowGeo.rotateX(-Math.PI / 2);
    // Apply vertex colors: center vertex = white, edge vertices = black
    const posAttr = glowGeo.attributes.position!;
    const vColors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / glowRadius;
      const brightness = Math.max(0, 1 - dist);
      vColors[i * 3] = brightness;
      vColors[i * 3 + 1] = brightness;
      vColors[i * 3 + 2] = brightness;
    }
    glowGeo.setAttribute('color', new THREE.BufferAttribute(vColors, 3));

    this.lampGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdd88,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lampGlowMesh = new THREE.InstancedMesh(glowGeo, this.lampGlowMaterial, count);
    this.lampGlowMesh.frustumCulled = false;
    this.lampGlowMesh.renderOrder = 2;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const p = lamps[i]!;
      matrix.identity();
      matrix.setPosition(p.x, SIDEWALK_Y, p.z);
      this.lampMesh.setMatrixAt(i, matrix);
      matrix.setPosition(p.x, 0.055, p.z);
      this.lampGlowMesh.setMatrixAt(i, matrix);
    }

    this.lampMesh.instanceMatrix.needsUpdate = true;
    this.lampGlowMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.lampMesh);
    scene.add(this.lampGlowMesh);
  }

  private _focusMode = false;

  /** Update street lamp glow based on sun intensity (call each frame). */
  update(sunIntensity: number): void {
    if (!this.lampGlowMaterial) return;
    if (this._focusMode) {
      this.lampGlowMaterial.opacity = 0;
      return;
    }
    this.lampGlowMaterial.opacity = Math.max(0, 0.75 * (1 - sunIntensity / 0.45));
  }

  setViewMode(mode: ViewMode): void {
    const opacity = VIEW_MODE_OPACITY[mode].road;
    const dimmed = opacity < 1.0;
    this._focusMode = dimmed;
    const meshes = [
      this.roadMesh, this.sidewalkMesh, this.markingMesh,
      this.crosswalkMesh, this.stopLineMesh, this.lampMesh,
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (dimmed) {
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = false;
        mat.color.set(0xcccccc);
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      }
      mesh.renderOrder = dimmed ? 20 : 0;
    }
    if (this.lampGlowMesh) {
      this.lampGlowMesh.visible = !dimmed;
    }
  }

  /** @deprecated Use setViewMode instead. */
  setUndergroundMode(enabled: boolean): void {
    this.setViewMode(enabled ? ViewMode.UNDERGROUND : ViewMode.NORMAL);
  }

  /** Cached highlight meshes (invalidated on build/dispose). */
  private _highlightCache: THREE.InstancedMesh[] = [];
  private _highlightDirty = true;

  /** All InstancedMeshes with highlight support (for HighlightManager). */
  get highlightMeshes(): readonly THREE.InstancedMesh[] {
    if (this._highlightDirty) {
      this._highlightDirty = false;
      const arr = this._highlightCache;
      arr.length = 0;
      if (this.roadMesh) arr.push(this.roadMesh);
      if (this.sidewalkMesh) arr.push(this.sidewalkMesh);
      if (this.markingMesh) arr.push(this.markingMesh);
      if (this.crosswalkMesh) arr.push(this.crosswalkMesh);
      if (this.stopLineMesh) arr.push(this.stopLineMesh);
      if (this.lampMesh) arr.push(this.lampMesh);
    }
    return this._highlightCache;
  }

  dispose(scene: THREE.Scene): void {
    const meshes = [
      this.roadMesh, this.sidewalkMesh, this.markingMesh,
      this.crosswalkMesh, this.stopLineMesh, this.lampMesh, this.lampGlowMesh,
    ];
    for (const mesh of meshes) {
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.roadMesh = null;
    this.sidewalkMesh = null;
    this.markingMesh = null;
    this.crosswalkMesh = null;
    this.stopLineMesh = null;
    this.lampMesh = null;
    this.lampGlowMesh = null;
    this.lampGlowMaterial = null;
    this._highlightDirty = true;
  }
}
