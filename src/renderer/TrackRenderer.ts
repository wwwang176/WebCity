import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RailType, TrackDirection } from '../core/rail/types';

const TRACK_WIDTH = 0.15;
const RAIL_Y = 0.035;
const TIE_Y = 0.03;
const BALLAST_Y = 0.022;

const RAIL_COLOR = 0x4a4a4a;
const TIE_COLOR = 0x6d4c2a;
const BALLAST_COLOR = 0x8a8478;

interface TrackCell {
  x: number;
  y: number;
  railFlags: number;
}

export class TrackRenderer {
  private railMesh: THREE.InstancedMesh | null = null;
  private tieMesh: THREE.InstancedMesh | null = null;
  private ballastMesh: THREE.InstancedMesh | null = null;
  private readonly maxTracks = 8000;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const trackCells: TrackCell[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.railType !== RailType.NONE) {
          trackCells.push({ x, y, railFlags: cell.railFlags });
        }
      }
    }

    if (trackCells.length === 0) return;

    this.buildBallast(scene, trackCells);
    this.buildRails(scene, trackCells);
    this.buildTies(scene, trackCells);
  }

  /** Ballast (gravel bed) — wide strip under the track. */
  private buildBallast(scene: THREE.Scene, cells: TrackCell[]): void {
    type Strip = { x: number; z: number; sx: number; sz: number };
    const strips: Strip[] = [];
    const ballastW = TRACK_WIDTH + 0.06;

    for (const r of cells) {
      const hasN = (r.railFlags & TrackDirection.NORTH) !== 0;
      const hasS = (r.railFlags & TrackDirection.SOUTH) !== 0;
      const hasE = (r.railFlags & TrackDirection.EAST) !== 0;
      const hasW = (r.railFlags & TrackDirection.WEST) !== 0;
      const hasVert = hasN || hasS;
      const hasHoriz = hasE || hasW;

      if (hasVert || !hasHoriz) {
        const half = ballastW / 2;
        const zMin = hasN ? -0.5 : -half;
        const zMax = hasS ? 0.5 : half;
        strips.push({ x: r.x, z: r.y + (zMin + zMax) / 2, sx: ballastW, sz: zMax - zMin });
      }
      if (hasHoriz) {
        const half = ballastW / 2;
        const xMin = hasW ? -0.5 : -half;
        const xMax = hasE ? 0.5 : half;
        strips.push({ x: r.x + (xMin + xMax) / 2, z: r.y, sx: xMax - xMin, sz: ballastW });
      }
    }

    if (strips.length === 0) return;

    const geo = new THREE.BoxGeometry(1, 0.02, 1);
    const mat = new THREE.MeshLambertMaterial({ color: BALLAST_COLOR });
    const count = Math.min(strips.length, this.maxTracks * 2);
    this.ballastMesh = new THREE.InstancedMesh(geo, mat, count);
    this.ballastMesh.receiveShadow = true;
    this.ballastMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = strips[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, BALLAST_Y, s.z);
      this.ballastMesh.setMatrixAt(i, matrix);
    }

    this.ballastMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.ballastMesh);
  }

  /** Two parallel rails — thin metal strips. */
  private buildRails(scene: THREE.Scene, cells: TrackCell[]): void {
    type Rail = { x: number; z: number; sx: number; sz: number };
    const rails: Rail[] = [];
    const railGauge = TRACK_WIDTH * 0.7; // distance between rails
    const railW = 0.012; // individual rail width

    for (const r of cells) {
      const hasN = (r.railFlags & TrackDirection.NORTH) !== 0;
      const hasS = (r.railFlags & TrackDirection.SOUTH) !== 0;
      const hasE = (r.railFlags & TrackDirection.EAST) !== 0;
      const hasW = (r.railFlags & TrackDirection.WEST) !== 0;
      const hasVert = hasN || hasS;
      const hasHoriz = hasE || hasW;

      if (hasVert || !hasHoriz) {
        const half = railGauge / 2;
        const zMin = hasN ? -0.5 : -half;
        const zMax = hasS ? 0.5 : half;
        const len = zMax - zMin;
        const zMid = r.y + (zMin + zMax) / 2;
        // Left rail
        rails.push({ x: r.x - railGauge / 2, z: zMid, sx: railW, sz: len });
        // Right rail
        rails.push({ x: r.x + railGauge / 2, z: zMid, sx: railW, sz: len });
      }
      if (hasHoriz) {
        const half = railGauge / 2;
        const xMin = hasW ? -0.5 : -half;
        const xMax = hasE ? 0.5 : half;
        const len = xMax - xMin;
        const xMid = r.x + (xMin + xMax) / 2;
        // Top rail
        rails.push({ x: xMid, z: r.y - railGauge / 2, sx: len, sz: railW });
        // Bottom rail
        rails.push({ x: xMid, z: r.y + railGauge / 2, sx: len, sz: railW });
      }
    }

    if (rails.length === 0) return;

    const geo = new THREE.BoxGeometry(1, 0.015, 1);
    const mat = new THREE.MeshLambertMaterial({ color: RAIL_COLOR });
    const count = Math.min(rails.length, this.maxTracks * 4);
    this.railMesh = new THREE.InstancedMesh(geo, mat, count);
    this.railMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = rails[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, RAIL_Y, s.z);
      this.railMesh.setMatrixAt(i, matrix);
    }

    this.railMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.railMesh);
  }

  /** Crossties / sleepers — small brown boxes across the rails. */
  private buildTies(scene: THREE.Scene, cells: TrackCell[]): void {
    type Tie = { x: number; z: number; rotY: number };
    const ties: Tie[] = [];
    const spacing = 0.18; // tie spacing

    for (const r of cells) {
      const hasN = (r.railFlags & TrackDirection.NORTH) !== 0;
      const hasS = (r.railFlags & TrackDirection.SOUTH) !== 0;
      const hasE = (r.railFlags & TrackDirection.EAST) !== 0;
      const hasW = (r.railFlags & TrackDirection.WEST) !== 0;
      const hasVert = hasN || hasS;
      const hasHoriz = hasE || hasW;

      if (hasVert || !hasHoriz) {
        // Ties perpendicular to N-S track (horizontal ties)
        const zStart = r.y - 0.4;
        for (let t = 0; t < 5; t++) {
          ties.push({ x: r.x, z: zStart + t * spacing, rotY: 0 });
        }
      }
      if (hasHoriz) {
        // Ties perpendicular to E-W track (vertical ties)
        const xStart = r.x - 0.4;
        for (let t = 0; t < 5; t++) {
          ties.push({ x: xStart + t * spacing, z: r.y, rotY: Math.PI / 2 });
        }
      }
    }

    if (ties.length === 0) return;

    // Each tie: 0.18 wide × 0.02 tall × 0.03 deep
    const geo = new THREE.BoxGeometry(TRACK_WIDTH + 0.04, 0.015, 0.03);
    const mat = new THREE.MeshLambertMaterial({ color: TIE_COLOR });
    const count = Math.min(ties.length, this.maxTracks * 6);
    this.tieMesh = new THREE.InstancedMesh(geo, mat, count);
    this.tieMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const t = ties[i]!;
      matrix.makeTranslation(t.x, TIE_Y, t.z);
      if (t.rotY !== 0) {
        rot.makeRotationY(t.rotY);
        matrix.multiply(rot);
      }
      this.tieMesh.setMatrixAt(i, matrix);
    }

    this.tieMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.tieMesh);
  }

  /** Switch to underground visual mode (semi-transparent). */
  setUndergroundMode(enabled: boolean): void {
    const meshes = [this.railMesh, this.tieMesh, this.ballastMesh];
    for (const mesh of meshes) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (enabled) {
        mat.transparent = true;
        mat.opacity = 0.15;
        mat.depthWrite = false;
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      }
      mesh.renderOrder = enabled ? 20 : 0;
    }
  }

  dispose(scene: THREE.Scene): void {
    const meshes = [this.railMesh, this.tieMesh, this.ballastMesh];
    for (const mesh of meshes) {
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.railMesh = null;
    this.tieMesh = null;
    this.ballastMesh = null;
  }
}
