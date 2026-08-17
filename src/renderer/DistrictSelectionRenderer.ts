import * as THREE from 'three';
import type { OutlineSegment } from '../core/district/DistrictOutline';

/**
 * 選取中分區的外框。
 *
 * 分區筆刷的 +/− 改的是「選取中的那一區」，所以那一區是誰必須在地圖上看得見 ——
 * 只寫在工具列上的話，玩家的視線在地圖上，改到的卻是別的地方。
 *
 * 畫外框而不是把整區塗亮:分區圖層本來就在那些格子上鋪了顏色，再疊一層半透明的白
 * 只會讓那一區看起來褪色。
 *
 * 用三角形帶而不是 `LineSegments`:`linewidth` 在多數平台上被忽略，一像素的線在
 * 等角視角下幾乎看不見。
 */
export class DistrictSelectionRenderer {
  /** 外框的寬度（格）。 */
  private static readonly WIDTH = 0.22;
  /** 浮在分區圖層（0.1）之上。 */
  private static readonly HEIGHT = 0.14;
  /** 蓋過圖層那一層。 */
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
      // 法線往兩側各推半個寬度；兩端也各延長半個寬度，轉角才接得起來。
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

    // depthTest 關掉:外框要能穿過建築看見。半塊被樓擋住的邊界比沒有邊界更難讀。
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
