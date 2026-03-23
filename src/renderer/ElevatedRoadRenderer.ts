import * as THREE from 'three';
import { type ElevationManager } from '../core/elevation/ElevationManager';
import { type ElevatedSegment } from '../core/elevation/types';
import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../core/road/types';
import { RailType } from '../core/rail/types';
import {
  ROAD_WIDTHS,
  buildRoadStrips,
  buildSidewalkStrips,
  buildLaneMarkingData,
  type RoadCell,
  type Strip,
  type SidewalkStrip,
  type LaneMarking,
} from './RoadStripBuilder';

/** Height per elevation level in world units. */
const LEVEL_HEIGHT = 0.6;
/** Pillar/column width. */
const PILLAR_W = 0.08;
const ROAD_Y = 0.025;
const SIDEWALK_Y = 0.028;
const MARKING_Y = 0.052;

const PILLAR_COLOR = 0x888888;
/** Full ramp angle to span 1 cell rising LEVEL_HEIGHT. */
const RAMP_ANGLE = Math.atan2(LEVEL_HEIGHT, 1.0);
/** Hypotenuse length so the tilted surface fills the full cell gap. */
const RAMP_LENGTH = Math.sqrt(1.0 + LEVEL_HEIGHT * LEVEL_HEIGHT);

interface ElevatedCell {
  x: number;
  y: number;
  level: number;
  seg: ElevatedSegment;
  isBridge: boolean;
}

/**
 * Renders elevated road/rail segments using the same strip logic as
 * RoadRenderer (road surface, sidewalks, lane markings) but at elevated Y.
 */
export class ElevatedRoadRenderer {
  private group = new THREE.Group();
  private built = false;

  constructor() {
    this.group.name = 'ElevatedRoads';
  }

  build(scene: THREE.Scene, grid: Grid, em: ElevationManager): void {
    this.dispose(scene);

    const entries = em.toJSON();
    if (entries.length === 0) return;

    // Group elevated cells by level so we can run strip generation per level
    const cellsByLevel = new Map<number, ElevatedCell[]>();
    for (const entry of entries) {
      const cell = grid.getCell(entry.x, entry.y);
      const isBridge = cell?.terrainType === TerrainType.WATER;
      const ec: ElevatedCell = { x: entry.x, y: entry.y, level: entry.level, seg: entry.data, isBridge };
      const arr = cellsByLevel.get(entry.level) ?? [];
      arr.push(ec);
      cellsByLevel.set(entry.level, arr);
    }

    for (const [level, cells] of cellsByLevel) {
      const y = level * LEVEL_HEIGHT;

      // Separate ramp cells from flat elevated cells
      const flatRoadCells: RoadCell[] = [];
      const rampCells: ElevatedCell[] = [];
      for (const c of cells) {
        if (c.seg.roadType !== RoadType.NONE) {
          if (c.seg.isRamp) {
            rampCells.push(c);
          } else {
            flatRoadCells.push({ x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags });
          }
        }
      }

      // Flat elevated segments — use shared strip builders (connected, with curbs + markings)
      if (flatRoadCells.length > 0) {
        const roadStrips = buildRoadStrips(flatRoadCells);
        this.buildRoadSurface(roadStrips, y);

        const sidewalkStrips = buildSidewalkStrips(flatRoadCells);
        this.buildSidewalks(sidewalkStrips, y);

        const markings = buildLaneMarkingData(flatRoadCells);
        this.buildLaneMarkings(markings, y);
      }

      // Ramp cells — rendered individually with tilt rotation
      this.buildRampSurfaces(rampCells);

      // Rail cells
      for (const c of cells) {
        if (c.seg.railType !== RailType.NONE) {
          this.buildRailSurface(c, y);
        }
      }

      // Pillars
      this.buildPillars(cells);
    }

    scene.add(this.group);
    this.built = true;
  }

  private buildRoadSurface(strips: Strip[], baseY: number): void {
    if (strips.length === 0) return;

    const geometry = new THREE.BoxGeometry(1, 0.05, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const mesh = new THREE.InstancedMesh(geometry, material, strips.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < strips.length; i++) {
      const s = strips[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, baseY + ROAD_Y, s.z);
      mesh.setMatrixAt(i, matrix);

      const cfg = ROAD_CONFIGS[s.roadType as RoadType];
      const base = cfg ? Math.max(0.18, 0.30 - cfg.lanes * 0.02) : 0.25;
      color.setRGB(base, base, base + 0.01);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildSidewalks(strips: SidewalkStrip[], baseY: number): void {
    if (strips.length === 0) return;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    const mesh = new THREE.InstancedMesh(geo, mat, strips.length);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i]!;
      matrix.makeScale(s.sx, 1, s.sz);
      matrix.setPosition(s.x, baseY + SIDEWALK_Y, s.z);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildLaneMarkings(markings: LaneMarking[], baseY: number): void {
    if (markings.length === 0) return;

    const geo = new THREE.BoxGeometry(0.01, 0.005, 0.1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const mesh = new THREE.InstancedMesh(geo, mat, markings.length);
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    for (let i = 0; i < markings.length; i++) {
      const m = markings[i]!;
      const perpX = m.rotY === 0 ? m.offsetPerp : 0;
      const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;
      matrix.makeTranslation(m.x + perpX, baseY + MARKING_Y, m.z + perpZ);
      if (m.rotY !== 0) {
        rot.makeRotationY(m.rotY);
        matrix.multiply(rot);
      }
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildRampSurfaces(rampCells: ElevatedCell[]): void {
    if (rampCells.length === 0) return;

    const geometry = new THREE.BoxGeometry(1, 0.05, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const mesh = new THREE.InstancedMesh(geometry, material, rampCells.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    const scale = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Matrix4();
    const combined = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < rampCells.length; i++) {
      const c = rampCells[i]!;
      const w = ROAD_WIDTHS[c.seg.roadType] ?? 0.6;

      // Ramp center Y = midpoint between (level-1) and level
      const midY = (c.level - 0.5) * LEVEL_HEIGHT + ROAD_Y;

      // Determine which axis the ramp slopes along (N/S = Z axis, E/W = X axis)
      const isNS = (c.seg.rampAscendDirection & (RoadDirection.NORTH | RoadDirection.SOUTH)) !== 0;

      // Scale: road width on the cross axis, hypotenuse length on the slope axis
      const sx = isNS ? w : RAMP_LENGTH;
      const sz = isNS ? RAMP_LENGTH : w;

      combined.identity();
      scale.makeScale(sx, 1, sz);
      combined.multiply(scale);

      // Full-angle tilt
      const tiltX = this.getRampTiltX(c.seg.rampAscendDirection);
      const tiltZ = this.getRampTiltZ(c.seg.rampAscendDirection);
      if (tiltX !== 0) {
        rot.makeRotationX(tiltX);
        combined.premultiply(rot);
      }
      if (tiltZ !== 0) {
        rot.makeRotationZ(tiltZ);
        combined.premultiply(rot);
      }

      combined.setPosition(c.x, midY, c.y);
      mesh.setMatrixAt(i, combined);

      // Ramp color — slightly lighter to distinguish
      const cfg = ROAD_CONFIGS[c.seg.roadType as RoadType];
      const base = cfg ? Math.max(0.20, 0.32 - cfg.lanes * 0.02) : 0.27;
      color.setRGB(base, base, base + 0.01);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Full-angle tilt for ramp: ascendDir points toward the HIGH end. */
  private getRampTiltX(ascendDir: number): number {
    if (ascendDir & RoadDirection.NORTH) return RAMP_ANGLE;
    if (ascendDir & RoadDirection.SOUTH) return -RAMP_ANGLE;
    return 0;
  }

  private getRampTiltZ(ascendDir: number): number {
    if (ascendDir & RoadDirection.EAST) return RAMP_ANGLE;
    if (ascendDir & RoadDirection.WEST) return -RAMP_ANGLE;
    return 0;
  }

  private buildRailSurface(c: ElevatedCell, baseY: number): void {
    const geometry = new THREE.BoxGeometry(0.35, 0.05, 0.35);
    const material = new THREE.MeshLambertMaterial({ color: 0x555050 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(c.x, baseY + ROAD_Y, c.y);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildPillars(cells: ElevatedCell[]): void {
    const pillarGeo = new THREE.BoxGeometry(PILLAR_W, 1, PILLAR_W);
    const pillarMat = new THREE.MeshLambertMaterial({ color: PILLAR_COLOR });

    for (const c of cells) {
      if (c.seg.isRamp) continue;

      const topY = c.level * LEVEL_HEIGHT;
      const bottomY = c.isBridge ? -0.15 : 0;
      const pillarHeight = topY - bottomY;
      if (pillarHeight <= 0) continue;

      const mesh = new THREE.Mesh(pillarGeo, pillarMat);
      mesh.scale.set(1, pillarHeight, 1);
      mesh.position.set(c.x, bottomY + pillarHeight / 2, c.y);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  dispose(scene: THREE.Scene): void {
    if (this.built) {
      scene.remove(this.group);
      this.group.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            (child.material as THREE.Material).dispose();
          }
        }
      });
      this.group.clear();
      this.built = false;
    }
  }
}
