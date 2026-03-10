import * as THREE from 'three';
import type { TunnelSegment } from '../core/transport/MetroTunnelPath';
import type { TransportStop } from '../core/transport/types';
import { UNDERGROUND_TUNNEL_Y } from '../core/ViewMode';

/** 隧道常數 */
const TUNNEL_Y = UNDERGROUND_TUNNEL_Y;  // 地面以下，配合半透明地形可見
const TUNNEL_RADIUS = 0.12;  // 管徑加大，更醒目
const TUNNEL_SEGMENTS = 20;
const TUNNEL_COLOR = 0x00acc1;  // 青色（與地鐵路線主題色一致）
const TUNNEL_INNER_COLOR = 0x004d59;  // 管內暗色
const STATION_RADIUS = 0.22;   // 站點球體加大
const STATION_COLOR = 0x00e5ff; // 亮青色

/**
 * MetroTunnelRenderer — 渲染地鐵隧道管狀幾何。
 *
 * 在 UNDERGROUND 模式可見，NORMAL 模式隱藏。
 */
export class MetroTunnelRenderer {
  private tunnelGroup: THREE.Group;
  private scene: THREE.Scene | null = null;

  constructor() {
    this.tunnelGroup = new THREE.Group();
    this.tunnelGroup.visible = false;
  }

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    scene.add(this.tunnelGroup);
  }

  /**
   * 更新隧道渲染——根據隧道段和站點資料重建幾何。
   */
  update(segments: TunnelSegment[], stations: readonly TransportStop[], opacity: number): void {
    // 清除舊幾何
    while (this.tunnelGroup.children.length > 0) {
      const child = this.tunnelGroup.children[0]! as THREE.Mesh;
      this.tunnelGroup.remove(child);
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }

    this.tunnelGroup.visible = opacity > 0;
    if (opacity <= 0) return;

    // 為每條隧道段建立 TubeGeometry（外殼 + 內芯雙層管）
    for (const seg of segments) {
      const points = seg.controlPoints.map(
        p => new THREE.Vector3(p.x + 0.5, TUNNEL_Y, p.y + 0.5)
      );
      if (points.length < 2) continue;

      const curve = new THREE.CatmullRomCurve3(points);

      // 外層管殼（半透明青色）
      const outerGeo = new THREE.TubeGeometry(curve, TUNNEL_SEGMENTS, TUNNEL_RADIUS, 8, false);
      const outerMat = new THREE.MeshBasicMaterial({
        color: TUNNEL_COLOR,
        transparent: true,
        opacity: opacity * 0.6,
        side: THREE.DoubleSide,
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
      mesh.position.set(station.x + 0.5, TUNNEL_Y, station.y + 0.5);
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
      glowMesh.position.set(station.x + 0.5, TUNNEL_Y, station.y + 0.5);
      glowMesh.renderOrder = 9;
      this.tunnelGroup.add(glowMesh);
    }
  }

  dispose(): void {
    while (this.tunnelGroup.children.length > 0) {
      const child = this.tunnelGroup.children[0]! as THREE.Mesh;
      this.tunnelGroup.remove(child);
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
    if (this.scene) {
      this.scene.remove(this.tunnelGroup);
    }
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
