import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RailType, TrackDirection } from '../core/rail/types';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';
import { injectHighlightShader, addHighlightAttribute } from './HighlightManager';

/**
 * 碴床的寬度（格）。軌道貼著**格心**畫，所以它佔的是 |z| ≤ TRACK_WIDTH / 2。
 *
 * 匯出是因為火車站的幾何要讓開這條帶：`canPlaceTransportStop` 規定火車站
 * 蓋在 `railType ≠ 0` 的格子上，而 `placeTransportStopOnGrid` 只改
 * buildingId/reserved/zoneType —— 軌道還在，這裡照畫。站房蓋在上面的話，
 * 真的鋼軌會從站房的地板穿出來。
 */
export const TRACK_WIDTH = 0.15;
const RAIL_Y = 0.035;
const TIE_Y = 0.03;
const BALLAST_Y = 0.022;

const RAIL_COLOR = 0x4a4a4a;
const TIE_COLOR = 0x6d4c2a;
const BALLAST_COLOR = 0x8a8478;

// Arc rendering
const ARC_SEGMENTS = 8;
const ARC_R = 0.5;

type ArcType = 'NE' | 'NW' | 'SE' | 'SW';
type DirLabel = 'N' | 'S' | 'E' | 'W';

const ARC_DEFS: Record<ArcType, { cx: number; cz: number; startAngle: number; sweep: number }> = {
  NE: { cx: +0.5, cz: -0.5, startAngle: Math.PI, sweep: -Math.PI / 2 },
  NW: { cx: -0.5, cz: -0.5, startAngle: 0, sweep: +Math.PI / 2 },
  SE: { cx: +0.5, cz: +0.5, startAngle: Math.PI, sweep: +Math.PI / 2 },
  SW: { cx: -0.5, cz: +0.5, startAngle: 0, sweep: -Math.PI / 2 },
};

interface TrackCell { x: number; y: number; railFlags: number }
interface Strip { x: number; z: number; sx: number; sz: number; rotY: number }
interface Tie { x: number; z: number; rotY: number }

/** Length of the visual extension beyond the map edge. */
const EDGE_EXTEND = 0.5;

/** Generate extension strips for a rail cell at the map edge. */
function edgeExtensionStrips(
  cx: number, cz: number, flags: number,
  mapW: number, mapH: number, width: number,
): { ballast: Strip[]; rails: Strip[]; ties: Tie[] } {
  const ballast: Strip[] = [];
  const rails: Strip[] = [];
  const ties: Tie[] = [];
  const gauge = TRACK_WIDTH * 0.7;
  const rw = 0.012;
  const spacing = 0.18;
  const tieCount = Math.floor(EDGE_EXTEND / spacing);

  const extend = (dx: number, dz: number, isVert: boolean) => {
    const ex = cx + dx * (0.5 + EDGE_EXTEND / 2);
    const ez = cz + dz * (0.5 + EDGE_EXTEND / 2);
    if (isVert) {
      ballast.push({ x: ex, z: ez, sx: width, sz: EDGE_EXTEND, rotY: 0 });
      rails.push({ x: ex - gauge / 2, z: ez, sx: rw, sz: EDGE_EXTEND, rotY: 0 });
      rails.push({ x: ex + gauge / 2, z: ez, sx: rw, sz: EDGE_EXTEND, rotY: 0 });
      for (let i = 0; i < tieCount; i++) {
        ties.push({ x: cx, z: cz + dz * (0.6 + i * spacing), rotY: 0 });
      }
    } else {
      ballast.push({ x: ex, z: ez, sx: EDGE_EXTEND, sz: width, rotY: 0 });
      rails.push({ x: ex, z: ez - gauge / 2, sx: EDGE_EXTEND, sz: rw, rotY: 0 });
      rails.push({ x: ex, z: ez + gauge / 2, sx: EDGE_EXTEND, sz: rw, rotY: 0 });
      for (let i = 0; i < tieCount; i++) {
        ties.push({ x: cx + dx * (0.6 + i * spacing), z: cz, rotY: Math.PI / 2 });
      }
    }
  };

  if (cz === 0 && (flags & TrackDirection.NORTH)) extend(0, -1, true);
  if (cz === mapH - 1 && (flags & TrackDirection.SOUTH)) extend(0, 1, true);
  if (cx === 0 && (flags & TrackDirection.WEST)) extend(-1, 0, false);
  if (cx === mapW - 1 && (flags & TrackDirection.EAST)) extend(1, 0, false);

  return { ballast, rails, ties };
}

// ── Decomposition ──────────────────────────────────────────

export function decomposeFlags(flags: number) {
  const hasN = (flags & TrackDirection.NORTH) !== 0;
  const hasS = (flags & TrackDirection.SOUTH) !== 0;
  const hasE = (flags & TrackDirection.EAST) !== 0;
  const hasW = (flags & TrackDirection.WEST) !== 0;

  const straights: ('NS' | 'EW')[] = [];
  const arcs: ArcType[] = [];
  const used = { N: false, S: false, E: false, W: false };

  if (hasN && hasS) { straights.push('NS'); used.N = used.S = true; }
  if (hasE && hasW) { straights.push('EW'); used.E = used.W = true; }

  if (hasN && hasE) { arcs.push('NE'); used.N = used.E = true; }
  if (hasN && hasW) { arcs.push('NW'); used.N = used.W = true; }
  if (hasS && hasE) { arcs.push('SE'); used.S = used.E = true; }
  if (hasS && hasW) { arcs.push('SW'); used.S = used.W = true; }

  const orphans: DirLabel[] = [];
  if (hasN && !used.N) orphans.push('N');
  if (hasS && !used.S) orphans.push('S');
  if (hasE && !used.E) orphans.push('E');
  if (hasW && !used.W) orphans.push('W');

  return { straights, arcs, orphans };
}

// ── Geometry helpers ───────────────────────────────────────

function getArcPoints(cx: number, cz: number, arc: typeof ARC_DEFS[ArcType], radius: number): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const a = arc.startAngle + (i / ARC_SEGMENTS) * arc.sweep;
    pts.push({ x: cx + arc.cx + radius * Math.cos(a), z: cz + arc.cz + radius * Math.sin(a) });
  }
  return pts;
}

function pointsToStrips(pts: Array<{ x: number; z: number }>, width: number): Strip[] {
  const out: Strip[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!;
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    out.push({
      x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2,
      sx: width, sz: len + 0.003,
      rotY: Math.atan2(dx, dz),
    });
  }
  return out;
}

function orphanBallast(cx: number, cz: number, dir: DirLabel, w: number): Strip {
  switch (dir) {
    case 'N': return { x: cx, z: cz - 0.25, sx: w, sz: 0.5, rotY: 0 };
    case 'S': return { x: cx, z: cz + 0.25, sx: w, sz: 0.5, rotY: 0 };
    case 'E': return { x: cx + 0.25, z: cz, sx: 0.5, sz: w, rotY: 0 };
    case 'W': return { x: cx - 0.25, z: cz, sx: 0.5, sz: w, rotY: 0 };
  }
}

function orphanRails(cx: number, cz: number, dir: DirLabel, gauge: number, rw: number): Strip[] {
  const g = gauge / 2;
  switch (dir) {
    case 'N': return [
      { x: cx - g, z: cz - 0.25, sx: rw, sz: 0.5, rotY: 0 },
      { x: cx + g, z: cz - 0.25, sx: rw, sz: 0.5, rotY: 0 },
    ];
    case 'S': return [
      { x: cx - g, z: cz + 0.25, sx: rw, sz: 0.5, rotY: 0 },
      { x: cx + g, z: cz + 0.25, sx: rw, sz: 0.5, rotY: 0 },
    ];
    case 'E': return [
      { x: cx + 0.25, z: cz - g, sx: 0.5, sz: rw, rotY: 0 },
      { x: cx + 0.25, z: cz + g, sx: 0.5, sz: rw, rotY: 0 },
    ];
    case 'W': return [
      { x: cx - 0.25, z: cz - g, sx: 0.5, sz: rw, rotY: 0 },
      { x: cx - 0.25, z: cz + g, sx: 0.5, sz: rw, rotY: 0 },
    ];
  }
}

function orphanTies(cx: number, cz: number, dir: DirLabel): Tie[] {
  switch (dir) {
    case 'N': return [{ x: cx, z: cz - 0.35, rotY: 0 }, { x: cx, z: cz - 0.17, rotY: 0 }];
    case 'S': return [{ x: cx, z: cz + 0.17, rotY: 0 }, { x: cx, z: cz + 0.35, rotY: 0 }];
    case 'E': return [{ x: cx + 0.17, z: cz, rotY: Math.PI / 2 }, { x: cx + 0.35, z: cz, rotY: Math.PI / 2 }];
    case 'W': return [{ x: cx - 0.35, z: cz, rotY: Math.PI / 2 }, { x: cx - 0.17, z: cz, rotY: Math.PI / 2 }];
  }
}

// ── Renderer ───────────────────────────────────────────────

export class TrackRenderer {
  private railMesh: THREE.InstancedMesh | null = null;
  private tieMesh: THREE.InstancedMesh | null = null;
  private ballastMesh: THREE.InstancedMesh | null = null;
  private readonly maxInstances = 32000;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const cells: TrackCell[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.railType !== RailType.NONE) {
          cells.push({ x, y, railFlags: cell.railFlags });
        }
      }
    }
    if (cells.length === 0) return;

    // Collect edge extensions for all edge rail cells
    const extBallast: Strip[] = [];
    const extRails: Strip[] = [];
    const extTies: Tie[] = [];
    const w = TRACK_WIDTH + 0.06;
    for (const c of cells) {
      const ext = edgeExtensionStrips(c.x, c.y, c.railFlags, grid.width, grid.height, w);
      extBallast.push(...ext.ballast);
      extRails.push(...ext.rails);
      extTies.push(...ext.ties);
    }

    this.buildBallast(scene, cells, extBallast);
    this.buildRails(scene, cells, extRails);
    this.buildTies(scene, cells, extTies);
  }

  // ── Ballast ────────────────────────────────────────────

  private buildBallast(scene: THREE.Scene, cells: TrackCell[], extensions: Strip[]): void {
    const strips: Strip[] = [];
    const w = TRACK_WIDTH + 0.06;

    for (const c of cells) {
      const { straights, arcs, orphans } = decomposeFlags(c.railFlags);

      for (const s of straights) {
        if (s === 'NS') strips.push({ x: c.x, z: c.y, sx: w, sz: 1.0, rotY: 0 });
        else strips.push({ x: c.x, z: c.y, sx: 1.0, sz: w, rotY: 0 });
      }
      for (const arc of arcs) {
        strips.push(...pointsToStrips(getArcPoints(c.x, c.y, ARC_DEFS[arc], ARC_R), w));
      }
      for (const dir of orphans) {
        strips.push(orphanBallast(c.x, c.y, dir, w));
      }
    }
    strips.push(...extensions);

    if (strips.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 0.02, 1);
    const mat = new THREE.MeshLambertMaterial({ color: BALLAST_COLOR });
    this.ballastMesh = this.fillMesh(scene, strips, geo, mat, BALLAST_Y);
    this.ballastMesh.receiveShadow = true;
  }

  // ── Rails ──────────────────────────────────────────────

  private buildRails(scene: THREE.Scene, cells: TrackCell[], extensions: Strip[]): void {
    const strips: Strip[] = [];
    const gauge = TRACK_WIDTH * 0.7;
    const rw = 0.012;

    for (const c of cells) {
      const { straights, arcs, orphans } = decomposeFlags(c.railFlags);

      for (const s of straights) {
        if (s === 'NS') {
          strips.push({ x: c.x - gauge / 2, z: c.y, sx: rw, sz: 1.0, rotY: 0 });
          strips.push({ x: c.x + gauge / 2, z: c.y, sx: rw, sz: 1.0, rotY: 0 });
        } else {
          strips.push({ x: c.x, z: c.y - gauge / 2, sx: 1.0, sz: rw, rotY: 0 });
          strips.push({ x: c.x, z: c.y + gauge / 2, sx: 1.0, sz: rw, rotY: 0 });
        }
      }
      for (const arc of arcs) {
        const def = ARC_DEFS[arc];
        strips.push(...pointsToStrips(getArcPoints(c.x, c.y, def, ARC_R - gauge / 2), rw));
        strips.push(...pointsToStrips(getArcPoints(c.x, c.y, def, ARC_R + gauge / 2), rw));
      }
      for (const dir of orphans) {
        strips.push(...orphanRails(c.x, c.y, dir, gauge, rw));
      }
    }
    strips.push(...extensions);

    if (strips.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 0.015, 1);
    const mat = new THREE.MeshLambertMaterial({ color: RAIL_COLOR });
    this.railMesh = this.fillMesh(scene, strips, geo, mat, RAIL_Y);
  }

  // ── Ties ───────────────────────────────────────────────

  private buildTies(scene: THREE.Scene, cells: TrackCell[], extensions: Tie[]): void {
    const ties: Tie[] = [];
    const spacing = 0.18;

    for (const c of cells) {
      const { straights, arcs, orphans } = decomposeFlags(c.railFlags);

      for (const s of straights) {
        if (s === 'NS') {
          for (let t = 0; t < 5; t++) ties.push({ x: c.x, z: c.y - 0.4 + t * spacing, rotY: 0 });
        } else {
          for (let t = 0; t < 5; t++) ties.push({ x: c.x - 0.4 + t * spacing, z: c.y, rotY: Math.PI / 2 });
        }
      }
      for (const arc of arcs) {
        const def = ARC_DEFS[arc];
        const arcLen = ARC_R * Math.abs(def.sweep);
        const n = Math.max(2, Math.floor(arcLen / spacing));
        for (let i = 0; i < n; i++) {
          const a = def.startAngle + ((i + 0.5) / n) * def.sweep;
          ties.push({
            x: c.x + def.cx + ARC_R * Math.cos(a),
            z: c.y + def.cz + ARC_R * Math.sin(a),
            rotY: -a,
          });
        }
      }
      for (const dir of orphans) {
        ties.push(...orphanTies(c.x, c.y, dir));
      }
    }
    ties.push(...extensions);

    if (ties.length === 0) return;

    const geo = new THREE.BoxGeometry(TRACK_WIDTH + 0.04, 0.015, 0.03);
    const mat = new THREE.MeshLambertMaterial({ color: TIE_COLOR });
    injectHighlightShader(mat);
    const count = Math.min(ties.length, this.maxInstances);
    this.tieMesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(this.tieMesh);
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

  // ── Shared helpers ─────────────────────────────────────

  private fillMesh(
    scene: THREE.Scene, strips: Strip[],
    geo: THREE.BoxGeometry, mat: THREE.MeshLambertMaterial, y: number,
  ): THREE.InstancedMesh {
    injectHighlightShader(mat);
    const count = Math.min(strips.length, this.maxInstances);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    addHighlightAttribute(mesh);
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = strips[i]!;
      if (s.rotY === 0) {
        matrix.makeScale(s.sx, 1, s.sz);
      } else {
        matrix.makeRotationY(s.rotY);
        matrix.scale(new THREE.Vector3(s.sx, 1, s.sz));
      }
      matrix.setPosition(s.x, y, s.z);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  // ── Underground / Dispose ──────────────────────────────

  setViewMode(mode: ViewMode): void {
    const opacity = VIEW_MODE_OPACITY[mode].track;
    const dimmed = opacity < 1.0;
    const meshes = [this.railMesh, this.tieMesh, this.ballastMesh];
    for (const mesh of meshes) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (dimmed) {
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = false;
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      }
      mesh.renderOrder = dimmed ? 20 : 0;
    }
  }

  /** All InstancedMeshes with highlight support (for HighlightManager). */
  private _highlightCache: THREE.InstancedMesh[] = [];
  private _highlightDirty = true;

  get highlightMeshes(): readonly THREE.InstancedMesh[] {
    if (this._highlightDirty) {
      this._highlightDirty = false;
      const arr = this._highlightCache;
      arr.length = 0;
      if (this.railMesh) arr.push(this.railMesh);
      if (this.tieMesh) arr.push(this.tieMesh);
      if (this.ballastMesh) arr.push(this.ballastMesh);
    }
    return this._highlightCache;
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
    this._highlightDirty = true;
  }
}
