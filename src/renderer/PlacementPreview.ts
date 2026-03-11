import * as THREE from 'three';
import { getInfraConfig, getRotatedSize, type InfraType, type Rotation } from '../core/building/InfraConfig';
import { canPlaceInfra } from '../core/building/InfraPlacement';
import { Grid } from '../core/grid/Grid';
import type { BuildingRenderer } from './BuildingRenderer';

const GREEN = 0x00ff00;
const RED = 0xff0000;
const GHOST_OPACITY = 0.35;

export class PlacementPreview {
  private group: THREE.Group | null = null;
  private scene: THREE.Scene;
  private buildingRenderer: BuildingRenderer;
  private currentType: string | null = null;
  private currentRotation: Rotation = 0;
  private material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, buildingRenderer: BuildingRenderer) {
    this.scene = scene;
    this.buildingRenderer = buildingRenderer;
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

    // Rebuild ghost mesh if type changed (rotation is applied to group, no rebuild needed)
    if (this.currentType !== type) {
      this.rebuildGhost(type);
    }

    if (!this.group) return;

    // Position at cursor
    const { w, h } = getRotatedSize(cfg.width, cfg.height, rotation);
    const offsetX = (w - 1) / 2;
    const offsetZ = (h - 1) / 2;
    this.group.position.set(gridX + offsetX, 0, gridY + offsetZ);

    // Apply rotation to the ghost model
    this.group.rotation.y = (rotation * Math.PI) / 180;
    this.currentRotation = rotation;

    // Check placement validity
    const check = canPlaceInfra(grid, gridX, gridY, type, rotation, groundwaterFn);
    const canAfford = funds >= cfg.cost;
    const valid = check.ok && canAfford;

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

  /** Show road drag preview as semi-transparent road surface along the L-shaped path. */
  updateRoadDrag(points: { x: number; y: number }[], roadWidth: number): void {
    this.disposeGhost();
    this.currentType = '__road_drag__';
    this.currentRotation = 0;

    if (points.length < 1) return;

    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x555555,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    const w = Math.max(0.3, roadWidth);
    for (const pt of points) {
      const geo = new THREE.PlaneGeometry(w, w);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pt.x, 0.12, pt.y);
      this.group.add(mesh);
    }

    this.scene.add(this.group);
  }

  hide(): void {
    if (this.group) this.group.visible = false;
  }

  dispose(): void {
    this.disposeGhost();
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
