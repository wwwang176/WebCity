import * as THREE from 'three';
import type { TunnelSegment } from '../core/transport/MetroTunnelPath';
import type { TransportStop } from '../core/transport/types';
import { UNDERGROUND_TUNNEL_Y } from '../core/ViewMode';
import { buildMetroCarriageGeometry } from './geometry';
import {
  buildLinePath,
  distanceToSegmentParam,
  advanceTrain,
  type LinePath,
  type TrainAnimState,
} from '../core/transport/MetroLinePath';

/** 隧道常數 */
const TUNNEL_Y = UNDERGROUND_TUNNEL_Y;
const TUNNEL_RADIUS = 0.12;
const TUNNEL_SEGMENTS = 20;
const TUNNEL_COLOR = 0x00acc1;
const TUNNEL_INNER_COLOR = 0x004d59;
const STATION_RADIUS = 0.22;
const STATION_COLOR = 0x00e5ff;
const TRAIN_COLOR = 0x00bcd4;

/** 列車動畫常數 */
const CARRIAGES_PER_TRAIN = 3;
const CARRIAGE_SPACING = 0.25;        // world units, center-to-center
const MAX_CARRIAGES = 50 * CARRIAGES_PER_TRAIN;
const VISUAL_SPEED = 1.5;            // world units per second
const STATION_WAIT_TIME = 1.2;       // seconds to wait at each station

/** 隧道線段資料，帶 lineId 以便列車查找曲線 */
export interface MetroLineData {
  lineId: number;
  stops: readonly { x: number; y: number }[];
  segments: TunnelSegment[];
  trainCount: number;
}

/** 每條線的渲染路徑快取 */
interface LineRenderPath {
  linePath: LinePath;
  curves: THREE.CatmullRomCurve3[];
  curveLengths: number[];        // actual arc lengths from Three.js
  cumulativeLengths: number[];   // [0, L0, L0+L1, ...]
  totalLength: number;
}

/**
 * MetroTunnelRenderer — 渲染地鐵隧道管狀幾何及地鐵列車。
 *
 * 列車移動為純渲染端動畫，不依賴模擬 tick。
 * 每列車渲染 3 節車廂，各自沿曲線獨立朝向。
 */
export class MetroTunnelRenderer {
  private tunnelGroup: THREE.Group;
  private scene: THREE.Scene | null = null;

  // Carriage instanced mesh (3 per train)
  private carriageMesh: THREE.InstancedMesh | null = null;
  private carriageMaterial: THREE.MeshLambertMaterial | null = null;

  // Line render paths (rebuilt when topology changes)
  private lineRenderPaths = new Map<number, LineRenderPath>();

  // Train animation states: key = "lineId-trainIdx"
  private trainStates = new Map<string, TrainAnimState>();

  // Track line topology for change detection
  private lineTopologyHash = new Map<number, string>();

  constructor() {
    this.tunnelGroup = new THREE.Group();
    this.tunnelGroup.visible = false;
  }

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    scene.add(this.tunnelGroup);

    // Build carriage instanced mesh
    const geo = buildMetroCarriageGeometry();
    this.carriageMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.carriageMesh = new THREE.InstancedMesh(geo, this.carriageMaterial, MAX_CARRIAGES);
    this.carriageMesh.count = 0;
    this.carriageMesh.frustumCulled = false;
    this.carriageMesh.renderOrder = 15;
    this.tunnelGroup.add(this.carriageMesh);
  }

  /**
   * 更新隧道渲染及列車動畫。
   * @param dt - 渲染幀間隔（秒），用於推進列車動畫
   */
  update(
    lines: MetroLineData[],
    stations: readonly TransportStop[],
    opacity: number,
    dt: number,
  ): void {
    // 清除舊幾何（保留 carriageMesh）
    const children = [...this.tunnelGroup.children];
    for (const child of children) {
      if (child === this.carriageMesh) continue;
      this.tunnelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    this.tunnelGroup.visible = opacity > 0;
    if (opacity <= 0) {
      if (this.carriageMesh) this.carriageMesh.count = 0;
      return;
    }

    // Build tunnel tubes and update line render paths
    this.rebuildTunnels(lines, opacity);

    // Station spheres
    this.buildStationSpheres(stations, opacity);

    // Advance and render train animation
    this.updateTrainAnimation(dt, lines);
  }

  private rebuildTunnels(lines: MetroLineData[], opacity: number): void {
    for (const lineData of lines) {
      // Check if topology changed
      const hash = lineData.stops.map(s => `${s.x},${s.y}`).join('|');
      const needsRebuild = this.lineTopologyHash.get(lineData.lineId) !== hash;

      if (needsRebuild) {
        this.lineTopologyHash.set(lineData.lineId, hash);
        this.rebuildLineRenderPath(lineData);
      }

      // Always rebuild tunnel geometry (since we clear children each frame)
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath) continue;

      for (const curve of renderPath.curves) {
        // Outer shell
        const outerGeo = new THREE.TubeGeometry(curve, TUNNEL_SEGMENTS, TUNNEL_RADIUS, 8, false);
        const outerMat = new THREE.MeshBasicMaterial({
          color: TUNNEL_COLOR,
          transparent: true,
          opacity: opacity * 0.6,
          side: THREE.BackSide,
          depthWrite: false,
        });
        const outerMesh = new THREE.Mesh(outerGeo, outerMat);
        outerMesh.renderOrder = 10;
        this.tunnelGroup.add(outerMesh);

        // Inner core
        const innerGeo = new THREE.TubeGeometry(curve, TUNNEL_SEGMENTS, TUNNEL_RADIUS * 0.4, 6, false);
        const innerMat = new THREE.MeshBasicMaterial({
          color: TUNNEL_INNER_COLOR,
          transparent: true,
          opacity: opacity * 0.9,
        });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        innerMesh.renderOrder = 11;
        this.tunnelGroup.add(innerMesh);
      }
    }

    // Clean up removed lines
    const activeLineIds = new Set(lines.map(l => l.lineId));
    for (const lineId of this.lineRenderPaths.keys()) {
      if (!activeLineIds.has(lineId)) {
        this.lineRenderPaths.delete(lineId);
        this.lineTopologyHash.delete(lineId);
      }
    }
  }

  private rebuildLineRenderPath(lineData: MetroLineData): void {
    const linePath = buildLinePath(lineData.stops as { x: number; y: number }[]);
    if (linePath.segments.length === 0) return;

    const curves: THREE.CatmullRomCurve3[] = [];
    const curveLengths: number[] = [];
    const cumulativeLengths: number[] = [0];

    for (const seg of linePath.segments) {
      const points = seg.controlPoints.map(
        p => new THREE.Vector3(p.x, TUNNEL_Y, p.y)
      );
      const curve = new THREE.CatmullRomCurve3(points);
      curves.push(curve);
      const len = curve.getLength();
      curveLengths.push(len);
      cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1]! + len);
    }

    const totalLength = cumulativeLengths[cumulativeLengths.length - 1]!;

    // Compute station distances using actual arc lengths
    const stationDistances: number[] = [];
    for (let i = 0; i < linePath.stationDistances.length; i++) {
      stationDistances.push(cumulativeLengths[i]!);
    }

    // Update linePath with accurate lengths
    const accurateLinePath: LinePath = {
      segments: linePath.segments,
      stationDistances,
      totalLength,
    };

    this.lineRenderPaths.set(lineData.lineId, {
      linePath: accurateLinePath,
      curves,
      curveLengths,
      cumulativeLengths,
      totalLength,
    });

    // Invalidate train states for this line (they'll be rebuilt)
    for (const key of this.trainStates.keys()) {
      if (key.startsWith(`${lineData.lineId}-`)) {
        this.trainStates.delete(key);
      }
    }
  }

  private buildStationSpheres(stations: readonly TransportStop[], opacity: number): void {
    for (const station of stations) {
      const geo = new THREE.SphereGeometry(STATION_RADIUS, 12, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: STATION_COLOR,
        transparent: true,
        opacity: opacity * 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(station.x, TUNNEL_Y, station.y);
      mesh.renderOrder = 12;
      this.tunnelGroup.add(mesh);

      const glowGeo = new THREE.SphereGeometry(STATION_RADIUS * 1.5, 10, 6);
      const glowMat = new THREE.MeshBasicMaterial({
        color: STATION_COLOR,
        transparent: true,
        opacity: opacity * 0.2,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(station.x, TUNNEL_Y, station.y);
      glowMesh.renderOrder = 9;
      this.tunnelGroup.add(glowMesh);
    }
  }

  private updateTrainAnimation(dt: number, lines: MetroLineData[]): void {
    if (!this.carriageMesh) return;

    // Ensure train states exist for all lines/trains
    for (const lineData of lines) {
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath || renderPath.totalLength <= 0) continue;

      for (let t = 0; t < lineData.trainCount; t++) {
        const key = `${lineData.lineId}-${t}`;
        if (!this.trainStates.has(key)) {
          // Spawn train evenly spaced along the line
          const d = lineData.trainCount > 1
            ? (t / lineData.trainCount) * renderPath.totalLength
            : 0;

          // Find next station
          let nextIdx = 0;
          for (let j = renderPath.linePath.stationDistances.length - 1; j >= 0; j--) {
            if (d >= renderPath.linePath.stationDistances[j]!) {
              nextIdx = (j + 1) % renderPath.linePath.stationDistances.length;
              break;
            }
          }

          this.trainStates.set(key, {
            distance: d,
            atStation: t === 0, // first train starts at station
            waitTimer: t === 0 ? STATION_WAIT_TIME : 0,
            nextStationIndex: nextIdx,
          });
        }
      }
    }

    // Remove train states for deleted lines/trains
    const validKeys = new Set<string>();
    for (const lineData of lines) {
      for (let t = 0; t < lineData.trainCount; t++) {
        validKeys.add(`${lineData.lineId}-${t}`);
      }
    }
    for (const key of this.trainStates.keys()) {
      if (!validKeys.has(key)) {
        this.trainStates.delete(key);
      }
    }

    // Advance all trains and render carriages
    const color = new THREE.Color(TRAIN_COLOR);
    const rotation = new THREE.Matrix4();
    const translation = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();

    let instanceIdx = 0;

    for (const lineData of lines) {
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath || renderPath.totalLength <= 0) continue;

      for (let t = 0; t < lineData.trainCount; t++) {
        const key = `${lineData.lineId}-${t}`;
        const state = this.trainStates.get(key);
        if (!state) continue;

        // Advance animation
        advanceTrain(
          state,
          dt,
          renderPath.totalLength,
          renderPath.linePath.stationDistances,
          VISUAL_SPEED,
          STATION_WAIT_TIME,
        );

        // Render 3 carriages
        for (let c = 0; c < CARRIAGES_PER_TRAIN; c++) {
          if (instanceIdx >= MAX_CARRIAGES) break;

          const carriageDist = state.distance - c * CARRIAGE_SPACING;
          const result = this.getPointOnRenderPath(renderPath, carriageDist);
          if (!result) continue;

          rotation.makeRotationY(result.heading);
          translation.makeTranslation(result.point.x, result.point.y, result.point.z);
          matrix.copy(translation).multiply(rotation);

          this.carriageMesh.setMatrixAt(instanceIdx, matrix);
          this.carriageMesh.setColorAt(instanceIdx, color);
          instanceIdx++;
        }
      }
    }

    this.carriageMesh.count = instanceIdx;
    this.carriageMesh.instanceMatrix.needsUpdate = true;
    if (this.carriageMesh.instanceColor) this.carriageMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Get position and heading on the line's render path at a given distance.
   * Uses actual CatmullRomCurve3 for smooth positioning.
   */
  private getPointOnRenderPath(
    renderPath: LineRenderPath,
    distance: number,
  ): { point: THREE.Vector3; heading: number } | null {
    if (renderPath.curves.length === 0) return null;

    // Wrap distance
    let d = distance % renderPath.totalLength;
    if (d < 0) d += renderPath.totalLength;

    // Find which curve segment
    for (let i = 0; i < renderPath.curves.length; i++) {
      const segEnd = renderPath.cumulativeLengths[i + 1]!;
      if (d <= segEnd || i === renderPath.curves.length - 1) {
        const localDist = d - renderPath.cumulativeLengths[i]!;
        const localT = renderPath.curveLengths[i]! > 0
          ? Math.min(1, Math.max(0, localDist / renderPath.curveLengths[i]!))
          : 0;

        const point = renderPath.curves[i]!.getPointAt(localT);
        const tangent = renderPath.curves[i]!.getTangentAt(localT);
        const heading = Math.atan2(-tangent.z, tangent.x);

        return { point, heading };
      }
    }

    return null;
  }

  dispose(): void {
    while (this.tunnelGroup.children.length > 0) {
      const child = this.tunnelGroup.children[0]!;
      this.tunnelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    if (this.scene) {
      this.scene.remove(this.tunnelGroup);
    }
    this.carriageMesh = null;
    this.carriageMaterial = null;
    this.lineRenderPaths.clear();
    this.trainStates.clear();
    this.lineTopologyHash.clear();
  }

  /** 返回當前渲染的隧道段數量 + 站點球體數量（用於測試） */
  getMeshCount(): number {
    return this.tunnelGroup.children.length;
  }

  /** 返回隧道群組是否可見 */
  isVisible(): boolean {
    return this.tunnelGroup.visible;
  }
}
