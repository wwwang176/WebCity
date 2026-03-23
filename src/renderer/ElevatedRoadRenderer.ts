import * as THREE from 'three';
import { type ElevationManager } from '../core/elevation/ElevationManager';
import { type ElevatedSegment, MAX_ELEVATION_LEVEL, MIN_ELEVATION_LEVEL } from '../core/elevation/types';
import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';
import { RoadType, RoadDirection } from '../core/road/types';
import { RailType, TrackDirection } from '../core/rail/types';
import { ROAD_WIDTHS } from './RoadRenderer';

/** Height per elevation level in world units. */
const LEVEL_HEIGHT = 0.6;
/** Pillar/column width. */
const PILLAR_W = 0.08;
/** Road surface thickness. */
const SURFACE_H = 0.06;
/** Ramp angle visual — how much the surface tilts. */
const RAMP_TILT = Math.atan2(LEVEL_HEIGHT, 1); // ~31°

const ROAD_COLOR = 0x4a4a4a;
const BRIDGE_COLOR = 0x5a5a5a;
const PILLAR_COLOR = 0x888888;
const RAIL_COLOR = 0x6b6b6b;

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
    const geometry = new THREE.BoxGeometry(1, SURFACE_H, 1);
    const roadMat = new THREE.MeshLambertMaterial({ color: ROAD_COLOR });
    const bridgeMat = new THREE.MeshLambertMaterial({ color: BRIDGE_COLOR });
    const railMat = new THREE.MeshLambertMaterial({ color: RAIL_COLOR });

    for (const c of cells) {
      const y = c.level * LEVEL_HEIGHT;
      const hasRoad = c.seg.roadType !== RoadType.NONE;
      const hasRail = c.seg.railType !== RailType.NONE;

      if (hasRoad) {
        const w = ROAD_WIDTHS[c.seg.roadType] ?? 0.6;
        const mesh = new THREE.Mesh(geometry.clone(), c.isBridge ? bridgeMat : roadMat);
        mesh.scale.set(w, 1, w);

        if (c.seg.isRamp) {
          // Tilt the surface for ramp visual
          mesh.rotation.x = this.getRampTilt(c.seg.roadFlags);
          mesh.rotation.z = this.getRampTiltZ(c.seg.roadFlags);
        }

        mesh.position.set(c.x, y, c.y);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.group.add(mesh);
      }

      if (hasRail) {
        // Rail surface — narrower
        const mesh = new THREE.Mesh(geometry.clone(), railMat);
        mesh.scale.set(0.3, 1, 0.3);
        if (c.seg.isRamp) {
          mesh.rotation.x = this.getRampTilt(c.seg.railFlags);
          mesh.rotation.z = this.getRampTiltZ(c.seg.railFlags);
        }
        mesh.position.set(c.x, y, c.y);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
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

  /** Get X-axis tilt for N/S oriented ramps. */
  private getRampTilt(flags: number): number {
    if (flags & RoadDirection.NORTH) return -RAMP_TILT * 0.3;
    if (flags & RoadDirection.SOUTH) return RAMP_TILT * 0.3;
    return 0;
  }

  /** Get Z-axis tilt for E/W oriented ramps. */
  private getRampTiltZ(flags: number): number {
    if (flags & RoadDirection.WEST) return RAMP_TILT * 0.3;
    if (flags & RoadDirection.EAST) return -RAMP_TILT * 0.3;
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
