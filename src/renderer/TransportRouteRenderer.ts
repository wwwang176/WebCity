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
 * TransportRouteRenderer — draws the transport routes' connecting lines.
 *
 * Coloured lines between stops let the player see routes on the map, with one colour per transport
 * system. Only rebuilds when route data actually changes (fingerprint check).
 */
export class TransportRouteRenderer {
  private lines: THREE.Line[] = [];
  private scene: THREE.Scene | null = null;
  private lastFingerprint = 0;

  /** A fixed Y, just above the ground to avoid z-fighting. */
  private static readonly LINE_Y = 0.15;

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    this.lastFingerprint = 0;
  }

  /**
   * Updates the route lines. Called every frame, but a fingerprint detects route changes and it only
   * rebuilds when something actually changed.
   */
  update(routes: TransportRouteRenderData[]): void {
    if (!this.scene) return;

    // Skip rebuild if routes haven't changed
    const fp = routeFingerprint(routes);
    if (fp === this.lastFingerprint) return;
    this.lastFingerprint = fp;

    // Clear the old lines.
    for (const line of this.lines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines.length = 0;

    // Build one line per route.
    for (const route of routes) {
      if (route.stops.length < 2) continue;

      // Each hop arcs as a parabola and the last wraps back to the first stop. The arc arithmetic
      // lives in core; this only joins the points.
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

  /** The number of routes currently drawn, for tests. */
  getLineCount(): number {
    return this.lines.length;
  }
}
