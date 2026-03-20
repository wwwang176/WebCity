import * as THREE from 'three';

export class GridCursor {
  private mesh: THREE.Mesh;
  private scene: THREE.Scene;
  private gridWidth: number;
  private gridHeight: number;
  private sizeW = 1;
  private sizeH = 1;
  private centered = false;
  private readonly _intersection = new THREE.Vector3();
  gridX = 0;
  gridY = 0;

  constructor(scene: THREE.Scene, gridWidth: number, gridHeight: number) {
    this.scene = scene;
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

  setSize(w: number, h: number, centered = false): void {
    if (this.sizeW === w && this.sizeH === h && this.centered === centered) return;
    this.sizeW = w;
    this.sizeH = h;
    this.centered = centered;
    // Replace geometry with new dimensions
    this.mesh.geometry.dispose();
    const newGeo = new THREE.PlaneGeometry(w, h);
    newGeo.rotateX(-Math.PI / 2);
    this.mesh.geometry = newGeo;
    // Update position to reflect new offset (don't wait for next mousemove)
    const offsetX = centered ? 0 : (w - 1) / 2;
    const offsetZ = centered ? 0 : (h - 1) / 2;
    this.mesh.position.set(this.gridX + offsetX, 0.15, this.gridY + offsetZ);
  }

  update(raycaster: THREE.Raycaster, groundPlane: THREE.Plane): void {
    const intersection = this._intersection;
    raycaster.ray.intersectPlane(groundPlane, intersection);

    if (intersection) {
      this.gridX = Math.round(intersection.x);
      this.gridY = Math.round(intersection.z);
      this.gridX = Math.max(0, Math.min(this.gridWidth - 1, this.gridX));
      this.gridY = Math.max(0, Math.min(this.gridHeight - 1, this.gridY));
      // Offset so cursor covers the multi-cell footprint from the primary cell
      const offsetX = this.centered ? 0 : (this.sizeW - 1) / 2;
      const offsetZ = this.centered ? 0 : (this.sizeH - 1) / 2;
      this.mesh.position.set(this.gridX + offsetX, 0.15, this.gridY + offsetZ);
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
