import * as THREE from 'three';

export interface VehicleData {
  id: number;
  x: number;
  y: number;
  type: 'car' | 'bus' | 'truck' | 'firetruck';
}

const VEHICLE_COLORS: Record<string, number> = {
  car: 0xf44336,
  bus: 0xff9800,
  truck: 0x607d8b,
  firetruck: 0xd32f2f,
};

export class VehicleRenderer {
  private instancedMesh: THREE.InstancedMesh | null = null;
  private readonly maxVehicles = 2000;

  build(scene: THREE.Scene): void {
    this.dispose(scene);

    const geometry = new THREE.BoxGeometry(0.3, 0.15, 0.2);
    geometry.translate(0, 0.15, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxVehicles);
    this.instancedMesh.count = 0;
    this.instancedMesh.castShadow = true;
    scene.add(this.instancedMesh);
  }

  update(vehicles: VehicleData[]): void {
    if (!this.instancedMesh) return;

    const count = Math.min(vehicles.length, this.maxVehicles);
    this.instancedMesh.count = count;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const v = vehicles[i]!;
      const scale = v.type === 'bus' ? 1.5 : v.type === 'truck' ? 1.3 : 1.0;
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(v.x, 0.05, v.y);
      this.instancedMesh.setMatrixAt(i, matrix);

      color.set(VEHICLE_COLORS[v.type] ?? 0xf44336);
      this.instancedMesh.setColorAt(i, color);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
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
