import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../core/road/types';

const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.7,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};

const SIDEWALK_WIDTH = 0.14;
const SIDEWALK_HEIGHT = 0.04;
const ROAD_Y = 0.025;
const SIDEWALK_Y = 0.05;
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

    this.buildRoadSurface(scene, roadCells);
    this.buildSidewalks(scene, roadCells);
    this.buildLaneMarkings(scene, roadCells);
    this.buildCrosswalkMarkings(scene, roadCells);
    this.buildStopLines(scene, roadCells);
  }

  private buildRoadSurface(scene: THREE.Scene, cells: RoadCell[]): void {
    // Full-width road surface — adjacent cells connect seamlessly
    const geometry = new THREE.BoxGeometry(1, 0.05, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const count = Math.min(cells.length, this.maxRoads);
    this.roadMesh = new THREE.InstancedMesh(geometry, material, count);
    this.roadMesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const r = cells[i]!;
      const w = ROAD_WIDTHS[r.roadType] ?? 0.7;
      const connections = countBits(r.roadFlags);

      // For cells with connections, extend to fill gaps
      let sx = w, sz = w;
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      // Extend road surface toward connected neighbors to eliminate seams
      if (connections >= 1) {
        if (hasN || hasS) sz = 1.0;
        if (hasE || hasW) sx = 1.0;
        // Intersections: fill full cell
        if (connections >= 3) { sx = 1.0; sz = 1.0; }
        // L-bend: fill full cell
        if (connections === 2 && ((hasN || hasS) && (hasE || hasW))) {
          sx = 1.0; sz = 1.0;
        }
      }

      matrix.makeScale(sx, 1, sz);
      matrix.setPosition(r.x, ROAD_Y, r.y);
      this.roadMesh.setMatrixAt(i, matrix);

      // Asphalt color varies by road type
      const cfg = ROAD_CONFIGS[r.roadType as keyof typeof ROAD_CONFIGS];
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

    for (const r of cells) {
      const w = ROAD_WIDTHS[r.roadType] ?? 0.7;
      const half = w / 2;
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      // North edge (z - half)
      if (!hasN) strips.push({ x: r.x, z: r.y - half, sx: w + SIDEWALK_WIDTH * 2, sz: SIDEWALK_WIDTH });
      // South edge (z + half)
      if (!hasS) strips.push({ x: r.x, z: r.y + half, sx: w + SIDEWALK_WIDTH * 2, sz: SIDEWALK_WIDTH });
      // West edge (x - half)
      if (!hasW) strips.push({ x: r.x - half, z: r.y, sx: SIDEWALK_WIDTH, sz: w + SIDEWALK_WIDTH * 2 });
      // East edge (x + half)
      if (!hasE) strips.push({ x: r.x + half, z: r.y, sx: SIDEWALK_WIDTH, sz: w + SIDEWALK_WIDTH * 2 });
    }

    if (strips.length === 0) return;

    const geo = new THREE.BoxGeometry(1, SIDEWALK_HEIGHT, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    const count = Math.min(strips.length, this.maxRoads * 4);
    this.sidewalkMesh = new THREE.InstancedMesh(geo, mat, count);
    this.sidewalkMesh.receiveShadow = true;

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
    // Dashed center lines for straight road segments (skip cells adjacent to intersections)
    type Marking = { x: number; z: number; rotY: number };
    const markings: Marking[] = [];

    // Build set of intersection positions to check neighbors
    const cellMap = new Map<string, RoadCell>();
    const intersections = new Set<string>();
    for (const c of cells) {
      cellMap.set(`${c.x},${c.y}`, c);
      if (countBits(c.roadFlags) >= 3) intersections.add(`${c.x},${c.y}`);
    }

    for (const r of cells) {
      const connections = countBits(r.roadFlags);
      if (connections !== 2) continue;

      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;

      // Only straight segments (N+S or E+W) — 4 dashes per cell (uniform 0.15 gaps)
      // Only skip outermost dash facing intersection (crosswalk overlap); keep inner dash near stop line
      if (hasN && hasS) {
        const intN = intersections.has(`${r.x},${r.y - 1}`);
        const intS = intersections.has(`${r.x},${r.y + 1}`);
        if (!intN) markings.push({ x: r.x, z: r.y - 0.375, rotY: 0 });
        markings.push({ x: r.x, z: r.y - 0.125, rotY: 0 });
        markings.push({ x: r.x, z: r.y + 0.125, rotY: 0 });
        if (!intS) markings.push({ x: r.x, z: r.y + 0.375, rotY: 0 });
      } else if (hasE && hasW) {
        const intW = intersections.has(`${r.x - 1},${r.y}`);
        const intE = intersections.has(`${r.x + 1},${r.y}`);
        if (!intW) markings.push({ x: r.x - 0.375, z: r.y, rotY: Math.PI / 2 });
        markings.push({ x: r.x - 0.125, z: r.y, rotY: Math.PI / 2 });
        markings.push({ x: r.x + 0.125, z: r.y, rotY: Math.PI / 2 });
        if (!intE) markings.push({ x: r.x + 0.375, z: r.y, rotY: Math.PI / 2 });
      }
    }

    if (markings.length === 0) return;

    // Dashed center line: ~12cm wide, ~1.2m long per dash
    const geo = new THREE.BoxGeometry(0.01, 0.005, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    const count = Math.min(markings.length, this.maxRoads);
    this.markingMesh = new THREE.InstancedMesh(geo, mat, count);

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      const m = markings[i]!;
      matrix.makeTranslation(m.x, MARKING_Y, m.z);
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
    const cwOffset = 0.35;

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
    const mat = new THREE.MeshBasicMaterial({ color: 0xbbbbbb });
    const count = Math.min(strips.length, this.maxRoads * 4);
    this.crosswalkMesh = new THREE.InstancedMesh(geo, mat, count);

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
    const mat = new THREE.MeshBasicMaterial({ color: 0xbbbbbb });
    const count = Math.min(lines.length, this.maxRoads * 4);
    this.stopLineMesh = new THREE.InstancedMesh(geo, mat, count);

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

  dispose(scene: THREE.Scene): void {
    const meshes = [this.roadMesh, this.sidewalkMesh, this.markingMesh, this.crosswalkMesh, this.stopLineMesh];
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
  }
}
