import * as THREE from 'three';
import type { TransportRouteRenderData } from '../core/transport/collectTransportRoutes';

/**
 * TransportRouteRenderer — 渲染交通路線連線。
 *
 * 在站點之間畫出彩色線條，讓玩家在地圖上看到路線。
 * 不同交通系統使用不同顏色。
 */
export class TransportRouteRenderer {
  private lines: THREE.Line[] = [];
  private scene: THREE.Scene | null = null;

  /** 固定 Y 高度（略高於地面，避免 z-fighting） */
  private static readonly LINE_Y = 0.15;

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
  }

  /**
   * 更新路線渲染——每幀呼叫。
   * 完整重建所有路線線條（路線數量少，效能可接受）。
   */
  update(routes: TransportRouteRenderData[]): void {
    if (!this.scene) return;

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

      const points: THREE.Vector3[] = [];
      for (const stop of route.stops) {
        points.push(new THREE.Vector3(
          stop.x + 0.5, // 格子中心
          TransportRouteRenderer.LINE_Y,
          stop.y + 0.5,
        ));
      }
      // 環形路線：連回第一站
      points.push(points[0]!.clone());

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: route.color,
        linewidth: 2,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });

      const line = new THREE.Line(geometry, material);
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
  }

  /** 返回當前渲染的路線數量（用於測試） */
  getLineCount(): number {
    return this.lines.length;
  }
}
