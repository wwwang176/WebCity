import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';

export type OverlayType = 'none' | 'traffic' | 'landValue' | 'pollution' | 'crime' | 'power' | 'water' | 'zone' | 'police' | 'fire' | 'health' | 'education' | 'park' | 'garbage';

export class OverlayRenderer {
  private mesh: THREE.Mesh | null = null;
  private currentOverlay: OverlayType = 'none';

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

  private getColor(type: OverlayType, value: number): THREE.Color {
    switch (type) {
      case 'traffic':
        return new THREE.Color().setHSL(0.33 - value * 0.33, 0.8, 0.5); // Green to red
      case 'landValue':
        return new THREE.Color().setHSL(0.6 - value * 0.6, 0.7, 0.5); // Blue to red
      case 'pollution':
        return new THREE.Color(value, value * 0.3, 0); // Dark brown/orange
      case 'crime':
        return new THREE.Color(value, 0, value * 0.5); // Purple
      case 'power':
        return new THREE.Color(value, value, 0); // Yellow
      case 'water':
        return new THREE.Color(0, value * 0.5, value); // Blue
      case 'zone':
        return new THREE.Color(value * 0.5, value, value * 0.3); // Green-ish
      case 'police':
        return new THREE.Color(0.2, 0.3, value); // Blue
      case 'fire':
        return new THREE.Color(value, 0.15, 0.1); // Red
      case 'health':
        return new THREE.Color(value, 0.1, 0.4); // Pink
      case 'education':
        return new THREE.Color(0.4, 0.3, value * 0.6); // Brown
      case 'park':
        return new THREE.Color(0.1, value, 0.2); // Green
      case 'garbage':
        return new THREE.Color(value * 0.5, value * 0.4, 0.1); // Olive
      default:
        return new THREE.Color(0.5, 0.5, 0.5);
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
