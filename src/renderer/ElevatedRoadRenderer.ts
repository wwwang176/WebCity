import * as THREE from 'three';
import { type ElevationManager } from '../core/elevation/ElevationManager';
import { type ElevatedSegment, MAX_ELEVATION_LEVEL, MIN_ELEVATION_LEVEL } from '../core/elevation/types';
import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../core/road/types';
import { RailType } from '../core/rail/types';
import { ROAD_WIDTHS } from './RoadRenderer';

/** Height per elevation level in world units. */
const LEVEL_HEIGHT = 0.6;
/** Pillar/column width. */
const PILLAR_W = 0.08;
/** Road surface thickness (same as RoadRenderer). */
const SURFACE_H = 0.05;
/** Ramp angle visual — how much the surface tilts. */
const RAMP_TILT = Math.atan2(LEVEL_HEIGHT, 1);

const PILLAR_COLOR = 0x888888;

interface ElevatedCell {
  x: number;
  y: number;
  level: number;
  seg: ElevatedSegment;
  isBridge: boolean;
}

/**
 * Renders elevated road/rail segments, ramps, and pillars.
 * Reads from ElevationManager (sparse data).
 */
export class ElevatedRoadRenderer {
  private group = new THREE.Group();
  private built = false;

  constructor() {
    this.group.name = 'ElevatedRoads';
  }

  build(scene: THREE.Scene, grid: Grid, em: ElevationManager): void {
    this.dispose(scene);

    const cells: ElevatedCell[] = [];
    const entries = em.toJSON();
    for (const entry of entries) {
      const cell = grid.getCell(entry.x, entry.y);
      const isBridge = cell?.terrainType === TerrainType.WATER;
      cells.push({
        x: entry.x,
        y: entry.y,
        level: entry.level,
        seg: entry.data,
        isBridge,
      });
    }

    if (cells.length === 0) return;

    this.buildSurfaces(cells);
    this.buildPillars(cells);

    scene.add(this.group);
    this.built = true;
  }

  private buildSurfaces(cells: ElevatedCell[]): void {
    if (cells.length === 0) return;

    // Use InstancedMesh like RoadRenderer for consistent look
    const geometry = new THREE.BoxGeometry(1, SURFACE_H, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length * 2);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const color = new THREE.Color();
    let idx = 0;

    for (const c of cells) {
      const y = c.level * LEVEL_HEIGHT;
      const hasRoad = c.seg.roadType !== RoadType.NONE;
      const hasRail = c.seg.railType !== RailType.NONE;

      if (hasRoad) {
        const w = ROAD_WIDTHS[c.seg.roadType] ?? 0.6;

        matrix.makeScale(w, 1, w);
        if (c.seg.isRamp) {
          rot.makeRotationX(this.getRampTiltX(c.seg.rampAscendDirection));
          matrix.premultiply(rot);
          const tz = this.getRampTiltZ(c.seg.rampAscendDirection);
          if (tz !== 0) {
            rot.makeRotationZ(tz);
            matrix.premultiply(rot);
          }
        }
        matrix.setPosition(c.x, y, c.y);
        mesh.setMatrixAt(idx, matrix);

        // Asphalt color matching RoadRenderer — varies by road type
        const cfg = ROAD_CONFIGS[c.seg.roadType as RoadType];
        const base = cfg ? Math.max(0.18, 0.30 - cfg.lanes * 0.02) : 0.25;
        // Bridge tint slightly lighter
        const tint = c.isBridge ? 0.04 : 0;
        color.setRGB(base + tint, base + tint, base + tint + 0.01);
        mesh.setColorAt(idx, color);
        idx++;
      }

      if (hasRail) {
        matrix.makeScale(0.35, 1, 0.35);
        if (c.seg.isRamp) {
          rot.makeRotationX(this.getRampTiltX(c.seg.rampAscendDirection));
          matrix.premultiply(rot);
          const tz = this.getRampTiltZ(c.seg.rampAscendDirection);
          if (tz !== 0) {
            rot.makeRotationZ(tz);
            matrix.premultiply(rot);
          }
        }
        matrix.setPosition(c.x, y, c.y);
        mesh.setMatrixAt(idx, matrix);
        color.setRGB(0.35, 0.33, 0.30);
        mesh.setColorAt(idx, color);
        idx++;
      }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildPillars(cells: ElevatedCell[]): void {
    const pillarGeo = new THREE.BoxGeometry(PILLAR_W, 1, PILLAR_W);
    const pillarMat = new THREE.MeshLambertMaterial({ color: PILLAR_COLOR });

    for (const c of cells) {
      if (c.seg.isRamp) continue; // No pillars on ramps (they rest on the slope)

      const topY = c.level * LEVEL_HEIGHT;
      const bottomY = c.isBridge ? -0.15 : 0; // Bridge pillars start below water surface
      const pillarHeight = topY - bottomY;
      if (pillarHeight <= 0) continue;

      const mesh = new THREE.Mesh(pillarGeo, pillarMat);
      mesh.scale.set(1, pillarHeight, 1);
      mesh.position.set(c.x, bottomY + pillarHeight / 2, c.y);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  /**
   * Get X-axis tilt based on rampAscendDirection.
   * ascendDir points toward the HIGH end.
   * In Three.js XZ plane: +rotation.x → north side rises, south side drops.
   */
  private getRampTiltX(ascendDir: number): number {
    // NORTH (high end is north) → tilt so north is higher → positive rotation.x
    if (ascendDir & RoadDirection.NORTH) return RAMP_TILT * 0.3;
    // SOUTH (high end is south) → tilt so south is higher → negative rotation.x
    if (ascendDir & RoadDirection.SOUTH) return -RAMP_TILT * 0.3;
    return 0;
  }

  /** Get Z-axis tilt based on rampAscendDirection. */
  private getRampTiltZ(ascendDir: number): number {
    // EAST (high end is east) → tilt so east is higher → negative rotation.z
    if (ascendDir & RoadDirection.EAST) return -RAMP_TILT * 0.3;
    // WEST (high end is west) → tilt so west is higher → positive rotation.z
    if (ascendDir & RoadDirection.WEST) return RAMP_TILT * 0.3;
    return 0;
  }

  dispose(scene: THREE.Scene): void {
    if (this.built) {
      scene.remove(this.group);
      // Dispose all meshes in group
      this.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
      this.group.clear();
      this.built = false;
    }
  }
}
