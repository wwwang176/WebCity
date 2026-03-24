import * as THREE from 'three';
import { getInfraConfig, getRotatedSize, type InfraType, type Rotation } from '../core/building/InfraConfig';
import { canPlaceInfra } from '../core/building/InfraPlacement';
import { Grid } from '../core/grid/Grid';
import type { BuildingRenderer } from './BuildingRenderer';
import { buildRoadStrips, buildSidewalkStrips, ROAD_WIDTHS, type RoadCell } from './RoadStripBuilder';
import { RoadDirection } from '../core/road/types';

const GREEN = 0x00ff00;
const RED = 0xff0000;
const GHOST_OPACITY = 0.35;

const LEVEL_HEIGHT = 0.6;
const ROAD_Y = 0.025;
const SIDEWALK_Y = 0.028;
const RAMP_ANGLE = Math.atan2(LEVEL_HEIGHT, 1.0);
const RAMP_LENGTH = Math.sqrt(1.0 + LEVEL_HEIGHT * LEVEL_HEIGHT);

/** Coverage overlay entry: position + normalized cost ratio (0 = near, 1 = far). */
export interface CoverageCell { x: number; y: number; ratio: number }

// 10-tier gradient: green → yellow → red (pre-computed)
const COV_GRADIENT: THREE.Color[] = (() => {
  const near = new THREE.Color(0x00e676);
  const mid = new THREE.Color(0xffeb3b);
  const far = new THREE.Color(0xff5252);
  const out: THREE.Color[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const c = new THREE.Color();
    if (t < 0.5) c.copy(near).lerp(mid, t * 2);
    else c.copy(mid).lerp(far, (t - 0.5) * 2);
    out.push(c);
  }
  return out;
})();

function ratioToColor(ratio: number): THREE.Color {
  const idx = Math.min(9, Math.floor(ratio * 10));
  return COV_GRADIENT[idx]!;
}

export class PlacementPreview {
  private group: THREE.Group | null = null;
  private scene: THREE.Scene;
  private buildingRenderer: BuildingRenderer;
  private currentType: string | null = null;
  private currentRotation: Rotation = 0;
  private material: THREE.MeshBasicMaterial;

  // Coverage overlay (per-cell colored InstancedMesh)
  private coverageOverlay: THREE.InstancedMesh | null = null;
  private coverageGridX = -1;
  private coverageGridY = -1;
  private getElevation: (x: number, y: number) => number;

  constructor(scene: THREE.Scene, buildingRenderer: BuildingRenderer, getElevation?: (x: number, y: number) => number) {
    this.scene = scene;
    this.buildingRenderer = buildingRenderer;
    this.getElevation = getElevation ?? (() => 0);
    this.material = new THREE.MeshBasicMaterial({
      color: GREEN,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Update the ghost preview for the current tool.
   * Called every frame when an infrastructure tool is active.
   */
  updateInfra(
    type: InfraType,
    rotation: Rotation,
    gridX: number,
    gridY: number,
    grid: Grid,
    funds: number,
    groundwaterFn?: (x: number, y: number) => number,
  ): void {
    const cfg = getInfraConfig(type);
    if (!cfg) { this.hide(); return; }

    // Rebuild ghost mesh if type changed
    if (this.currentType !== type) {
      this.rebuildGhost(type);
    }

    if (!this.group) return;

    // Position at cursor — all infra uses top-left-based placement
    const { w, h } = getRotatedSize(cfg.width, cfg.height, rotation);
    const offsetX = (w - 1) / 2;
    const offsetZ = (h - 1) / 2;
    this.group.position.set(gridX + offsetX, 0, gridY + offsetZ);

    // Apply rotation to the ghost model
    this.group.rotation.y = (rotation * Math.PI) / 180;
    this.currentRotation = rotation;

    // Check placement validity
    const check = canPlaceInfra(grid, gridX, gridY, type, rotation, groundwaterFn);
    const valid = check.ok && funds >= cfg.cost;

    this.material.color.set(valid ? GREEN : RED);
    this.group.visible = true;
  }

  /** Show a simple box preview for zone dragging. */
  updateZoneDrag(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.disposeGhost();
    this.currentType = '__zone_drag__';
    this.currentRotation = 0;

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    this.group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.group.position.set(minX + (w - 1) / 2, 0.12, minY + (h - 1) / 2);
    this.scene.add(this.group);
  }

  /** Show demolish highlight for multi-cell buildings. */
  updateDemolishHighlight(cells: { x: number; y: number }[]): void {
    this.disposeGhost();
    this.currentType = '__demolish__';
    this.currentRotation = 0;

    if (cells.length <= 1) { return; } // 1×1 uses default cursor

    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const cell of cells) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cell.x, 0.16, cell.y);
      this.group.add(mesh);
    }

    this.scene.add(this.group);
  }

  /** Show road drag preview using real road geometry (strips + sidewalks). */
  updateRoadDrag(
    cells: RoadCell[],
    rampCells?: { x: number; y: number; level: number; ascendDir: number; roadType: number }[],
    baseY = 0,
  ): void {
    this.disposeGhost();
    this.currentType = '__road_drag__';
    this.currentRotation = 0;

    if (cells.length < 1) return;

    this.group = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x888888, transparent: true, opacity: GHOST_OPACITY, depthWrite: false,
    });
    const sidewalkMat = new THREE.MeshBasicMaterial({
      color: 0xaaaaaa, transparent: true, opacity: GHOST_OPACITY, depthWrite: false,
    });

    // --- Flat road surface ---
    const strips = buildRoadStrips(cells);
    if (strips.length > 0) {
      const geo = new THREE.BoxGeometry(1, 0.05, 1);
      const matrix = new THREE.Matrix4();
      for (const s of strips) {
        const m = new THREE.Mesh(geo, ghostMat);
        matrix.makeScale(s.sx, 1, s.sz);
        matrix.setPosition(s.x, baseY + ROAD_Y, s.z);
        m.applyMatrix4(matrix);
        this.group.add(m);
      }
    }

    // --- Flat sidewalks ---
    const swStrips = buildSidewalkStrips(cells);
    if (swStrips.length > 0) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const matrix = new THREE.Matrix4();
      for (const s of swStrips) {
        const m = new THREE.Mesh(geo, sidewalkMat);
        matrix.makeScale(s.sx, 1, s.sz);
        matrix.setPosition(s.x, baseY + SIDEWALK_Y, s.z);
        m.applyMatrix4(matrix);
        this.group.add(m);
      }
    }

    // --- Ramp surfaces ---
    if (rampCells && rampCells.length > 0) {
      const rampGeo = new THREE.BoxGeometry(1, 0.05, 1);
      const scale = new THREE.Matrix4();
      const rot = new THREE.Matrix4();
      const combined = new THREE.Matrix4();

      for (const rc of rampCells) {
        const w = ROAD_WIDTHS[rc.roadType] ?? 0.6;
        const midY = (rc.level - 0.5) * LEVEL_HEIGHT + ROAD_Y;
        const isNS = (rc.ascendDir & (RoadDirection.NORTH | RoadDirection.SOUTH)) !== 0;
        const sx = isNS ? w : RAMP_LENGTH;
        const sz = isNS ? RAMP_LENGTH : w;

        combined.identity();
        scale.makeScale(sx, 1, sz);
        combined.multiply(scale);

        const tiltX = (rc.ascendDir & RoadDirection.NORTH) ? RAMP_ANGLE
          : (rc.ascendDir & RoadDirection.SOUTH) ? -RAMP_ANGLE : 0;
        const tiltZ = (rc.ascendDir & RoadDirection.EAST) ? RAMP_ANGLE
          : (rc.ascendDir & RoadDirection.WEST) ? -RAMP_ANGLE : 0;
        if (tiltX !== 0) { rot.makeRotationX(tiltX); combined.premultiply(rot); }
        if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); combined.premultiply(rot); }

        combined.setPosition(rc.x, midY, rc.y);
        const m = new THREE.Mesh(rampGeo, ghostMat);
        m.applyMatrix4(combined);
        this.group.add(m);
      }
    }

    this.scene.add(this.group);
  }

  /**
   * Show per-building coverage overlay. Only rebuilds when cursor grid position changes.
   * @param cells Pre-filtered building cells with normalized cost ratio (0 near, 1 far).
   */
  updateCoverageOverlay(cells: CoverageCell[], gridX: number, gridY: number): void {
    if (this.coverageOverlay && gridX === this.coverageGridX && gridY === this.coverageGridY) return;
    this.disposeCoverageOverlay();
    this.coverageGridX = gridX;
    this.coverageGridY = gridY;

    if (cells.length === 0) return;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    const colors = new Float32Array(cells.length * 3);
    const m4 = new THREE.Matrix4();

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const y = this.getElevation(c.x, c.y) * 0.3 + 0.16;
      m4.setPosition(c.x, y, c.y);
      mesh.setMatrixAt(i, m4);

      const col = ratioToColor(c.ratio);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.coverageOverlay = mesh;
    this.scene.add(mesh);
  }

  hideCoverageOverlay(): void {
    this.disposeCoverageOverlay();
  }

  hide(): void {
    if (this.group) this.group.visible = false;
    this.disposeCoverageOverlay();
  }

  dispose(): void {
    this.disposeGhost();
    this.disposeCoverageOverlay();
    this.material.dispose();
  }

  private rebuildGhost(type: InfraType): void {
    this.disposeGhost();
    this.currentType = type;

    const cfg = getInfraConfig(type);
    if (!cfg) return;

    this.group = new THREE.Group();

    // Build the actual building model into the group
    this.buildingRenderer.buildPreviewModel(type, this.group);

    // Replace all materials with ghost material and disable shadows
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = this.material;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    this.scene.add(this.group);
  }

  private disposeCoverageOverlay(): void {
    if (this.coverageOverlay) {
      this.scene.remove(this.coverageOverlay);
      this.coverageOverlay.geometry.dispose();
      if (this.coverageOverlay.material instanceof THREE.Material) this.coverageOverlay.material.dispose();
      this.coverageOverlay = null;
    }
    this.coverageGridX = -1;
    this.coverageGridY = -1;
  }

  private disposeGhost(): void {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material !== this.material && child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.group = null;
    }
    this.currentType = null;
  }

}
