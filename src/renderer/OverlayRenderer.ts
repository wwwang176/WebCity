import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';

export type OverlayType = 'none' | 'traffic' | 'landValue' | 'pollution' | 'crime' | 'power' | 'water' | 'zone' | 'police' | 'fire' | 'health' | 'education' | 'park' | 'garbage' | 'district';

export class OverlayRenderer {
  private mesh: THREE.Mesh | null = null;
  private currentOverlay: OverlayType = 'none';
  private readonly _reusableColor = new THREE.Color();

  getOverlay(): OverlayType {
    return this.currentOverlay;
  }

  setOverlay(type: OverlayType, scene: THREE.Scene, grid: Grid, data?: Map<string, number>): void {
    this.dispose(scene);
    this.currentOverlay = type;

    if (type === 'none') return;

    const w = grid.width;
    const h = grid.height;
    const geometry = new THREE.PlaneGeometry(w, h, w, h);
    geometry.rotateX(-Math.PI / 2);

    const colors = new Float32Array((w + 1) * (h + 1) * 3);
    const alphas = new Float32Array((w + 1) * (h + 1));

    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const idx = j * (w + 1) + i;
        const gx = Math.min(i, w - 1);
        const gy = Math.min(j, h - 1);
        const value = data?.get(`${gx},${gy}`) ?? 0;
        const normalized = Math.min(1, Math.max(0, value / 100));

        const color = this.getColor(type, normalized);
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
        alphas[idx] = normalized * 0.6;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(w / 2 - 0.5, 0.1, h / 2 - 0.5);
    scene.add(this.mesh);
  }

  /** Returns a reusable Color — caller must read r/g/b before calling again. */
  private getColor(type: OverlayType, value: number): THREE.Color {
    const c = this._reusableColor;
    switch (type) {
      case 'traffic':
        return c.setHSL(0.33 - value * 0.33, 0.8, 0.5); // Green to red
      case 'landValue':
        return c.setHSL(0.6 - value * 0.6, 0.7, 0.5); // Blue to red
      case 'pollution':
        return c.setRGB(value, value * 0.3, 0); // Dark brown/orange
      case 'crime':
        return c.setRGB(value, 0, value * 0.5); // Purple
      case 'power':
        if (value >= 0.8) return c.setRGB(0.2, 0.9, 0.3);
        if (value >= 0.3) return c.setRGB(1.0, 0.8, 0.1);
        if (value > 0) return c.setRGB(0.9, 0.2, 0.15);
        return c.setRGB(0, 0, 0);
      case 'water':
        if (value >= 0.8) return c.setRGB(0.1, 0.5, 0.9);
        if (value >= 0.3) return c.setRGB(1.0, 0.8, 0.1);
        if (value >= 0.1) return c.setRGB(0.9, 0.2, 0.15);
        if (value > 0) return c.setRGB(0.0, 0.1 + value * 3, 0.3 + value * 5);
        return c.setRGB(0, 0, 0);
      case 'zone':
        return c.setRGB(value * 0.5, value, value * 0.3);
      case 'police':
        return c.setRGB(0.2, 0.3, value);
      case 'fire':
        return c.setRGB(value, 0.15, 0.1);
      case 'health':
        return c.setRGB(value, 0.1, 0.4);
      case 'education':
        return c.setRGB(0.4, 0.3, value * 0.6);
      case 'park':
        return c.setRGB(0.1, value, 0.2);
      case 'garbage':
        return c.setRGB(value * 0.5, value * 0.4, 0.1);
      default:
        return c.setRGB(0.5, 0.5, 0.5);
    }
  }

  dispose(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }
}
