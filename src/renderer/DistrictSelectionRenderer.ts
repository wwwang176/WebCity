import * as THREE from 'three';
import type { OutlineSegment } from '../core/district/DistrictOutline';

/**
 * The selected district's outline.
 *
 * The district brush's + and - act on the selected district, so which one that is has to be visible
 * on the map: stated only in the toolbar, the player's eyes are on the map while what changes is
 * somewhere else.
 *
 * An outline rather than brightening the whole district: the district overlay already lays colour
 * on those cells, and a translucent white on top only makes the district look washed out.
 *
 * A triangle strip rather than `LineSegments`: `linewidth` is ignored on most platforms, and a
 * one-pixel line is barely visible in an isometric view.
 */
export class DistrictSelectionRenderer {
  /** The outline's width, in cells. */
  private static readonly WIDTH = 0.22;
  /** Sits above the district overlay at 0.1. */
  private static readonly HEIGHT = 0.14;
  /** Draws over the overlay layer. */
  private static readonly RENDER_ORDER = 3;

  private mesh: THREE.Mesh | null = null;

  setSelection(scene: THREE.Scene, segments: readonly OutlineSegment[], color: number): void {
    this.clear(scene);
    if (segments.length === 0) return;

    const positions = new Float32Array(segments.length * 18);   // 每段 2 個三角形
    const hw = DistrictSelectionRenderer.WIDTH / 2;
    const y = DistrictSelectionRenderer.HEIGHT;
    let o = 0;

    for (const s of segments) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // Pushed half a width along the normal on each side, and extended half a width at each end so
      // corners meet.
      const nx = -uy * hw, ny = ux * hw;
      const ax = s.x1 - ux * hw, ay = s.y1 - uy * hw;
      const bx = s.x2 + ux * hw, by = s.y2 + uy * hw;

      const quad = [
        ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny,
        ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny,
      ];
      for (let i = 0; i < quad.length; i += 2) {
        positions[o++] = quad[i]!;
        positions[o++] = y;
        positions[o++] = quad[i + 1]!;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // depthTest is off: the outline has to show through buildings. A boundary half-hidden behind a
    // building is harder to read than no boundary at all.
    const material = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = DistrictSelectionRenderer.RENDER_ORDER;
    scene.add(this.mesh);
  }

  clear(scene: THREE.Scene): void {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}
