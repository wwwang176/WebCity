import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ElevationManager } from '../core/elevation/ElevationManager';
import { type ElevatedSegment } from '../core/elevation/types';
import { SIDEWALK_WIDTH } from '../core/traffic/SidewalkGraph';
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
  private lampGlowMaterials: THREE.MeshBasicMaterial[] = [];

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

      // Road cells split by ramp/flat for street lamp height
      const flatLampCells: RoadCell[] = [];
      const rampLampCells: RoadCell[] = [];
      for (const c of cells) {
        if (c.seg.roadType !== RoadType.NONE) {
          const target = c.seg.isRamp ? rampLampCells : flatLampCells;
          target.push({ x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags });
        }
      }

      // Flat elevated segments — use shared strip builders (connected, with curbs + markings)
      if (flatRoadCells.length > 0) {
        const roadStrips = buildRoadStrips(flatRoadCells, grid.width, grid.height, 0.5);
        this.buildRoadSurface(roadStrips, y);

        const sidewalkStrips = buildSidewalkStrips(flatRoadCells);
        this.buildSidewalks(sidewalkStrips, y);

        const markings = buildLaneMarkingData(flatRoadCells);
        this.buildLaneMarkings(markings, y);
      }

      // Ramp cells — rendered individually with tilt rotation
      this.buildRampSurfaces(rampCells);

      // Ramp sidewalks (tilted to match ramp surface)
      this.buildRampSidewalks(rampCells);

      // Ramp lane markings (tilted to match ramp surface)
      this.buildRampMarkings(rampCells);

      // Street lamps: flat at baseY, ramps at baseY - half level
      if (flatLampCells.length > 0) {
        this.buildStreetLamps(flatLampCells, y);
      }
      if (rampLampCells.length > 0) {
        this.buildStreetLamps(rampLampCells, y - LEVEL_HEIGHT * 0.5);
      }

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

  /** Sidewalks on ramp cells, tilted to match ramp surface. */
  private buildRampSidewalks(rampCells: ElevatedCell[]): void {
    if (rampCells.length === 0) return;

    const roadCells: RoadCell[] = rampCells.map(c => ({
      x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags,
    }));
    const strips = buildSidewalkStrips(roadCells);
    if (strips.length === 0) return;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    const mesh = new THREE.InstancedMesh(geo, mat, strips.length);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    const rampMap = new Map<string, ElevatedCell>();
    for (const c of rampCells) rampMap.set(`${c.x},${c.y}`, c);

    for (let i = 0; i < strips.length; i++) {
      const s = strips[i]!;
      const cellX = Math.round(s.x);
      const cellZ = Math.round(s.z);
      const ramp = rampMap.get(`${cellX},${cellZ}`);

      let sY = SIDEWALK_Y;
      if (ramp) {
        const ascend = ramp.seg.rampAscendDirection;
        const ax = (ascend & 0b1000) ? 1 : (ascend & 0b0100) ? -1 : 0;
        const ay = (ascend & 0b0010) ? 1 : (ascend & 0b0001) ? -1 : 0;
        const along = (s.x - cellX) * ax + (s.z - cellZ) * ay;
        sY = ((ramp.level - 0.5) + along) * LEVEL_HEIGHT + SIDEWALK_Y;
      }

      // Scale: stretch along ramp axis to fill sloped surface
      let sx = s.sx;
      let sz = s.sz;
      if (ramp) {
        const ascend = ramp.seg.rampAscendDirection;
        const isNS = (ascend & (RoadDirection.NORTH | RoadDirection.SOUTH)) !== 0;
        if (isNS) sz *= RAMP_LENGTH; else sx *= RAMP_LENGTH;
      }
      matrix.makeScale(sx, 1, sz);
      if (ramp) {
        const tiltX = this.getRampTiltX(ramp.seg.rampAscendDirection);
        const tiltZ = this.getRampTiltZ(ramp.seg.rampAscendDirection);
        if (tiltX !== 0) { rot.makeRotationX(tiltX); matrix.premultiply(rot); }
        if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); matrix.premultiply(rot); }
      }
      matrix.setPosition(s.x, sY, s.z);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
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

  /** Lane markings on ramp cells, tilted to match ramp surface. */
  private buildRampMarkings(rampCells: ElevatedCell[]): void {
    if (rampCells.length === 0) return;

    // Convert ramp cells to RoadCell for shared marking generator
    const roadCells: RoadCell[] = rampCells.map(c => ({
      x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags,
    }));
    const markings = buildLaneMarkingData(roadCells);
    if (markings.length === 0) return;

    const geo = new THREE.BoxGeometry(0.01, 0.005, 0.1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const mesh = new THREE.InstancedMesh(geo, mat, markings.length);
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    // Build lookup for ramp tilt by cell position
    const rampMap = new Map<string, ElevatedCell>();
    for (const c of rampCells) rampMap.set(`${c.x},${c.y}`, c);

    for (let i = 0; i < markings.length; i++) {
      const m = markings[i]!;
      const perpX = m.rotY === 0 ? m.offsetPerp : 0;
      const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;

      // Find which ramp cell this marking belongs to
      const cellX = Math.round(m.x);
      const cellZ = Math.round(m.z);
      const ramp = rampMap.get(`${cellX},${cellZ}`);
      // Compute Y from position along ramp axis (same formula as vehicle elevation)
      let markY = MARKING_Y;
      if (ramp) {
        const ascend = ramp.seg.rampAscendDirection;
        const ax = (ascend & 0b1000) ? 1 : (ascend & 0b0100) ? -1 : 0;
        const ay = (ascend & 0b0010) ? 1 : (ascend & 0b0001) ? -1 : 0;
        const along = (m.x - cellX) * ax + (m.z - cellZ) * ay;
        markY = ((ramp.level - 0.5) + along) * LEVEL_HEIGHT + MARKING_Y;
      }

      matrix.makeTranslation(m.x + perpX, markY, m.z + perpZ);
      // Ramp tilt FIRST (as rotX in default marking orientation), THEN rotY for direction
      if (ramp) {
        // Unified tilt: N-S ramps use tiltX, E-W ramps use tiltZ value as rotX
        const tiltAngle = this.getRampTiltX(ramp.seg.rampAscendDirection)
          || this.getRampTiltZ(ramp.seg.rampAscendDirection);
        if (tiltAngle !== 0) { rot.makeRotationX(tiltAngle); matrix.multiply(rot); }
      }
      if (m.rotY !== 0) {
        rot.makeRotationY(m.rotY);
        matrix.multiply(rot);
      }
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Street lamps on elevated road cells. */
  private buildStreetLamps(cells: RoadCell[], baseY: number): void {
    type LampPos = { x: number; z: number };
    const lamps: LampPos[] = [];

    for (const r of cells) {
      const hasN = (r.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (r.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasW = (r.roadFlags & RoadDirection.WEST) !== 0;
      const hasE = (r.roadFlags & RoadDirection.EAST) !== 0;

      const ownW = ROAD_WIDTHS[r.roadType] ?? 0.6;
      const half = ownW / 2 + SIDEWALK_WIDTH / 2;

      if (!hasN) lamps.push({ x: r.x, z: r.y - half });
      if (!hasS) lamps.push({ x: r.x, z: r.y + half });
      if (!hasW) lamps.push({ x: r.x - half, z: r.y });
      if (!hasE) lamps.push({ x: r.x + half, z: r.y });
    }

    if (lamps.length === 0) return;

    const poleH = 0.28;
    const pole = new THREE.CylinderGeometry(0.008, 0.01, poleH, 4);
    pole.translate(0, poleH / 2, 0);
    const head = new THREE.SphereGeometry(0.018, 4, 3);
    head.translate(0, poleH + 0.01, 0);
    const merged = mergeGeometries([pole, head]);
    pole.dispose();
    head.dispose();
    if (!merged) return;

    const lampMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const lampMesh = new THREE.InstancedMesh(merged, lampMat, lamps.length);
    lampMesh.castShadow = true;
    lampMesh.frustumCulled = false;

    // Glow disc (radial gradient, additive blending — same as RoadRenderer)
    const glowSegs = 12;
    const glowRadius = 0.4;
    const glowGeo = new THREE.CircleGeometry(glowRadius, glowSegs);
    glowGeo.rotateX(-Math.PI / 2);
    const posAttr = glowGeo.attributes['position']!;
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

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffdd88,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lampGlowMaterials.push(glowMat);
    const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, lamps.length);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 2;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < lamps.length; i++) {
      const p = lamps[i]!;
      matrix.identity();
      matrix.setPosition(p.x, baseY + SIDEWALK_Y, p.z);
      lampMesh.setMatrixAt(i, matrix);
      matrix.setPosition(p.x, baseY + 0.055, p.z);
      glowMesh.setMatrixAt(i, matrix);
    }

    lampMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    this.group.add(lampMesh);
    this.group.add(glowMesh);
  }

  /** Update lamp glow based on sun intensity (call each frame). */
  update(sunIntensity: number): void {
    const opacity = Math.max(0, 0.75 * (1 - sunIntensity / 0.45));
    for (const mat of this.lampGlowMaterials) mat.opacity = opacity;
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
      this.lampGlowMaterials.length = 0;
      this.built = false;
    }
  }
}
