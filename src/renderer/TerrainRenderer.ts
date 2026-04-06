import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';
import { isStoneGround } from '../core/grid/GroundType';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';

const TERRAIN_COLORS: Record<number, number> = {
  [TerrainType.PLAIN]: 0x4caf50,
  [TerrainType.WATER]: 0x2196f3,
  [TerrainType.MOUNTAIN]: 0x4caf50,
  [TerrainType.FOREST]: 0x2e7d32,
};

const STONE_COLOR = 0x9e9e9e;

// Tree constants
const TREE = {
  TRUNK_RADIUS: 0.04,
  TRUNK_HEIGHT: 0.35,
  CROWN_RADIUS: 0.28,
  CROWN_HEIGHT: 0.6,
  TRUNK_COLOR: 0x5d4037,
  CROWN_COLOR: 0x1b5e20,
  MAX_TREES: 8000,
  TREES_PER_CELL: 2,
} as const;

/** Simple hash for deterministic per-cell tree placement. */
function cellHash(x: number, y: number, i: number): number {
  let h = (x * 374761393 + y * 668265263 + i * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return (h ^ (h >> 16)) >>> 0;
}

export class TerrainRenderer {
  private mesh: THREE.Mesh | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private waterTime = 0;
  private grid: Grid | null = null;
  private groundTexture: THREE.DataTexture | null = null;
  private treeTrunkMesh: THREE.InstancedMesh | null = null;
  private treeCrownMesh: THREE.InstancedMesh | null = null;
  private scene: THREE.Scene | null = null;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);
    this.grid = grid;
    this.scene = scene;

    const w = grid.width;
    const h = grid.height;

    // Ground plane geometry
    const geometry = new THREE.PlaneGeometry(w, h, w, h);
    geometry.rotateX(-Math.PI / 2);

    // Set elevation per vertex
    const positions = geometry.attributes['position'] as THREE.BufferAttribute;
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const idx = j * (w + 1) + i;
        const gx = Math.min(i, w - 1);
        const gy = Math.min(j, h - 1);
        const cell = grid.getCell(gx, gy);
        if (cell) {
          const terrain = cell.terrainType;
          const elevation = (cell.elevation || 0) * 0.3;
          positions.setY(idx, terrain === TerrainType.WATER ? -0.2 : elevation);
        }
      }
    }
    geometry.computeVertexNormals();

    // DataTexture for per-cell coloring (sharp boundaries, no bleeding)
    this.groundTexture = this.createGroundTexture(grid);

    const material = new THREE.MeshLambertMaterial({
      map: this.groundTexture,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.set(w / 2 - 0.5, 0, h / 2 - 0.5);
    scene.add(this.mesh);

    // Water plane (semi-transparent overlay)
    this.buildWater(scene, grid);

    // Forest trees
    this.buildTrees(scene, grid);
  }

  /** Refresh ground texture and trees (call when buildings/roads change) */
  refreshColors(): void {
    if (!this.groundTexture || !this.grid) return;
    this.updateGroundTexture(this.groundTexture, this.grid);
    if (this.scene) this.rebuildTrees(this.grid);
  }

  private createGroundTexture(grid: Grid): THREE.DataTexture {
    const w = grid.width;
    const h = grid.height;
    const data = new Uint8Array(w * h * 4);

    this.fillTextureData(data, grid, w, h);

    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private updateGroundTexture(texture: THREE.DataTexture, grid: Grid): void {
    const w = grid.width;
    const h = grid.height;
    const data = texture.image.data as Uint8Array;

    this.fillTextureData(data, grid, w, h);
    texture.needsUpdate = true;
  }

  private fillTextureData(data: Uint8Array, grid: Grid, w: number, h: number): void {
    const tmpColor = new THREE.Color();

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = grid.getCell(x, y);
        const stone = cell ? isStoneGround(cell) : false;
        const terrain = cell ? cell.terrainType : TerrainType.PLAIN;
        const colorHex = stone ? STONE_COLOR : (TERRAIN_COLORS[terrain] ?? 0x4caf50);
        tmpColor.set(colorHex);

        // DataTexture row 0 = bottom of texture = UV v=0
        // After PlaneGeometry.rotateX(-PI/2), UV v=0 maps to +Z (high grid Y)
        // So flip: texture row (h-1-y) corresponds to grid row y
        const ty = h - 1 - y;
        const idx = (ty * w + x) * 4;
        data[idx] = Math.round(tmpColor.r * 255);
        data[idx + 1] = Math.round(tmpColor.g * 255);
        data[idx + 2] = Math.round(tmpColor.b * 255);
        data[idx + 3] = 255;
      }
    }
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

  private buildTrees(scene: THREE.Scene, grid: Grid): void {
    // Shared geometries
    const trunkGeo = new THREE.CylinderGeometry(TREE.TRUNK_RADIUS, TREE.TRUNK_RADIUS, TREE.TRUNK_HEIGHT, 5);
    const crownGeo = new THREE.ConeGeometry(TREE.CROWN_RADIUS, TREE.CROWN_HEIGHT, 6);

    const trunkMat = new THREE.MeshLambertMaterial({ color: TREE.TRUNK_COLOR });
    const crownMat = new THREE.MeshLambertMaterial({ color: TREE.CROWN_COLOR });

    this.treeTrunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE.MAX_TREES);
    this.treeCrownMesh = new THREE.InstancedMesh(crownGeo, crownMat, TREE.MAX_TREES);
    this.treeTrunkMesh.castShadow = true;
    this.treeCrownMesh.castShadow = true;
    this.treeTrunkMesh.receiveShadow = true;
    this.treeCrownMesh.receiveShadow = true;

    this.populateTreeInstances(grid);

    scene.add(this.treeTrunkMesh);
    scene.add(this.treeCrownMesh);
  }

  private rebuildTrees(grid: Grid): void {
    if (!this.treeTrunkMesh || !this.treeCrownMesh) return;
    this.populateTreeInstances(grid);
  }

  private populateTreeInstances(grid: Grid): void {
    if (!this.treeTrunkMesh || !this.treeCrownMesh) return;

    const dummy = new THREE.Object3D();
    let count = 0;
    const w = grid.width;
    const h = grid.height;

    for (let y = 0; y < h && count < TREE.MAX_TREES; y++) {
      for (let x = 0; x < w && count < TREE.MAX_TREES; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.terrainType !== TerrainType.FOREST) continue;
        if (cell.buildingId > 0 || cell.roadType !== 0 || cell.railType !== 0) continue;

        for (let i = 0; i < TREE.TREES_PER_CELL && count < TREE.MAX_TREES; i++) {
          const hash = cellHash(x, y, i);
          // Deterministic position within cell (±0.35 from center)
          const ox = ((hash & 0xff) / 255 - 0.5) * 0.7;
          const oz = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.7;
          // Slight scale variation
          const scale = 0.8 + ((hash >> 16) & 0xff) / 255 * 0.4;

          const px = x + ox;
          const pz = y + oz;

          // Trunk
          dummy.position.set(px, TREE.TRUNK_HEIGHT * scale * 0.5, pz);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          this.treeTrunkMesh.setMatrixAt(count, dummy.matrix);

          // Crown (sits on top of trunk)
          dummy.position.set(px, TREE.TRUNK_HEIGHT * scale + TREE.CROWN_HEIGHT * scale * 0.4, pz);
          dummy.updateMatrix();
          this.treeCrownMesh.setMatrixAt(count, dummy.matrix);

          count++;
        }
      }
    }

    // Hide unused instances by zeroing their scale
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = count; i < TREE.MAX_TREES; i++) {
      this.treeTrunkMesh.setMatrixAt(i, zeroMatrix);
      this.treeCrownMesh.setMatrixAt(i, zeroMatrix);
    }

    this.treeTrunkMesh.count = count;
    this.treeCrownMesh.count = count;
    this.treeTrunkMesh.instanceMatrix.needsUpdate = true;
    this.treeCrownMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.waterMesh) {
      this.waterTime += dt;
      this.waterMesh.position.y = -0.1 + Math.sin(this.waterTime * 2) * 0.02;
    }
  }

  /** Switch to underground visual mode (white semi-transparent terrain). */
  setViewMode(mode: ViewMode): void {
    const op = VIEW_MODE_OPACITY[mode];
    const dimmed = op.terrain < 1.0;
    if (this.mesh) {
      const mat = this.mesh.material as THREE.MeshLambertMaterial;
      if (dimmed) {
        mat.transparent = true;
        mat.opacity = op.terrain;
        mat.depthWrite = false;
        mat.color.set(0xdddddd);
        mat.map = null;
        mat.needsUpdate = true;
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.color.set(0xffffff);
        mat.map = this.groundTexture;
        mat.needsUpdate = true;
      }
      this.mesh.renderOrder = dimmed ? 20 : 0;
    }
    if (this.waterMesh) {
      const wMat = this.waterMesh.material as THREE.MeshLambertMaterial;
      if (dimmed) {
        wMat.opacity = 0.08;
        wMat.color.set(0xcccccc);
        wMat.depthWrite = false;
      } else {
        wMat.opacity = 0.4;
        wMat.color.set(0x1565c0);
        wMat.depthWrite = false;
      }
      this.waterMesh.renderOrder = dimmed ? 20 : 0;
    }
    if (this.treeTrunkMesh) this.treeTrunkMesh.visible = !dimmed;
    if (this.treeCrownMesh) this.treeCrownMesh.visible = !dimmed;
  }

  dispose(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.MeshLambertMaterial).dispose();
      if (this.groundTexture) {
        this.groundTexture.dispose();
        this.groundTexture = null;
      }
      this.mesh = null;
    }
    if (this.waterMesh) {
      scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
      this.waterMesh = null;
    }
    if (this.treeTrunkMesh) {
      scene.remove(this.treeTrunkMesh);
      this.treeTrunkMesh.geometry.dispose();
      (this.treeTrunkMesh.material as THREE.Material).dispose();
      this.treeTrunkMesh = null;
    }
    if (this.treeCrownMesh) {
      scene.remove(this.treeCrownMesh);
      this.treeCrownMesh.geometry.dispose();
      (this.treeCrownMesh.material as THREE.Material).dispose();
      this.treeCrownMesh = null;
    }
  }
}
