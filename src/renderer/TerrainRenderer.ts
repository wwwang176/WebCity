import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';

const TERRAIN_COLORS: Record<number, number> = {
  [TerrainType.PLAIN]: 0x4caf50,
  [TerrainType.WATER]: 0x2196f3,
  [TerrainType.MOUNTAIN]: 0x795548,
  [TerrainType.FOREST]: 0x2e7d32,
};

export class TerrainRenderer {
  private mesh: THREE.Mesh | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private waterTime = 0;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const w = grid.width;
    const h = grid.height;

    // Ground plane geometry with vertex colors
    const geometry = new THREE.PlaneGeometry(w, h, w, h);
    geometry.rotateX(-Math.PI / 2);

    const colors = new Float32Array((w + 1) * (h + 1) * 3);
    const positions = geometry.attributes['position'] as THREE.BufferAttribute;

    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const idx = j * (w + 1) + i;
        const gx = Math.min(i, w - 1);
        const gy = Math.min(j, h - 1);
        const cell = grid.getCell(gx, gy);
        const terrain = cell ? cell.terrainType : TerrainType.PLAIN;
        const color = new THREE.Color(TERRAIN_COLORS[terrain] ?? 0x4caf50);

        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;

        // Elevation
        if (cell) {
          const elevation = (cell.elevation || 0) * 0.3;
          positions.setY(idx, terrain === TerrainType.WATER ? -0.2 : elevation);
        }
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.position.set(w / 2 - 0.5, 0, h / 2 - 0.5);
    scene.add(this.mesh);

    // Water plane (semi-transparent overlay)
    this.buildWater(scene, grid);
  }

  private buildWater(scene: THREE.Scene, grid: Grid): void {
    const waterGeometry = new THREE.PlaneGeometry(grid.width, grid.height);
    waterGeometry.rotateX(-Math.PI / 2);
    const waterMaterial = new THREE.MeshLambertMaterial({
      color: 0x1565c0,
      transparent: true,
      opacity: 0.4,
    });
    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.set(grid.width / 2 - 0.5, -0.1, grid.height / 2 - 0.5);
    scene.add(this.waterMesh);
  }

  update(dt: number): void {
    if (this.waterMesh) {
      this.waterTime += dt;
      this.waterMesh.position.y = -0.1 + Math.sin(this.waterTime * 2) * 0.02;
    }
  }

  dispose(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (this.waterMesh) {
      scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
      this.waterMesh = null;
    }
  }
}
