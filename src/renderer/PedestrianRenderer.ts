import * as THREE from 'three';
import { buildPersonGeometry } from './geometry/person';
import { PedestrianState } from '../core/traffic/PedestrianAgent';

const SIDEWALK_Y = 0.028;

/** Camera culling radius (world units ≈ grid cells) */
const CULL_RADIUS = 15;

const PERSON_COLORS = [
  0x2196f3, // blue
  0xf44336, // red
  0x4caf50, // green
  0xff9800, // orange
  0x9c27b0, // purple
  0x00bcd4, // cyan
  0xffeb3b, // yellow
  0x795548, // brown
  0x607d8b, // blue-grey
  0xe91e63, // pink
  0x3f51b5, // indigo
  0x009688, // teal
];

export interface PedestrianRenderData {
  id: number;
  x: number;
  y: number;
  heading: number;
  colorIndex: number;
  state: PedestrianState;
  lateralOffset: number;
}

export class PedestrianRenderer {
  private mesh: THREE.InstancedMesh | null = null;
  private readonly maxCount = 2000;

  build(scene: THREE.Scene): void {
    this.dispose(scene);
    const geo = buildPersonGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(pedestrians: PedestrianRenderData[]): void {
    if (!this.mesh) return;
    const count = Math.min(pedestrians.length, this.maxCount);
    this.mesh.count = count;

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = pedestrians[i]!;

      // Apply lateral offset perpendicular to heading
      const ox = Math.sin(p.heading) * p.lateralOffset;
      const oz = Math.cos(p.heading) * p.lateralOffset;
      matrix.makeTranslation(p.x + ox, SIDEWALK_Y, p.y + oz);
      rotation.makeRotationY(p.heading);
      matrix.multiply(rotation);
      this.mesh.setMatrixAt(i, matrix);

      color.setHex(PERSON_COLORS[p.colorIndex % PERSON_COLORS.length]!);
      this.mesh.setColorAt(i, color);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene?: THREE.Scene): void {
    if (this.mesh) {
      if (scene) scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }

  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }
}

/** Filter pedestrians to only those within CULL_RADIUS of the camera target. */
export function cullPedestrians(
  pedestrians: ReadonlyArray<{ id: number; position: { x: number; y: number }; heading: number; colorIndex: number; state: PedestrianState; lateralOffset: number }>,
  cameraX: number,
  cameraZ: number,
): PedestrianRenderData[] {
  const rSq = CULL_RADIUS * CULL_RADIUS;
  const result: PedestrianRenderData[] = [];

  for (const p of pedestrians) {
    if (p.state === PedestrianState.ARRIVED) continue;
    const dx = p.position.x - cameraX;
    const dz = p.position.y - cameraZ;
    if (dx * dx + dz * dz > rSq) continue;

    result.push({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      heading: p.heading,
      colorIndex: p.colorIndex,
      state: p.state,
      lateralOffset: p.lateralOffset,
    });
  }
  return result;
}
