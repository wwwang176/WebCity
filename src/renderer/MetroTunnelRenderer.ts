import * as THREE from 'three';
import type { TunnelSegment } from '../core/transport/MetroTunnelPath';
import type { TransportStop } from '../core/transport/types';
import type { MetroTrainRenderData } from '../core/transport/collectMetroTrains';
import { UNDERGROUND_TUNNEL_Y } from '../core/ViewMode';
import { buildMetroTrainGeometry } from './vehicleGeometry';

/** 隧道常數 */
const TUNNEL_Y = UNDERGROUND_TUNNEL_Y;  // 地面以下，配合半透明地形可見
const TUNNEL_RADIUS = 0.12;  // 管徑加大，更醒目
const TUNNEL_SEGMENTS = 20;
const TUNNEL_COLOR = 0x00acc1;  // 青色（與地鐵路線主題色一致）
const TUNNEL_INNER_COLOR = 0x004d59;  // 管內暗色
const STATION_RADIUS = 0.22;   // 站點球體加大
const STATION_COLOR = 0x00e5ff; // 亮青色
const TRAIN_COLOR = 0x00bcd4;
const MAX_TRAINS = 50;

/** 隧道線段資料，帶 lineId 以便列車查找曲線 */
export interface MetroLineData {
  lineId: number;
  stops: readonly { x: number; y: number }[];
  segments: TunnelSegment[];
}

/**
 * MetroTunnelRenderer — 渲染地鐵隧道管狀幾何及地鐵列車。
 *
 * 在 UNDERGROUND 模式可見，NORMAL 模式隱藏。
 */
export class MetroTunnelRenderer {
  private tunnelGroup: THREE.Group;
  private scene: THREE.Scene | null = null;

  // Train instanced mesh
  private trainMesh: THREE.InstancedMesh | null = null;
  private trainMaterial: THREE.MeshLambertMaterial | null = null;

  // Cached curves keyed by "lineId-fromIdx-toIdx"
  private curveCache = new Map<string, THREE.CatmullRomCurve3>();

  constructor() {
    this.tunnelGroup = new THREE.Group();
    this.tunnelGroup.visible = false;
  }

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    scene.add(this.tunnelGroup);

    // Build train instanced mesh
    const geo = buildMetroTrainGeometry();
    this.trainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.trainMesh = new THREE.InstancedMesh(geo, this.trainMaterial, MAX_TRAINS);
    this.trainMesh.count = 0;
    this.trainMesh.frustumCulled = false;
    this.trainMesh.renderOrder = 15;
    this.tunnelGroup.add(this.trainMesh);
  }

  /**
   * 更新隧道渲染——根據隧道段和站點資料重建幾何，並更新列車位置。
   */
  update(
    lines: MetroLineData[],
    stations: readonly TransportStop[],
    opacity: number,
    trains?: MetroTrainRenderData[],
  ): void {
    // 清除舊幾何（但保留 trainMesh）
    const children = [...this.tunnelGroup.children];
    for (const child of children) {
      if (child === this.trainMesh) continue;
      this.tunnelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    this.tunnelGroup.visible = opacity > 0;
    if (opacity <= 0) {
      if (this.trainMesh) this.trainMesh.count = 0;
      return;
    }

    // Clear curve cache
    this.curveCache.clear();

    // 為每條線的每段建立 TubeGeometry（外殼 + 內芯雙層管）
    for (const lineData of lines) {
      for (let segIdx = 0; segIdx < lineData.segments.length; segIdx++) {
        const seg = lineData.segments[segIdx]!;
        const points = seg.controlPoints.map(
          p => new THREE.Vector3(p.x, TUNNEL_Y, p.y)
        );
        if (points.length < 2) continue;

        const curve = new THREE.CatmullRomCurve3(points);

        // Cache the curve for train position lookup
        const cacheKey = `${lineData.lineId}-${segIdx}-${segIdx + 1}`;
        this.curveCache.set(cacheKey, curve);

        // 外層管殼（半透明青色）
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

        // 內芯（發光線條效果）
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

    // 站點：大球體 + 發光外環
    for (const station of stations) {
      // 實心站點球
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

      // 外環光暈
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

    // Update train positions
    this.updateTrains(lines, trains ?? []);
  }

  private updateTrains(lines: MetroLineData[], trains: MetroTrainRenderData[]): void {
    if (!this.trainMesh) return;

    const color = new THREE.Color(TRAIN_COLOR);
    const rotation = new THREE.Matrix4();
    const translation = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();

    let count = 0;
    for (const train of trains) {
      if (count >= MAX_TRAINS) break;

      const lineData = lines.find(l => l.lineId === train.lineId);
      if (!lineData) continue;

      if (train.atStop) {
        // Place at station position
        const stop = lineData.stops[train.fromStopIndex];
        if (!stop) continue;
        translation.makeTranslation(stop.x, TUNNEL_Y, stop.y);
        this.trainMesh.setMatrixAt(count, translation);
      } else {
        // Interpolate along tunnel curve
        // Find the segment from fromStopIndex to toStopIndex
        const segIdx = train.fromStopIndex;
        const cacheKey = `${train.lineId}-${segIdx}-${segIdx + 1}`;
        const curve = this.curveCache.get(cacheKey);

        if (curve) {
          const point = curve.getPointAt(Math.max(0, Math.min(1, train.progress)));
          const tangent = curve.getTangentAt(Math.max(0, Math.min(1, train.progress)));
          const heading = Math.atan2(-tangent.z, tangent.x);

          rotation.makeRotationY(heading);
          translation.makeTranslation(point.x, point.y, point.z);
          matrix.copy(translation).multiply(rotation);
          this.trainMesh.setMatrixAt(count, matrix);
        } else {
          // Fallback: linear interpolation between stops
          const from = lineData.stops[train.fromStopIndex];
          const to = lineData.stops[train.toStopIndex];
          if (!from || !to) continue;
          const x = from.x + (to.x - from.x) * train.progress;
          const z = from.y + (to.y - from.y) * train.progress;
          const heading = Math.atan2(-(to.y - from.y), to.x - from.x);
          rotation.makeRotationY(heading);
          translation.makeTranslation(x, TUNNEL_Y, z);
          matrix.copy(translation).multiply(rotation);
          this.trainMesh.setMatrixAt(count, matrix);
        }
      }

      this.trainMesh.setColorAt(count, color);
      count++;
    }

    this.trainMesh.count = count;
    this.trainMesh.instanceMatrix.needsUpdate = true;
    if (this.trainMesh.instanceColor) this.trainMesh.instanceColor.needsUpdate = true;
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
    this.trainMesh = null;
    this.trainMaterial = null;
    this.curveCache.clear();
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
