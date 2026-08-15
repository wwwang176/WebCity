import * as THREE from 'three';
import type { TransportRouteRenderData } from '../core/transport/collectTransportRoutes';
import { buildRoutePolyline } from '../core/transport/RouteArc';

/**
 * Compute a numeric fingerprint of route data.
 * Only rebuild lines when the fingerprint changes (route add/remove/modify).
 */
function routeFingerprint(routes: TransportRouteRenderData[]): number {
  let h = routes.length;
  for (const r of routes) {
    h = (h * 31 + r.routeId) | 0;
    h = (h * 31 + r.color) | 0;
    h = (h * 31 + r.stops.length) | 0;
    h = (h * 31 + (r.suspended ? 1 : 0)) | 0;
    for (const s of r.stops) {
      h = (h * 31 + ((s.x * 997 + s.y) | 0)) | 0;
    }
  }
  return h;
}

/**
 * TransportRouteRenderer — 渲染交通路線連線。
 *
 * 在站點之間畫出彩色線條，讓玩家在地圖上看到路線。
 * 不同交通系統使用不同顏色。
 * Only rebuilds when route data actually changes (fingerprint check).
 */
export class TransportRouteRenderer {
  private lines: THREE.Line[] = [];
  private scene: THREE.Scene | null = null;
  private lastFingerprint = 0;

  /** 固定 Y 高度（略高於地面，避免 z-fighting） */
  private static readonly LINE_Y = 0.15;

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    this.lastFingerprint = 0;
  }

  /**
   * 更新路線渲染——每幀呼叫。
   * 使用 fingerprint 偵測路線變更，只在變更時重建（非每幀）。
   */
  update(routes: TransportRouteRenderData[]): void {
    if (!this.scene) return;

    // Skip rebuild if routes haven't changed
    const fp = routeFingerprint(routes);
    if (fp === this.lastFingerprint) return;
    this.lastFingerprint = fp;

    // 清除舊線條
    for (const line of this.lines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines.length = 0;

    // 為每條路線建立線條
    for (const route of routes) {
      if (route.stops.length < 2) continue;

      // 每一跳拱成拋物線，最後繞回第一站。弧的數學在 core，這裡只把點接起來。
      const points = buildRoutePolyline(route.stops, TransportRouteRenderer.LINE_Y)
        .map(p => new THREE.Vector3(p.x, p.y, p.z));

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({
        color: route.color,
        linewidth: 2,
        transparent: true,
        opacity: route.suspended ? 0.35 : 0.7,
        depthWrite: false,
        dashSize: route.suspended ? 0.3 : 1000, // solid when active
        gapSize: route.suspended ? 0.2 : 0,
      });

      const line = new THREE.Line(geometry, material);
      line.computeLineDistances(); // required for LineDashedMaterial
      line.renderOrder = 5;
      this.scene.add(line);
      this.lines.push(line);
    }
  }

  dispose(): void {
    if (!this.scene) return;
    for (const line of this.lines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines.length = 0;
    this.lastFingerprint = 0;
  }

  /** 返回當前渲染的路線數量（用於測試） */
  getLineCount(): number {
    return this.lines.length;
  }
}
