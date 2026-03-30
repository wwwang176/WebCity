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
  buildCenterLineData,
  buildCurvedCenterLineData,
  type RoadCell,
} from './RoadStripBuilder';
import { createDoubleArcGeometry } from './ArcGeometry';
import { RoadInstanceTracker } from './RoadInstanceTracker';
import { toPosKey, parsePosKeyUnsafe } from '../core/grid/GridHelpers';

/** Height per elevation level in world units. */
const LEVEL_HEIGHT = 0.6;
const PILLAR_W = 0.08;
const ROAD_Y = 0.025;
const SIDEWALK_Y = 0.028;
const MARKING_Y = 0.052;
const PILLAR_COLOR = 0x888888;
const RAMP_ANGLE = Math.atan2(LEVEL_HEIGHT, 1.0);
const RAMP_LENGTH = Math.sqrt(1.0 + LEVEL_HEIGHT * LEVEL_HEIGHT);
/** Max elevated cells per level (pre-allocated capacity). */
const MAX_PER_LEVEL = 500;
const CAP = { road: 3, sidewalk: 4, marking: 14, centerLine: 2, curvedCL: 1, lamp: 4, lampGlow: 4 } as const;

interface ElevatedCell {
  x: number;
  y: number;
  level: number;
  seg: ElevatedSegment;
  isBridge: boolean;
}

interface LevelData {
  group: THREE.Group;
  roadMesh: THREE.InstancedMesh;
  sidewalkMesh: THREE.InstancedMesh;
  markingMesh: THREE.InstancedMesh;
  centerLineMesh: THREE.InstancedMesh;
  curvedCLMesh: THREE.InstancedMesh;
  lampMesh: THREE.InstancedMesh;
  lampGlowMesh: THREE.InstancedMesh;
  lampGlowMat: THREE.MeshBasicMaterial;
  roadTracker: RoadInstanceTracker;
  sidewalkTracker: RoadInstanceTracker;
  markingTracker: RoadInstanceTracker;
  centerLineTracker: RoadInstanceTracker;
  curvedCLTracker: RoadInstanceTracker;
  lampTracker: RoadInstanceTracker;
  lampGlowTracker: RoadInstanceTracker;
  pillarMat: THREE.MeshLambertMaterial;
  railMat: THREE.MeshLambertMaterial;
  pillarMeshes: Map<string, THREE.Mesh>;
  railMeshes: Map<string, THREE.Mesh>;
}

// Shared geometry templates (created once, reused for all levels)
let _sharedGeo: {
  road: THREE.BoxGeometry;
  sidewalk: THREE.PlaneGeometry;
  marking: THREE.BoxGeometry;
  centerLine: THREE.BoxGeometry;
  curvedCL: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  glowGeo: THREE.CircleGeometry;
  pillar: THREE.BoxGeometry;
  rail: THREE.BoxGeometry;
} | null = null;

function isSharedGeo(geo: THREE.BufferGeometry): boolean {
  if (!_sharedGeo) return false;
  return geo === _sharedGeo.road || geo === _sharedGeo.sidewalk ||
    geo === _sharedGeo.marking || geo === _sharedGeo.centerLine ||
    geo === _sharedGeo.curvedCL || geo === _sharedGeo.lamp || geo === _sharedGeo.glowGeo ||
    geo === _sharedGeo.pillar || geo === _sharedGeo.rail;
}

function getSharedGeo() {
  if (_sharedGeo) return _sharedGeo;
  const road = new THREE.BoxGeometry(1, 0.05, 1);
  const sw = new THREE.PlaneGeometry(1, 1); sw.rotateX(-Math.PI / 2);
  const mk = new THREE.BoxGeometry(0.01, 0.005, 0.1);
  const cl = new THREE.BoxGeometry(0.01, 0.005, 1);
  const ccl = createDoubleArcGeometry();
  const poleH = 0.28;
  const pole = new THREE.CylinderGeometry(0.008, 0.01, poleH, 4); pole.translate(0, poleH / 2, 0);
  const head = new THREE.SphereGeometry(0.018, 4, 3); head.translate(0, poleH + 0.01, 0);
  const lamp = mergeGeometries([pole, head])!; pole.dispose(); head.dispose();
  const glowR = 0.4, glowS = 12;
  const glowGeo = new THREE.CircleGeometry(glowR, glowS); glowGeo.rotateX(-Math.PI / 2);
  const posA = glowGeo.attributes.position!;
  const vc = new Float32Array(posA.count * 3);
  for (let i = 0; i < posA.count; i++) {
    const d = Math.sqrt(posA.getX(i) ** 2 + posA.getZ(i) ** 2) / glowR;
    const b = Math.max(0, 1 - d); vc[i*3]=b; vc[i*3+1]=b; vc[i*3+2]=b;
  }
  glowGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
  const pillar = new THREE.BoxGeometry(PILLAR_W, 1, PILLAR_W);
  const rail = new THREE.BoxGeometry(0.35, 0.05, 0.35);
  _sharedGeo = { road, sidewalk: sw, marking: mk, centerLine: cl, curvedCL: ccl, lamp, glowGeo, pillar, rail };
  return _sharedGeo;
}

/**
 * Renders elevated road/rail segments with per-cell incremental updates.
 * Each level has its own pre-allocated InstancedMeshes + RoadInstanceTrackers.
 */
export class ElevatedRoadRenderer {
  private group = new THREE.Group();
  private built = false;
  private levels = new Map<number, LevelData>();
  private gridWidth = 0;
  private gridHeight = 0;

  constructor() { this.group.name = 'ElevatedRoads'; }

  // ─── Full rebuild ──────────────────────────────────────────────

  build(scene: THREE.Scene, grid: Grid, em: ElevationManager): void {
    this.dispose(scene);
    this.gridWidth = grid.width;
    this.gridHeight = grid.height;

    const entries = em.toJSON();
    if (entries.length === 0) { scene.add(this.group); this.built = true; return; }

    const cellsByLevel = this.groupByLevel(entries, grid);
    for (const [level, cells] of cellsByLevel) {
      const ld = this.ensureLevel(level);
      this.populateLevelCells(ld, level, cells, grid, new Set(cells.map(c => toPosKey(c.x, c.y))));
    }

    scene.add(this.group);
    this.built = true;
  }

  // ─── Incremental update ────────────────────────────────────────

  updateCells(scene: THREE.Scene, grid: Grid, em: ElevationManager, cellKeys: string[]): void {
    if (!this.built) { this.build(scene, grid, em); return; }

    // Expand dirty set: changed cells + 1-ring neighbors
    const dirtySet = new Set<string>();
    for (const key of cellKeys) {
      const { x, y } = parsePosKeyUnsafe(key);
      dirtySet.add(toPosKey(x, y));
      if (x > 0) dirtySet.add(toPosKey(x - 1, y));
      if (x < this.gridWidth - 1) dirtySet.add(toPosKey(x + 1, y));
      if (y > 0) dirtySet.add(toPosKey(x, y - 1));
      if (y < this.gridHeight - 1) dirtySet.add(toPosKey(x, y + 1));
    }

    // Determine affected levels
    const affectedLevels = new Set<number>();
    for (const key of dirtySet) {
      const { x, y } = parsePosKeyUnsafe(key);
      const levels = em.getAllLevels(x, y);
      for (const l of levels) affectedLevels.add(l.level);
    }
    // Also check levels that WERE populated (cell might have been removed)
    for (const [level, ld] of this.levels) {
      for (const key of dirtySet) {
        if (ld.roadTracker.hasCell(key) || ld.pillarMeshes.has(key) || ld.railMeshes.has(key)) {
          affectedLevels.add(level);
        }
      }
    }

    if (affectedLevels.size === 0) return;

    // Collect ALL entries for affected levels (needed for strip builder context)
    const allEntries = em.toJSON();
    const cellsByLevel = this.groupByLevel(allEntries, grid);

    for (const level of affectedLevels) {
      const ld = this.ensureLevel(level);
      const allCellsAtLevel = cellsByLevel.get(level) ?? [];

      // Remove instances for dirty cells at this level
      for (const key of dirtySet) {
        ld.roadTracker.removeCell(key);
        ld.sidewalkTracker.removeCell(key);
        ld.markingTracker.removeCell(key);
        ld.centerLineTracker.removeCell(key);
        ld.centerLineTracker.removeCell(key + '_cl');
        ld.curvedCLTracker.removeCell(key);
        ld.lampTracker.removeCell(key);
        ld.lampGlowTracker.removeCell(key);
        // Remove pillar/rail individual meshes
        const pillar = ld.pillarMeshes.get(key);
        if (pillar) { ld.group.remove(pillar); ld.pillarMeshes.delete(key); }
        const rail = ld.railMeshes.get(key);
        if (rail) { ld.group.remove(rail); ld.railMeshes.delete(key); }
      }

      // Re-add instances for dirty cells that still exist
      if (allCellsAtLevel.length > 0) {
        this.populateLevelCells(ld, level, allCellsAtLevel, grid as Grid, dirtySet);
      }
    }
  }

  // ─── Shared populate logic ─────────────────────────────────────

  private populateLevelCells(
    ld: LevelData, level: number, allCells: ElevatedCell[],
    grid: Grid, targetKeys: Set<string>,
  ): void {
    const baseY = level * LEVEL_HEIGHT;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const color = new THREE.Color();

    // Separate flat/ramp
    const flatCells: RoadCell[] = [];
    const rampCells: ElevatedCell[] = [];
    for (const c of allCells) {
      if (c.seg.roadType === RoadType.NONE) continue;
      if (c.seg.isRamp) rampCells.push(c);
      else flatCells.push({ x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags });
    }

    // ── Flat road surface via strip builder ──
    if (flatCells.length > 0) {
      const strips = buildRoadStrips(flatCells, this.gridWidth, this.gridHeight, 0.5);
      const byCell = new Map<string, typeof strips>();
      for (const s of strips) {
        const key = toPosKey(s.srcX, s.srcY);
        if (!targetKeys.has(key)) continue;
        const arr = byCell.get(key); if (arr) arr.push(s); else byCell.set(key, [s]);
      }
      for (const [cellKey, cellStrips] of byCell) {
        const start = ld.roadTracker.addCell(cellKey, cellStrips.length);
        if (start < 0) continue;
        for (let i = 0; i < cellStrips.length; i++) {
          const s = cellStrips[i]!;
          matrix.makeScale(s.sx, 1, s.sz);
          matrix.setPosition(s.x, baseY + ROAD_Y, s.z);
          ld.roadMesh.setMatrixAt(start + i, matrix);
          const cfg = ROAD_CONFIGS[s.roadType as RoadType];
          const base = cfg ? Math.max(0.18, 0.30 - cfg.lanes * 0.02) : 0.25;
          color.setRGB(base, base, base + 0.01);
          ld.roadMesh.setColorAt(start + i, color);
        }
      }

      // Flat sidewalks
      const swStrips = buildSidewalkStrips(flatCells);
      const swByCell = new Map<string, typeof swStrips>();
      for (const s of swStrips) {
        const key = toPosKey(s.srcX, s.srcY);
        if (!targetKeys.has(key)) continue;
        const arr = swByCell.get(key); if (arr) arr.push(s); else swByCell.set(key, [s]);
      }
      for (const [cellKey, cellSw] of swByCell) {
        const start = ld.sidewalkTracker.addCell(cellKey, cellSw.length);
        if (start < 0) continue;
        for (let i = 0; i < cellSw.length; i++) {
          const s = cellSw[i]!;
          matrix.makeScale(s.sx, 1, s.sz);
          matrix.setPosition(s.x, baseY + SIDEWALK_Y, s.z);
          ld.sidewalkMesh.setMatrixAt(start + i, matrix);
        }
      }

      // Flat lane markings
      const markings = buildLaneMarkingData(flatCells);
      const mkByCell = new Map<string, typeof markings>();
      for (const m of markings) {
        const key = toPosKey(m.srcX, m.srcY);
        if (!targetKeys.has(key)) continue;
        const arr = mkByCell.get(key); if (arr) arr.push(m); else mkByCell.set(key, [m]);
      }
      for (const [cellKey, cellMk] of mkByCell) {
        const start = ld.markingTracker.addCell(cellKey, cellMk.length);
        if (start < 0) continue;
        for (let i = 0; i < cellMk.length; i++) {
          const m = cellMk[i]!;
          const perpX = m.rotY === 0 ? m.offsetPerp : 0;
          const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;
          matrix.makeTranslation(m.x + perpX, baseY + MARKING_Y, m.z + perpZ);
          if (m.rotY !== 0) { rot.makeRotationY(m.rotY); matrix.multiply(rot); }
          ld.markingMesh.setMatrixAt(start + i, matrix);
        }
      }

      // Flat center lines
      const centerLines = buildCenterLineData(flatCells);
      const clByCell = new Map<string, typeof centerLines>();
      for (const cl of centerLines) {
        const key = toPosKey(cl.srcX, cl.srcY);
        if (!targetKeys.has(key)) continue;
        const arr = clByCell.get(key); if (arr) arr.push(cl); else clByCell.set(key, [cl]);
      }
      for (const [cellKey, cellCl] of clByCell) {
        const start = ld.centerLineTracker.addCell(cellKey, cellCl.length);
        if (start < 0) continue;
        for (let i = 0; i < cellCl.length; i++) {
          const cl = cellCl[i]!;
          const perpX = cl.rotY === 0 ? cl.offsetPerp : 0;
          const perpZ = cl.rotY !== 0 ? cl.offsetPerp : 0;
          matrix.makeScale(1, 1, cl.length);
          if (cl.rotY !== 0) { rot.makeRotationY(cl.rotY); matrix.premultiply(rot); }
          matrix.setPosition(cl.x + perpX, baseY + MARKING_Y, cl.z + perpZ);
          ld.centerLineMesh.setMatrixAt(start + i, matrix);
        }
      }

      // Flat curved center lines (L-bend arcs)
      const curvedCLs = buildCurvedCenterLineData(flatCells);
      const cclByCell = new Map<string, typeof curvedCLs>();
      for (const a of curvedCLs) {
        const key = toPosKey(a.srcX, a.srcY);
        if (!targetKeys.has(key)) continue;
        const arr = cclByCell.get(key); if (arr) arr.push(a); else cclByCell.set(key, [a]);
      }
      for (const [cellKey, cellArcs] of cclByCell) {
        const start = ld.curvedCLTracker.addCell(cellKey, cellArcs.length);
        if (start < 0) continue;
        for (let i = 0; i < cellArcs.length; i++) {
          const a = cellArcs[i]!;
          matrix.makeScale(a.scaleX, 1, 1);
          if (a.rotY !== 0) { rot.makeRotationY(a.rotY); matrix.premultiply(rot); }
          matrix.setPosition(a.cx, baseY + MARKING_Y, a.cz);
          ld.curvedCLMesh.setMatrixAt(start + i, matrix);
        }
      }
    }

    // ── Ramp cells (per-cell transform) ──
    for (const c of rampCells) {
      const key = toPosKey(c.x, c.y);
      if (!targetKeys.has(key)) continue;

      const w = ROAD_WIDTHS[c.seg.roadType] ?? 0.6;
      const midY = (c.level - 0.5) * LEVEL_HEIGHT + ROAD_Y;
      const isNS = (c.seg.rampAscendDirection & (RoadDirection.NORTH | RoadDirection.SOUTH)) !== 0;

      // Road surface (1 instance)
      {
        const start = ld.roadTracker.addCell(key, 1);
        if (start >= 0) {
          const sx = isNS ? w : RAMP_LENGTH;
          const sz = isNS ? RAMP_LENGTH : w;
          const combined = new THREE.Matrix4();
          combined.multiply(scale.makeScale(sx, 1, sz));
          const tiltX = getRampTiltX(c.seg.rampAscendDirection);
          const tiltZ = getRampTiltZ(c.seg.rampAscendDirection);
          if (tiltX !== 0) { rot.makeRotationX(tiltX); combined.premultiply(rot); }
          if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); combined.premultiply(rot); }
          combined.setPosition(c.x, midY, c.y);
          ld.roadMesh.setMatrixAt(start, combined);
          const cfg = ROAD_CONFIGS[c.seg.roadType as RoadType];
          const base = cfg ? Math.max(0.20, 0.32 - cfg.lanes * 0.02) : 0.27;
          color.setRGB(base, base, base + 0.01);
          ld.roadMesh.setColorAt(start, color);
        }
      }

      // Ramp sidewalks (use strip builder for this single cell)
      {
        const rc: RoadCell = { x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags };
        const swStrips = buildSidewalkStrips([rc]);
        if (swStrips.length > 0) {
          const start = ld.sidewalkTracker.addCell(key, swStrips.length);
          if (start >= 0) {
            for (let i = 0; i < swStrips.length; i++) {
              const s = swStrips[i]!;
              const ascend = c.seg.rampAscendDirection;
              const ax = (ascend & 0b1000) ? 1 : (ascend & 0b0100) ? -1 : 0;
              const ay = (ascend & 0b0010) ? 1 : (ascend & 0b0001) ? -1 : 0;
              const along = (s.x - c.x) * ax + (s.z - c.y) * ay;
              const sY = ((c.level - 0.5) + along) * LEVEL_HEIGHT + SIDEWALK_Y;
              let sx = s.sx, sz = s.sz;
              if (isNS) sz *= RAMP_LENGTH; else sx *= RAMP_LENGTH;
              matrix.makeScale(sx, 1, sz);
              const tiltX = getRampTiltX(ascend);
              const tiltZ = getRampTiltZ(ascend);
              if (tiltX !== 0) { rot.makeRotationX(tiltX); matrix.premultiply(rot); }
              if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); matrix.premultiply(rot); }
              matrix.setPosition(s.x, sY, s.z);
              ld.sidewalkMesh.setMatrixAt(start + i, matrix);
            }
          }
        }
      }

      // Ramp lane markings
      {
        const rc: RoadCell = { x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags };
        const markings = buildLaneMarkingData([rc]);
        if (markings.length > 0) {
          const start = ld.markingTracker.addCell(key, markings.length);
          if (start >= 0) {
            for (let i = 0; i < markings.length; i++) {
              const m = markings[i]!;
              const perpX = m.rotY === 0 ? m.offsetPerp : 0;
              const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;
              const ascend = c.seg.rampAscendDirection;
              const ax = (ascend & 0b1000) ? 1 : (ascend & 0b0100) ? -1 : 0;
              const ay = (ascend & 0b0010) ? 1 : (ascend & 0b0001) ? -1 : 0;
              const along = (m.x - c.x) * ax + (m.z - c.y) * ay;
              const markY = ((c.level - 0.5) + along) * LEVEL_HEIGHT + MARKING_Y;
              matrix.makeTranslation(m.x + perpX, markY, m.z + perpZ);
              const tiltX = getRampTiltX(ascend);
              const tiltZ = getRampTiltZ(ascend);
              if (tiltX !== 0) { rot.makeRotationX(tiltX); matrix.multiply(rot); }
              if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); matrix.multiply(rot); }
              if (m.rotY !== 0) { rot.makeRotationY(m.rotY); matrix.multiply(rot); }
              ld.markingMesh.setMatrixAt(start + i, matrix);
            }
          }
        }
      }

      // Ramp center lines
      {
        const rc: RoadCell = { x: c.x, y: c.y, roadType: c.seg.roadType, roadFlags: c.seg.roadFlags };
        const cls = buildCenterLineData([rc]);
        if (cls.length > 0) {
          const clKey = key + '_cl';
          const start = ld.centerLineTracker.addCell(clKey, cls.length);
          if (start >= 0) {
            for (let i = 0; i < cls.length; i++) {
              const cl = cls[i]!;
              const perpX = cl.rotY === 0 ? cl.offsetPerp : 0;
              const perpZ = cl.rotY !== 0 ? cl.offsetPerp : 0;
              const ascend = c.seg.rampAscendDirection;
              const midY = (c.level - 0.5) * LEVEL_HEIGHT + MARKING_Y;
              const lenScaled = cl.length * RAMP_LENGTH;
              matrix.makeScale(1, 1, lenScaled);
              if (cl.rotY !== 0) { rot.makeRotationY(cl.rotY); matrix.premultiply(rot); }
              const tiltX = getRampTiltX(ascend);
              const tiltZ = getRampTiltZ(ascend);
              if (tiltX !== 0) { rot.makeRotationX(tiltX); matrix.premultiply(rot); }
              if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); matrix.premultiply(rot); }
              matrix.setPosition(cl.x + perpX, midY, cl.z + perpZ);
              ld.centerLineMesh.setMatrixAt(start + i, matrix);
            }
          }
        }
      }
    }

    // ── Street lamps (flat + ramp) ──
    for (const c of allCells) {
      if (c.seg.roadType === RoadType.NONE) continue;
      const key = toPosKey(c.x, c.y);
      if (!targetKeys.has(key)) continue;
      if (ld.lampTracker.hasCell(key)) continue; // already added

      const hasN = (c.seg.roadFlags & RoadDirection.NORTH) !== 0;
      const hasS = (c.seg.roadFlags & RoadDirection.SOUTH) !== 0;
      const hasE = (c.seg.roadFlags & RoadDirection.EAST) !== 0;
      const hasW = (c.seg.roadFlags & RoadDirection.WEST) !== 0;
      const ownW = ROAD_WIDTHS[c.seg.roadType] ?? 0.6;
      const half = ownW / 2 + SIDEWALK_WIDTH / 2;
      const lampY = c.seg.isRamp ? baseY - LEVEL_HEIGHT * 0.5 : baseY;

      const lamps: { lx: number; lz: number }[] = [];
      if (!hasN) lamps.push({ lx: c.x, lz: c.y - half });
      if (!hasS) lamps.push({ lx: c.x, lz: c.y + half });
      if (!hasW) lamps.push({ lx: c.x - half, lz: c.y });
      if (!hasE) lamps.push({ lx: c.x + half, lz: c.y });

      if (lamps.length > 0) {
        const ls = ld.lampTracker.addCell(key, lamps.length);
        const gs = ld.lampGlowTracker.addCell(key, lamps.length);
        if (ls < 0 || gs < 0) {
          if (ls >= 0) ld.lampTracker.removeCell(key);
          if (gs >= 0) ld.lampGlowTracker.removeCell(key);
        } else {
          for (let i = 0; i < lamps.length; i++) {
            const p = lamps[i]!;
            matrix.identity(); matrix.setPosition(p.lx, lampY + SIDEWALK_Y, p.lz);
            ld.lampMesh.setMatrixAt(ls + i, matrix);
            matrix.setPosition(p.lx, lampY + 0.055, p.lz);
            ld.lampGlowMesh.setMatrixAt(gs + i, matrix);
          }
        }
      }
    }

    // ── Pillars (individual meshes, per cell) ──
    const geo = getSharedGeo();
    for (const c of allCells) {
      if (c.seg.isRamp) continue;
      const key = toPosKey(c.x, c.y);
      if (!targetKeys.has(key)) continue;
      if (ld.pillarMeshes.has(key)) continue;

      const topY = c.level * LEVEL_HEIGHT;
      const bottomY = c.isBridge ? -0.15 : 0;
      const h = topY - bottomY;
      if (h <= 0) continue;

      const mesh = new THREE.Mesh(geo.pillar, ld.pillarMat);
      mesh.scale.set(1, h, 1);
      mesh.position.set(c.x, bottomY + h / 2, c.y);
      mesh.castShadow = true;
      ld.group.add(mesh);
      ld.pillarMeshes.set(key, mesh);
    }

    // ── Rail (individual meshes, per cell) ──
    for (const c of allCells) {
      if (c.seg.railType === RailType.NONE) continue;
      const key = toPosKey(c.x, c.y);
      if (!targetKeys.has(key)) continue;
      if (ld.railMeshes.has(key)) continue;

      const mesh = new THREE.Mesh(geo.rail, ld.railMat);
      mesh.position.set(c.x, baseY + ROAD_Y, c.y);
      mesh.receiveShadow = true;
      ld.group.add(mesh);
      ld.railMeshes.set(key, mesh);
    }

    // Mark mesh updates
    for (const m of [ld.roadMesh, ld.sidewalkMesh, ld.markingMesh, ld.centerLineMesh, ld.curvedCLMesh, ld.lampMesh, ld.lampGlowMesh]) {
      if (m.count > 0) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }

  // ─── Level management ──────────────────────────────────────────

  private ensureLevel(level: number): LevelData {
    const existing = this.levels.get(level);
    if (existing) return existing;

    const geo = getSharedGeo();
    const cap = MAX_PER_LEVEL;
    const grp = new THREE.Group();
    grp.name = `ElevatedLevel_${level}`;

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const roadMesh = new THREE.InstancedMesh(geo.road, roadMat, cap * CAP.road);
    roadMesh.count = 0; roadMesh.receiveShadow = true; roadMesh.castShadow = true; roadMesh.frustumCulled = false;
    grp.add(roadMesh);

    const swMat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    const swMesh = new THREE.InstancedMesh(geo.sidewalk, swMat, cap * CAP.sidewalk);
    swMesh.count = 0; swMesh.receiveShadow = true; swMesh.castShadow = true; swMesh.frustumCulled = false;
    grp.add(swMesh);

    const mkMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const mkMesh = new THREE.InstancedMesh(geo.marking, mkMat, cap * CAP.marking);
    mkMesh.count = 0; mkMesh.frustumCulled = false;
    grp.add(mkMesh);

    const clMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const clMesh = new THREE.InstancedMesh(geo.centerLine, clMat, cap * CAP.centerLine);
    clMesh.count = 0; clMesh.frustumCulled = false;
    grp.add(clMesh);

    const cclMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
    const cclMesh = new THREE.InstancedMesh(geo.curvedCL, cclMat, cap * CAP.curvedCL);
    cclMesh.count = 0; cclMesh.frustumCulled = false;
    grp.add(cclMesh);

    const lampMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const lampMesh = new THREE.InstancedMesh(geo.lamp, lampMat, cap * CAP.lamp);
    lampMesh.count = 0; lampMesh.castShadow = true; lampMesh.frustumCulled = false;
    grp.add(lampMesh);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffdd88, vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glowMesh = new THREE.InstancedMesh(geo.glowGeo, glowMat, cap * CAP.lampGlow);
    glowMesh.count = 0; glowMesh.frustumCulled = false; glowMesh.renderOrder = 2;
    grp.add(glowMesh);

    this.group.add(grp);

    const ld: LevelData = {
      group: grp,
      roadMesh, sidewalkMesh: swMesh, markingMesh: mkMesh, centerLineMesh: clMesh, curvedCLMesh: cclMesh,
      lampMesh, lampGlowMesh: glowMesh,
      lampGlowMat: glowMat,
      roadTracker: new RoadInstanceTracker(roadMesh, cap * CAP.road),
      sidewalkTracker: new RoadInstanceTracker(swMesh, cap * CAP.sidewalk),
      markingTracker: new RoadInstanceTracker(mkMesh, cap * CAP.marking),
      centerLineTracker: new RoadInstanceTracker(clMesh, cap * CAP.centerLine),
      curvedCLTracker: new RoadInstanceTracker(cclMesh, cap * CAP.curvedCL),
      lampTracker: new RoadInstanceTracker(lampMesh, cap * CAP.lamp),
      lampGlowTracker: new RoadInstanceTracker(glowMesh, cap * CAP.lampGlow),
      pillarMat: new THREE.MeshLambertMaterial({ color: PILLAR_COLOR }),
      railMat: new THREE.MeshLambertMaterial({ color: 0x555050 }),
      pillarMeshes: new Map(),
      railMeshes: new Map(),
    };
    this.levels.set(level, ld);
    return ld;
  }

  private groupByLevel(
    entries: Array<{ x: number; y: number; level: number; data: ElevatedSegment }>,
    grid: Grid,
  ): Map<number, ElevatedCell[]> {
    const map = new Map<number, ElevatedCell[]>();
    for (const e of entries) {
      const cell = grid.getCell(e.x, e.y);
      const isBridge = cell?.terrainType === TerrainType.WATER;
      const ec: ElevatedCell = { x: e.x, y: e.y, level: e.level, seg: e.data, isBridge };
      const arr = map.get(e.level) ?? []; arr.push(ec); map.set(e.level, arr);
    }
    return map;
  }

  // ─── Frame update ──────────────────────────────────────────────

  update(sunIntensity: number): void {
    const opacity = Math.max(0, 0.75 * (1 - sunIntensity / 0.45));
    for (const ld of this.levels.values()) ld.lampGlowMat.opacity = opacity;
  }

  // ─── Disposal ──────────────────────────────────────────────────

  dispose(scene: THREE.Scene): void {
    if (this.built) {
      scene.remove(this.group);
      this.group.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
          // Skip shared geometries — they live in the module-level cache
          if (!isSharedGeo(child.geometry)) child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else (child.material as THREE.Material).dispose();
        }
      });
      this.group.clear();
      this.levels.clear();
      this.built = false;
    }
  }
}

// ── Ramp tilt helpers ──

function getRampTiltX(ascendDir: number): number {
  if (ascendDir & RoadDirection.NORTH) return RAMP_ANGLE;
  if (ascendDir & RoadDirection.SOUTH) return -RAMP_ANGLE;
  return 0;
}

function getRampTiltZ(ascendDir: number): number {
  if (ascendDir & RoadDirection.EAST) return RAMP_ANGLE;
  if (ascendDir & RoadDirection.WEST) return -RAMP_ANGLE;
  return 0;
}
