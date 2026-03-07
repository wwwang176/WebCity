import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { ZoneType } from '../core/grid/types';

const ZONE_COLORS: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]: 0x66bb6a,
  [ZoneType.RESIDENTIAL_HIGH]: 0x43a047,
  [ZoneType.COMMERCIAL_LOW]: 0x42a5f5,
  [ZoneType.COMMERCIAL_HIGH]: 0x1e88e5,
  [ZoneType.INDUSTRIAL]: 0xffa726,
  [ZoneType.OFFICE]: 0xab47bc,
};

const ZONE_HEIGHTS: Record<number, { min: number; max: number }> = {
  [ZoneType.RESIDENTIAL_LOW]: { min: 0.3, max: 0.8 },
  [ZoneType.RESIDENTIAL_HIGH]: { min: 1.0, max: 3.0 },
  [ZoneType.COMMERCIAL_LOW]: { min: 0.4, max: 0.9 },
  [ZoneType.COMMERCIAL_HIGH]: { min: 1.2, max: 2.5 },
  [ZoneType.INDUSTRIAL]: { min: 0.5, max: 1.2 },
  [ZoneType.OFFICE]: { min: 1.5, max: 4.0 },
};

export class BuildingRenderer {
  private instancedMeshes: Map<number, THREE.InstancedMesh> = new Map();
  private readonly maxPerType = 5000;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    // Collect buildings by zone type
    const buildingsByZone = new Map<number, { x: number; y: number; level: number }[]>();

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.buildingId > 0 && cell.zoneType !== ZoneType.NONE) {
          if (!buildingsByZone.has(cell.zoneType)) {
            buildingsByZone.set(cell.zoneType, []);
          }
          buildingsByZone.get(cell.zoneType)!.push({
            x, y,
            level: Math.max(1, Math.min(3, Math.ceil(cell.serviceCoverage / 3) || 1)),
          });
        }
      }
    }

    const matrix = new THREE.Matrix4();

    for (const [zoneType, buildings] of buildingsByZone) {
      const color = ZONE_COLORS[zoneType] ?? 0x888888;
      const heightRange = ZONE_HEIGHTS[zoneType] ?? { min: 0.3, max: 1.0 };
      const count = Math.min(buildings.length, this.maxPerType);

      const geometry = new THREE.BoxGeometry(0.7, 1, 0.7);
      geometry.translate(0, 0.5, 0); // Pivot at bottom
      const material = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      for (let i = 0; i < count; i++) {
        const b = buildings[i]!;
        const levelFactor = b.level / 3;
        const height = heightRange.min + (heightRange.max - heightRange.min) * levelFactor;
        // Use deterministic pseudo-random height variation based on position
        const variation = 1.0 + (((b.x * 7 + b.y * 13) % 10) / 10 - 0.5) * 0.3;
        const finalHeight = height * variation;

        matrix.makeScale(1, finalHeight, 1);
        matrix.setPosition(b.x, 0.05, b.y);
        mesh.setMatrixAt(i, matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      this.instancedMeshes.set(zoneType, mesh);
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.instancedMeshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.instancedMeshes.clear();
  }
}
