import * as THREE from 'three';
import { type TrafficLight } from '../core/traffic/TrafficLights';

/**
 * Renders traffic lights at intersections.
 * Each intersection gets 4 indicator lights (one per approach direction).
 * Green = can pass, Red = must stop.
 */
export class TrafficLightRenderer {
  private poleMesh: THREE.InstancedMesh | null = null;
  private lightMesh: THREE.InstancedMesh | null = null;
  private readonly maxLights = 2000; // 500 intersections × 4 indicators
  private lightCount = 0;
  private lightData: { x: number; z: number; isNS: boolean }[] = [];

  build(scene: THREE.Scene, lights: TrafficLight[]): void {
    this.dispose(scene);
    if (lights.length === 0) return;

    this.lightData = [];

    // For each intersection, place 4 indicator lights
    // Positioned on each approach road, near the intersection edge
    for (const light of lights) {
      const cx = light.x;
      const cz = light.y;
      const offset = 0.42; // near edge of cell
      const side = 0.18; // offset to road side

      // N approach (coming from -z): indicator at (cx+side, cz-offset) — NS direction
      this.lightData.push({ x: cx + side, z: cz - offset, isNS: true });
      // S approach (coming from +z): indicator at (cx-side, cz+offset) — NS direction
      this.lightData.push({ x: cx - side, z: cz + offset, isNS: true });
      // E approach (coming from +x): indicator at (cx+offset, cz+side) — EW direction
      this.lightData.push({ x: cx + offset, z: cz + side, isNS: false });
      // W approach (coming from -x): indicator at (cx-offset, cz-side) — EW direction
      this.lightData.push({ x: cx - offset, z: cz - side, isNS: false });
    }

    this.lightCount = Math.min(this.lightData.length, this.maxLights);

    // Poles — thin dark cylinders
    const poleGeo = new THREE.BoxGeometry(0.012, 0.18, 0.012);
    poleGeo.translate(0, 0.09, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    this.poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, this.lightCount);
    this.poleMesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < this.lightCount; i++) {
      const d = this.lightData[i]!;
      matrix.makeTranslation(d.x, 0.05, d.z);
      this.poleMesh.setMatrixAt(i, matrix);
    }
    this.poleMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.poleMesh);

    // Light heads — small boxes that change color
    const lightGeo = new THREE.BoxGeometry(0.025, 0.025, 0.025);
    lightGeo.translate(0, 0.195, 0);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, this.lightCount);
    this.lightMesh.frustumCulled = false;

    for (let i = 0; i < this.lightCount; i++) {
      const d = this.lightData[i]!;
      matrix.makeTranslation(d.x, 0.05, d.z);
      this.lightMesh.setMatrixAt(i, matrix);
    }
    this.lightMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.lightMesh);
  }

  /**
   * Update light colors based on current traffic light phases.
   * Call this every frame or every tick.
   */
  update(lights: TrafficLight[]): void {
    if (!this.lightMesh || this.lightCount === 0) return;

    const color = new THREE.Color();
    const GREEN = new THREE.Color(0x00cc44);
    const RED = new THREE.Color(0xdd2200);

    let idx = 0;
    for (const light of lights) {
      if (idx + 4 > this.lightCount) break;

      // phase 0 = NS green, EW red
      const nsGreen = light.phase === 0;

      // N approach — NS
      color.copy(nsGreen ? GREEN : RED);
      this.lightMesh.setColorAt(idx++, color);
      // S approach — NS
      this.lightMesh.setColorAt(idx++, color);
      // E approach — EW
      color.copy(nsGreen ? RED : GREEN);
      this.lightMesh.setColorAt(idx++, color);
      // W approach — EW
      this.lightMesh.setColorAt(idx++, color);
    }

    if (this.lightMesh.instanceColor) {
      this.lightMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of [this.poleMesh, this.lightMesh]) {
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.poleMesh = null;
    this.lightMesh = null;
    this.lightData = [];
    this.lightCount = 0;
  }
}
