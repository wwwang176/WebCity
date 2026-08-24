import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { RoadType, ROAD_CONFIGS } from '../core/road/types';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';
import { injectHighlightShader, addHighlightAttribute } from './HighlightManager';
import { setMeshDim } from './ViewModeDim';
import {
  MAX_LANE_MARKINGS_PER_CELL,
  buildRoadStrips,
  buildSidewalkStrips,
  buildLampPositions,
  BEND_ARC_SEGMENTS,
  BEND_KERB_SEGMENTS,
  buildLaneMarkingData,
  buildCenterLineData,
  buildCurvedCenterLineData,
  buildCrosswalkData,
  buildStopLineData,
  type RoadCell,
} from './RoadStripBuilder';
import { createDoubleArcGeometry } from './ArcGeometry';
import { RoadInstanceTracker } from './RoadInstanceTracker';
import { toPosKey, parsePosKeyUnsafe } from '../core/grid/GridHelpers';

// Re-export for backwards compatibility
export { ROAD_WIDTHS } from './RoadStripBuilder';

import { ROAD_Y, SIDEWALK_Y, ROAD_SLAB_THICKNESS } from './surfaceHeights';
const MARKING_Y = 0.052;

/** Multipliers for max capacity per mesh type (relative to maxRoads). */
const CAP = { road: Math.max(3, BEND_ARC_SEGMENTS), sidewalk: Math.max(4, BEND_KERB_SEGMENTS), marking: MAX_LANE_MARKINGS_PER_CELL, centerLine: 2, curvedCL: 1, crosswalk: 6, stopLine: 2, lamp: 4, lampGlow: 4 } as const;

/**
 * A street lamp's pole height, in cells.
 *
 * Exported because signals take it as their lower bound: a signal shorter than a street lamp does
 * not read as a signal. Written separately, the signals silently become the shortest posts on the
 * street the day the lamps are raised.
 */
export const STREET_LAMP_HEIGHT = 0.28;

/** A street lamp bulb's radius, in cells. A signal's bulb takes it as an upper bound. */
export const STREET_LAMP_BULB_RADIUS = 0.018;

/** A street lamp post's colour, reused by signal poles: metal posts along a street should be one colour. */
export const STREET_LAMP_COLOR = 0x555555;

export class RoadRenderer {
  private roadMesh: THREE.InstancedMesh | null = null;
  private sidewalkMesh: THREE.InstancedMesh | null = null;
  private markingMesh: THREE.InstancedMesh | null = null;
  private centerLineMesh: THREE.InstancedMesh | null = null;
  private curvedCLMesh: THREE.InstancedMesh | null = null;
  private crosswalkMesh: THREE.InstancedMesh | null = null;
  private stopLineMesh: THREE.InstancedMesh | null = null;
  private lampMesh: THREE.InstancedMesh | null = null;
  private lampGlowMesh: THREE.InstancedMesh | null = null;
  private lampGlowMaterial: THREE.MeshBasicMaterial | null = null;

  // Instance trackers (null until initMeshes)
  private roadTracker: RoadInstanceTracker | null = null;
  private sidewalkTracker: RoadInstanceTracker | null = null;
  private markingTracker: RoadInstanceTracker | null = null;
  private centerLineTracker: RoadInstanceTracker | null = null;
  private curvedCLTracker: RoadInstanceTracker | null = null;
  private crosswalkTracker: RoadInstanceTracker | null = null;
  private stopLineTracker: RoadInstanceTracker | null = null;
  private lampTracker: RoadInstanceTracker | null = null;
  private lampGlowTracker: RoadInstanceTracker | null = null;

  private scene: THREE.Scene | null = null;
  private gridWidth = 0;
  private gridHeight = 0;
  private maxRoads = 10000;
  private initialized = false;

  /** Length of the visual road extension beyond the map edge. */
  private static readonly EDGE_EXTEND = 0.5;

  // ─── Pre-allocated mesh initialization ─────────────────────────

  private initMeshes(scene: THREE.Scene, gridW: number, gridH: number): void {
    if (this.initialized) return;
    this.scene = scene;
    this.gridWidth = gridW;
    this.gridHeight = gridH;
    this.maxRoads = Math.min(Math.ceil(gridW * gridH * 0.4), 20000);

    // Road surface
    const roadGeo = new THREE.BoxGeometry(1, ROAD_SLAB_THICKNESS, 1);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    injectHighlightShader(roadMat);
    this.roadMesh = new THREE.InstancedMesh(roadGeo, roadMat, this.maxRoads * CAP.road);
    this.roadMesh.count = 0;
    addHighlightAttribute(this.roadMesh);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.frustumCulled = false;
    scene.add(this.roadMesh);
    this.roadTracker = new RoadInstanceTracker(this.roadMesh, this.maxRoads * CAP.road);

    // Sidewalks
    const swGeo = new THREE.PlaneGeometry(1, 1);
    swGeo.rotateX(-Math.PI / 2);
    const swMat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    injectHighlightShader(swMat);
    this.sidewalkMesh = new THREE.InstancedMesh(swGeo, swMat, this.maxRoads * CAP.sidewalk);
    this.sidewalkMesh.count = 0;
    addHighlightAttribute(this.sidewalkMesh);
    this.sidewalkMesh.receiveShadow = true;
    this.sidewalkMesh.frustumCulled = false;
    scene.add(this.sidewalkMesh);
    this.sidewalkTracker = new RoadInstanceTracker(this.sidewalkMesh, this.maxRoads * CAP.sidewalk);

    // Lane markings
    const mkGeo = new THREE.BoxGeometry(0.01, 0.005, 0.1);
    const mkMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    injectHighlightShader(mkMat);
    this.markingMesh = new THREE.InstancedMesh(mkGeo, mkMat, this.maxRoads * CAP.marking);
    this.markingMesh.count = 0;
    addHighlightAttribute(this.markingMesh);
    this.markingMesh.frustumCulled = false;
    scene.add(this.markingMesh);
    this.markingTracker = new RoadInstanceTracker(this.markingMesh, this.maxRoads * CAP.marking);

    // Center lines (double solid yellow)
    const clGeo = new THREE.BoxGeometry(0.01, 0.005, 1);
    const clMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    injectHighlightShader(clMat);
    this.centerLineMesh = new THREE.InstancedMesh(clGeo, clMat, this.maxRoads * CAP.centerLine);
    this.centerLineMesh.count = 0;
    addHighlightAttribute(this.centerLineMesh);
    this.centerLineMesh.frustumCulled = false;
    scene.add(this.centerLineMesh);
    this.centerLineTracker = new RoadInstanceTracker(this.centerLineMesh, this.maxRoads * CAP.centerLine);

    // Curved center lines (L-bend arcs)
    const arcGeo = createDoubleArcGeometry();
    const arcMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
    injectHighlightShader(arcMat);
    this.curvedCLMesh = new THREE.InstancedMesh(arcGeo, arcMat, this.maxRoads * CAP.curvedCL);
    this.curvedCLMesh.count = 0;
    addHighlightAttribute(this.curvedCLMesh);
    this.curvedCLMesh.frustumCulled = false;
    scene.add(this.curvedCLMesh);
    this.curvedCLTracker = new RoadInstanceTracker(this.curvedCLMesh, this.maxRoads * CAP.curvedCL);

    // Crosswalks
    const cwGeo = new THREE.BoxGeometry(1, 0.005, 1);
    const cwMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
    injectHighlightShader(cwMat);
    this.crosswalkMesh = new THREE.InstancedMesh(cwGeo, cwMat, this.maxRoads * CAP.crosswalk);
    this.crosswalkMesh.count = 0;
    addHighlightAttribute(this.crosswalkMesh);
    this.crosswalkMesh.frustumCulled = false;
    scene.add(this.crosswalkMesh);
    this.crosswalkTracker = new RoadInstanceTracker(this.crosswalkMesh, this.maxRoads * CAP.crosswalk);

    // Stop lines
    const slGeo = new THREE.BoxGeometry(1, 0.005, 1);
    const slMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
    injectHighlightShader(slMat);
    this.stopLineMesh = new THREE.InstancedMesh(slGeo, slMat, this.maxRoads * CAP.stopLine);
    this.stopLineMesh.count = 0;
    addHighlightAttribute(this.stopLineMesh);
    this.stopLineMesh.frustumCulled = false;
    scene.add(this.stopLineMesh);
    this.stopLineTracker = new RoadInstanceTracker(this.stopLineMesh, this.maxRoads * CAP.stopLine);

    // Street lamps
    const poleH = STREET_LAMP_HEIGHT;
    const pole = new THREE.CylinderGeometry(0.008, 0.01, poleH, 4);
    pole.translate(0, poleH / 2, 0);
    const head = new THREE.SphereGeometry(STREET_LAMP_BULB_RADIUS, 4, 3);
    head.translate(0, poleH + 0.01, 0);
    const merged = mergeGeometries([pole, head]);
    pole.dispose();
    head.dispose();
    if (merged) {
      const lampMat = new THREE.MeshLambertMaterial({ color: STREET_LAMP_COLOR });
      injectHighlightShader(lampMat);
      this.lampMesh = new THREE.InstancedMesh(merged, lampMat, this.maxRoads * CAP.lamp);
      this.lampMesh.count = 0;
      addHighlightAttribute(this.lampMesh);
      this.lampMesh.castShadow = true;
      this.lampMesh.frustumCulled = false;
      scene.add(this.lampMesh);
      this.lampTracker = new RoadInstanceTracker(this.lampMesh, this.maxRoads * CAP.lamp);

      // Lamp glow
      const glowSegs = 12;
      const glowRadius = 0.4;
      const glowGeo = new THREE.CircleGeometry(glowRadius, glowSegs);
      glowGeo.rotateX(-Math.PI / 2);
      const posAttr = glowGeo.attributes.position!;
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
      this.lampGlowMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdd88, vertexColors: true, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.lampGlowMesh = new THREE.InstancedMesh(glowGeo, this.lampGlowMaterial, this.maxRoads * CAP.lampGlow);
      this.lampGlowMesh.count = 0;
      this.lampGlowMesh.frustumCulled = false;
      this.lampGlowMesh.renderOrder = 2;
      scene.add(this.lampGlowMesh);
      this.lampGlowTracker = new RoadInstanceTracker(this.lampGlowMesh, this.maxRoads * CAP.lampGlow);
    }

    this.initialized = true;
    this._highlightDirty = true;
  }

  // ─── Full rebuild (load game / disaster) ───────────────────────

  build(scene: THREE.Scene, grid: Grid): void {
    if (this.initialized) {
      // Clear all trackers but keep meshes
      this.clearAllTrackers();
    } else {
      this.dispose(scene);
      this.initMeshes(scene, grid.width, grid.height);
    }

    // Collect all road cells
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

    // Populate all trackers via the shared populateCells logic
    this.populateCells(roadCells, new Set(roadCells.map(c => toPosKey(c.x, c.y))));
  }

  // ─── Incremental update ────────────────────────────────────────

  /** Update visuals for specific cells + their neighbors (O(affected) not O(all roads)). */
  updateCells(grid: Grid, changedCellKeys: string[]): void {
    if (!this.initialized || !this.scene) return;

    // 1. Expand dirty set: changed cells + 1-ring cardinal neighbors
    const dirtySet = new Set<string>();
    for (const key of changedCellKeys) {
      const { x, y } = parsePosKeyUnsafe(key);
      dirtySet.add(toPosKey(x, y));
      if (x > 0) dirtySet.add(toPosKey(x - 1, y));
      if (x < this.gridWidth - 1) dirtySet.add(toPosKey(x + 1, y));
      if (y > 0) dirtySet.add(toPosKey(x, y - 1));
      if (y < this.gridHeight - 1) dirtySet.add(toPosKey(x, y + 1));
    }

    // 2. Crosswalk/stopLine need 2-ring expansion (they depend on neighbor's intersection status)
    const cwDirtySet = new Set(dirtySet);
    for (const key of dirtySet) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x > 0) cwDirtySet.add(toPosKey(x - 1, y));
      if (x < this.gridWidth - 1) cwDirtySet.add(toPosKey(x + 1, y));
      if (y > 0) cwDirtySet.add(toPosKey(x, y - 1));
      if (y < this.gridHeight - 1) cwDirtySet.add(toPosKey(x, y + 1));
    }

    // 3. Remove old instances for all dirty cells
    for (const key of dirtySet) {
      this.roadTracker?.removeCell(key);
      this.sidewalkTracker?.removeCell(key);
      this.markingTracker?.removeCell(key);
      this.centerLineTracker?.removeCell(key);
      this.curvedCLTracker?.removeCell(key);
      this.lampTracker?.removeCell(key);
      this.lampGlowTracker?.removeCell(key);
    }
    for (const key of cwDirtySet) {
      this.crosswalkTracker?.removeCell(key);
      this.stopLineTracker?.removeCell(key);
    }

    // 4. Gather context cells (dirty + their neighbors for strip builder context)
    const contextKeys = new Set(cwDirtySet);
    for (const key of cwDirtySet) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x > 0) contextKeys.add(toPosKey(x - 1, y));
      if (x < this.gridWidth - 1) contextKeys.add(toPosKey(x + 1, y));
      if (y > 0) contextKeys.add(toPosKey(x, y - 1));
      if (y < this.gridHeight - 1) contextKeys.add(toPosKey(x, y + 1));
    }

    const contextCells: RoadCell[] = [];
    for (const key of contextKeys) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        contextCells.push({ x, y, roadType: cell.roadType, roadFlags: cell.roadFlags });
      }
    }

    if (contextCells.length === 0) return;

    // 5. Populate only dirty cells (using context for neighbor lookups)
    this.populateCells(contextCells, dirtySet, cwDirtySet);
  }

  // ─── Shared populate logic ─────────────────────────────────────

  /**
   * Generate strips from contextCells and write instances for cells in targetKeys.
   * @param contextCells All cells needed for strip builder context (targets + neighbors)
   * @param targetKeys Only cells in this set get instances written (road/sidewalk/marking/lamp)
   * @param cwTargetKeys Cells to write crosswalk/stopLine instances for (defaults to targetKeys)
   */
  private populateCells(contextCells: RoadCell[], targetKeys: Set<string>, cwTargetKeys?: Set<string>): void {
    const cwKeys = cwTargetKeys ?? targetKeys;
    const matrix = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const color = new THREE.Color();

    // Road surface strips
    const strips = buildRoadStrips(contextCells, this.gridWidth, this.gridHeight, RoadRenderer.EDGE_EXTEND);
    // Group by source cell
    const stripsByCell = new Map<string, typeof strips>();
    for (const s of strips) {
      const key = toPosKey(s.srcX, s.srcY);
      if (!targetKeys.has(key)) continue;
      const arr = stripsByCell.get(key);
      if (arr) arr.push(s);
      else stripsByCell.set(key, [s]);
    }
    for (const [cellKey, cellStrips] of stripsByCell) {
      const start = this.roadTracker!.addCell(cellKey, cellStrips.length);
      if (start < 0) continue;
      for (let i = 0; i < cellStrips.length; i++) {
        const s = cellStrips[i]!;
        matrix.makeScale(s.sx, 1, s.sz);
        if (s.rotY !== 0) { rot.makeRotationY(s.rotY); matrix.premultiply(rot); }
        matrix.setPosition(s.x, ROAD_Y, s.z);
        this.roadMesh!.setMatrixAt(start + i, matrix);
        const cfg = ROAD_CONFIGS[s.roadType as keyof typeof ROAD_CONFIGS];
        const base = cfg ? Math.max(0.18, 0.30 - cfg.lanes * 0.02) : 0.25;
        color.setRGB(base, base, base + 0.01);
        this.roadMesh!.setColorAt(start + i, color);
      }
    }

    // Sidewalks
    const sidewalks = buildSidewalkStrips(contextCells);
    const swByCell = new Map<string, typeof sidewalks>();
    for (const s of sidewalks) {
      const key = toPosKey(s.srcX, s.srcY);
      if (!targetKeys.has(key)) continue;
      const arr = swByCell.get(key);
      if (arr) arr.push(s);
      else swByCell.set(key, [s]);
    }
    for (const [cellKey, cellSw] of swByCell) {
      const start = this.sidewalkTracker!.addCell(cellKey, cellSw.length);
      if (start < 0) continue;
      for (let i = 0; i < cellSw.length; i++) {
        const s = cellSw[i]!;
        matrix.makeScale(s.sx, 1, s.sz);
        if (s.rotY !== 0) { rot.makeRotationY(s.rotY); matrix.premultiply(rot); }
        matrix.setPosition(s.x, SIDEWALK_Y, s.z);
        this.sidewalkMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Lane markings
    const markings = buildLaneMarkingData(contextCells);
    const mkByCell = new Map<string, typeof markings>();
    for (const m of markings) {
      const key = toPosKey(m.srcX, m.srcY);
      if (!targetKeys.has(key)) continue;
      const arr = mkByCell.get(key);
      if (arr) arr.push(m);
      else mkByCell.set(key, [m]);
    }
    for (const [cellKey, cellMk] of mkByCell) {
      const start = this.markingTracker!.addCell(cellKey, cellMk.length);
      if (start < 0) continue;
      for (let i = 0; i < cellMk.length; i++) {
        const m = cellMk[i]!;
        const perpX = m.rotY === 0 ? m.offsetPerp : 0;
        const perpZ = m.rotY !== 0 ? m.offsetPerp : 0;
        matrix.makeTranslation(m.x + perpX, MARKING_Y, m.z + perpZ);
        if (m.rotY !== 0) {
          rot.makeRotationY(m.rotY);
          matrix.multiply(rot);
        }
        this.markingMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Center lines (double solid)
    const centerLines = buildCenterLineData(contextCells);
    const clByCell = new Map<string, typeof centerLines>();
    for (const cl of centerLines) {
      const key = toPosKey(cl.srcX, cl.srcY);
      if (!targetKeys.has(key)) continue;
      const arr = clByCell.get(key);
      if (arr) arr.push(cl);
      else clByCell.set(key, [cl]);
    }
    for (const [cellKey, cellCl] of clByCell) {
      const start = this.centerLineTracker!.addCell(cellKey, cellCl.length);
      if (start < 0) continue;
      for (let i = 0; i < cellCl.length; i++) {
        const cl = cellCl[i]!;
        const perpX = cl.rotY === 0 ? cl.offsetPerp : 0;
        const perpZ = cl.rotY !== 0 ? cl.offsetPerp : 0;
        matrix.makeScale(1, 1, cl.length);
        if (cl.rotY !== 0) {
          rot.makeRotationY(cl.rotY);
          matrix.premultiply(rot);
        }
        matrix.setPosition(cl.x + perpX, MARKING_Y, cl.z + perpZ);
        this.centerLineMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Curved center lines (L-bend arcs)
    const curvedCLs = buildCurvedCenterLineData(contextCells);
    const cclByCell = new Map<string, typeof curvedCLs>();
    for (const a of curvedCLs) {
      const key = toPosKey(a.srcX, a.srcY);
      if (!targetKeys.has(key)) continue;
      const arr = cclByCell.get(key);
      if (arr) arr.push(a);
      else cclByCell.set(key, [a]);
    }
    for (const [cellKey, cellArcs] of cclByCell) {
      const start = this.curvedCLTracker!.addCell(cellKey, cellArcs.length);
      if (start < 0) continue;
      for (let i = 0; i < cellArcs.length; i++) {
        const a = cellArcs[i]!;
        matrix.makeScale(a.scaleX, 1, 1);
        if (a.rotY !== 0) { rot.makeRotationY(a.rotY); matrix.premultiply(rot); }
        matrix.setPosition(a.cx, MARKING_Y, a.cz);
        this.curvedCLMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Crosswalks
    const cwStripes = buildCrosswalkData(contextCells);
    const cwByCell = new Map<string, typeof cwStripes>();
    for (const s of cwStripes) {
      const key = toPosKey(s.srcX, s.srcY);
      if (!cwKeys.has(key)) continue;
      const arr = cwByCell.get(key);
      if (arr) arr.push(s);
      else cwByCell.set(key, [s]);
    }
    for (const [cellKey, cellCw] of cwByCell) {
      const start = this.crosswalkTracker!.addCell(cellKey, cellCw.length);
      if (start < 0) continue;
      for (let i = 0; i < cellCw.length; i++) {
        const s = cellCw[i]!;
        matrix.makeScale(s.sx, 1, s.sz);
        matrix.setPosition(s.x, MARKING_Y, s.z);
        this.crosswalkMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Stop lines
    const slData = buildStopLineData(contextCells);
    const slByCell = new Map<string, typeof slData>();
    for (const s of slData) {
      const key = toPosKey(s.srcX, s.srcY);
      if (!cwKeys.has(key)) continue;
      const arr = slByCell.get(key);
      if (arr) arr.push(s);
      else slByCell.set(key, [s]);
    }
    for (const [cellKey, cellSl] of slByCell) {
      const start = this.stopLineTracker!.addCell(cellKey, cellSl.length);
      if (start < 0) continue;
      for (let i = 0; i < cellSl.length; i++) {
        const s = cellSl[i]!;
        matrix.makeScale(s.sx, 1, s.sz);
        matrix.setPosition(s.x, MARKING_Y, s.z);
        this.stopLineMesh!.setMatrixAt(start + i, matrix);
      }
    }

    // Street lamps (+ glow) — no strip builder, inline logic
    for (const r of contextCells) {
      const key = toPosKey(r.x, r.y);
      if (!targetKeys.has(key)) continue;

      const lamps = buildLampPositions([r]);

      if (lamps.length > 0 && this.lampTracker && this.lampGlowTracker) {
        const lampStart = this.lampTracker.addCell(key, lamps.length);
        const glowStart = this.lampGlowTracker.addCell(key, lamps.length);
        if (lampStart < 0 || glowStart < 0) {
          if (lampStart >= 0) this.lampTracker.removeCell(key);
          if (glowStart >= 0) this.lampGlowTracker.removeCell(key);
        } else {
          for (let i = 0; i < lamps.length; i++) {
            const p = lamps[i]!;
            matrix.identity();
            matrix.setPosition(p.x, SIDEWALK_Y, p.z);
            this.lampMesh!.setMatrixAt(lampStart + i, matrix);
            matrix.setPosition(p.x, 0.055, p.z);
            this.lampGlowMesh!.setMatrixAt(glowStart + i, matrix);
          }
        }
      }
    }

    // Mark only meshes that have content as needing GPU upload
    const trackers = [
      this.roadTracker, this.sidewalkTracker, this.markingTracker, this.centerLineTracker, this.curvedCLTracker,
      this.crosswalkTracker, this.stopLineTracker, this.lampTracker, this.lampGlowTracker,
    ];
    for (const t of trackers) {
      if (t && t.getCount() > 0) {
        const m = t.getMesh();
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  private clearAllTrackers(): void {
    this.roadTracker?.clear();
    this.sidewalkTracker?.clear();
    this.markingTracker?.clear();
    this.centerLineTracker?.clear();
    this.curvedCLTracker?.clear();
    this.crosswalkTracker?.clear();
    this.stopLineTracker?.clear();
    this.lampTracker?.clear();
    this.lampGlowTracker?.clear();
  }

  // ─── Frame update ──────────────────────────────────────────────

  private _focusMode = false;

  /** Update street lamp glow based on sun intensity (call each frame). */
  update(sunIntensity: number): void {
    if (!this.lampGlowMaterial) return;
    if (this._focusMode) {
      this.lampGlowMaterial.opacity = 0;
      return;
    }
    this.lampGlowMaterial.opacity = Math.max(0, 0.75 * (1 - sunIntensity / 0.45));
  }

  setViewMode(mode: ViewMode): void {
    const opacity = VIEW_MODE_OPACITY[mode].road;
    const dimmed = opacity < 1.0;
    this._focusMode = dimmed;
    const meshes = [
      this.roadMesh, this.sidewalkMesh, this.markingMesh, this.centerLineMesh, this.curvedCLMesh,
      this.crosswalkMesh, this.stopLineMesh, this.lampMesh,
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      setMeshDim(mesh, opacity);
    }
    if (this.lampGlowMesh) {
      this.lampGlowMesh.visible = !dimmed;
    }
  }

  // ─── Highlight support ─────────────────────────────────────────

  private _highlightCache: THREE.InstancedMesh[] = [];
  private _highlightDirty = true;

  get highlightMeshes(): readonly THREE.InstancedMesh[] {
    if (this._highlightDirty) {
      this._highlightDirty = false;
      const arr = this._highlightCache;
      arr.length = 0;
      if (this.roadMesh) arr.push(this.roadMesh);
      if (this.sidewalkMesh) arr.push(this.sidewalkMesh);
      if (this.markingMesh) arr.push(this.markingMesh);
      if (this.centerLineMesh) arr.push(this.centerLineMesh);
      if (this.curvedCLMesh) arr.push(this.curvedCLMesh);
      if (this.crosswalkMesh) arr.push(this.crosswalkMesh);
      if (this.stopLineMesh) arr.push(this.stopLineMesh);
      if (this.lampMesh) arr.push(this.lampMesh);
    }
    return this._highlightCache;
  }

  // ─── Disposal ──────────────────────────────────────────────────

  dispose(scene: THREE.Scene): void {
    const meshes = [
      this.roadMesh, this.sidewalkMesh, this.markingMesh, this.centerLineMesh, this.curvedCLMesh,
      this.crosswalkMesh, this.stopLineMesh, this.lampMesh, this.lampGlowMesh,
    ];
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
    this.centerLineMesh = null;
    this.curvedCLMesh = null;
    this.crosswalkMesh = null;
    this.stopLineMesh = null;
    this.lampMesh = null;
    this.lampGlowMesh = null;
    this.lampGlowMaterial = null;
    this.roadTracker = null;
    this.sidewalkTracker = null;
    this.markingTracker = null;
    this.centerLineTracker = null;
    this.curvedCLTracker = null;
    this.crosswalkTracker = null;
    this.stopLineTracker = null;
    this.lampTracker = null;
    this.lampGlowTracker = null;
    this.initialized = false;
    this._highlightDirty = true;
  }
}
