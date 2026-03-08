import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RoadType, ROAD_CONFIGS } from '../core/road/types';

const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.3,
  [RoadType.TWO_LANE]: 0.4,
  [RoadType.FOUR_LANE]: 0.6,
  [RoadType.SIX_LANE]: 0.8,
  [RoadType.HIGHWAY]: 0.9,
  [RoadType.ONE_WAY]: 0.35,
};

export class RoadRenderer {
  private instancedMesh: THREE.InstancedMesh | null = null;
  private readonly maxRoads = 10000;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const roadCells: { x: number; y: number; roadType: number; roadFlags: number }[] = [];

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.roadType !== RoadType.NONE) {
          roadCells.push({ x, y, roadType: cell.roadType, roadFlags: cell.roadFlags });
        }
      }
    }

    if (roadCells.length === 0) return;

    const geometry = new THREE.BoxGeometry(1, 0.05, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x424242 });
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, Math.min(roadCells.length, this.maxRoads));
    this.instancedMesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < Math.min(roadCells.length, this.maxRoads); i++) {
      const r = roadCells[i]!;
      const width = ROAD_WIDTHS[r.roadType] ?? 0.4;
      matrix.makeScale(width, 1, width);
      matrix.setPosition(r.x, 0.03, r.y);
      this.instancedMesh.setMatrixAt(i, matrix);

      // Darker color for bigger roads
      const roadConfig = ROAD_CONFIGS[r.roadType as keyof typeof ROAD_CONFIGS];
      const darkness = roadConfig ? Math.max(0.2, 0.5 - roadConfig.lanes * 0.05) : 0.35;
      color.setRGB(darkness, darkness, darkness);
      this.instancedMesh.setColorAt(i, color);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    scene.add(this.instancedMesh);
  }

  dispose(scene: THREE.Scene): void {
    if (this.instancedMesh) {
      scene.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
    }
  }
}
