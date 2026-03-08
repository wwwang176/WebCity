import * as THREE from 'three';

export class GridCursor {
  private mesh: THREE.Mesh;
  private gridWidth: number;
  private gridHeight: number;
  gridX = 0;
  gridY = 0;

  constructor(scene: THREE.Scene, gridWidth: number, gridHeight: number) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, 0.15, 0);
    scene.add(this.mesh);
  }

  update(raycaster: THREE.Raycaster, groundPlane: THREE.Plane): void {
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, intersection);

    if (intersection) {
      this.gridX = Math.round(intersection.x);
      this.gridY = Math.round(intersection.z);
      this.gridX = Math.max(0, Math.min(this.gridWidth - 1, this.gridX));
      this.gridY = Math.max(0, Math.min(this.gridHeight - 1, this.gridY));
      this.mesh.position.set(this.gridX, 0.15, this.gridY);
    }
  }

  setColor(color: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(color);
  }

  setOpacity(opacity: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
