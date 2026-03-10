import * as THREE from 'three';
import { UNDERGROUND_TUNNEL_Y } from '../core/ViewMode';
import {
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildTransportBusGeometry,
  buildMetroTrainGeometry,
  buildTramGeometry,
  buildRailTrainGeometry,
  buildFerryGeometry,
  buildTaxiGeometry,
} from './vehicleGeometry';

export interface VehicleData {
  id: number;
  x: number;
  y: number;
  heading: number; // radians, 0 = facing +x (east)
  type: 'car' | 'bus' | 'truck' | 'firetruck' | 'transport_bus' | 'metro_train' | 'tram' | 'rail_train' | 'ferry' | 'taxi';
  laneOffset: number; // lateral offset perpendicular to heading (positive = right of heading)
}

const CAR_COLORS = [
  0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xf4511e,
  0x8e24aa, 0x546e7a, 0xd4e157, 0xff8a65, 0x90a4ae,
  0x3949ab, 0x00897b, 0xc0ca33, 0x6d4c41, 0xffffff,
  0x263238, 0x1565c0, 0x4e342e,
];

// ── Renderer ─────────────────────────────────────────────────────────

export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private readonly maxPerType = 500;
  private readonly maxLights = 2000; // total vehicles across all types
  private _underground = false;

  // Headlight / taillight instanced meshes
  private headlightMesh: THREE.InstancedMesh | null = null;
  private taillightMesh: THREE.InstancedMesh | null = null;
  private headlightMaterial: THREE.MeshBasicMaterial | null = null;
  private taillightMaterial: THREE.MeshBasicMaterial | null = null;

  build(scene: THREE.Scene): void {
    this.dispose(scene);

    const types: [string, THREE.BufferGeometry][] = [
      ['car', buildCarGeometry()],
      ['bus', buildBusGeometry()],
      ['truck', buildTruckGeometry()],
      ['firetruck', buildFiretruckGeometry()],
      ['transport_bus', buildTransportBusGeometry()],
      ['metro_train', buildMetroTrainGeometry()],
      ['tram', buildTramGeometry()],
      ['rail_train', buildRailTrainGeometry()],
      ['ferry', buildFerryGeometry()],
      ['taxi', buildTaxiGeometry()],
    ];

    for (const [type, geometry] of types) {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geometry, material, this.maxPerType);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(type, mesh);
    }

    // Headlight beam: trapezoid projected forward (narrow at car, wide at far end)
    // Vertices in local XZ plane (Y=0, facing up), beam extends along local +X
    const hlGeo = new THREE.BufferGeometry();
    const hlVerts = new Float32Array([
      // near edge (at car front): narrow, width ±0.06
      0,    0, -0.06,
      0,    0,  0.06,
      // far edge (projected forward 0.5): wide, width ±0.2
      0.5,  0, -0.2,
      0.5,  0,  0.2,
    ]);
    const hlIdx = [0, 2, 1, 1, 2, 3]; // two triangles forming trapezoid
    // Vertex colors: bright at car (near), fade to black at far end
    const hlColors = new Float32Array([
      1, 1, 1,   // near-left: full brightness
      1, 1, 1,   // near-right: full brightness
      0, 0, 0,   // far-left: black (transparent via additive)
      0, 0, 0,   // far-right: black
    ]);
    hlGeo.setAttribute('position', new THREE.BufferAttribute(hlVerts, 3));
    hlGeo.setAttribute('color', new THREE.BufferAttribute(hlColors, 3));
    hlGeo.setIndex(hlIdx);
    this.headlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffcc,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.headlightMesh = new THREE.InstancedMesh(hlGeo, this.headlightMaterial, this.maxLights);
    this.headlightMesh.count = 0;
    this.headlightMesh.frustumCulled = false;
    this.headlightMesh.renderOrder = 10;
    scene.add(this.headlightMesh);

    // Taillight ground-disc mesh (red)
    const tlGeo = new THREE.CircleGeometry(0.08, 6);
    tlGeo.rotateX(-Math.PI / 2);
    this.taillightMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.taillightMesh = new THREE.InstancedMesh(tlGeo, this.taillightMaterial, this.maxLights);
    this.taillightMesh.count = 0;
    this.taillightMesh.frustumCulled = false;
    this.taillightMesh.renderOrder = 10;
    scene.add(this.taillightMesh);
  }

  update(vehicles: VehicleData[], sunIntensity?: number): void {
    // Group vehicles by type
    const groups = new Map<string, VehicleData[]>();
    for (const v of vehicles) {
      if (!groups.has(v.type)) groups.set(v.type, []);
      groups.get(v.type)!.push(v);
    }

    const rotation = new THREE.Matrix4();
    const translation = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    // Collect all vehicles in order for headlight/taillight indexing
    let lightIndex = 0;
    const hlMatrix = new THREE.Matrix4();
    const hlTranslation = new THREE.Matrix4();
    const tlMatrix = new THREE.Matrix4();
    const tlTranslation = new THREE.Matrix4();

    // Front offset distances by type (distance from center to front)
    const frontOffset: Record<string, number> = {
      car: 0.12,
      bus: 0.23,
      truck: 0.16,
      firetruck: 0.18,
      transport_bus: 0.23,
      metro_train: 0.3,
      tram: 0.2,
      rail_train: 0.33,
      ferry: 0.26,
      taxi: 0.12,
    };
    // Rear offset distances by type
    const rearOffset: Record<string, number> = {
      car: 0.12,
      bus: 0.23,
      truck: 0.16,
      firetruck: 0.14,
      transport_bus: 0.23,
      metro_train: 0.28,
      tram: 0.2,
      rail_train: 0.24,
      ferry: 0.2,
      taxi: 0.12,
    };

    for (const [type, mesh] of this.meshes) {
      const list = groups.get(type) ?? [];
      const count = Math.min(list.length, this.maxPerType);
      mesh.count = count;

      const fOff = frontOffset[type] ?? 0.12;
      const rOff = rearOffset[type] ?? 0.12;

      for (let i = 0; i < count; i++) {
        const v = list[i]!;

        // Lane offset: perpendicular to heading direction
        // Positive laneOffset shifts to the right of heading (sin/cos pattern)
        const offsetX = Math.sin(v.heading) * v.laneOffset;
        const offsetZ = Math.cos(v.heading) * v.laneOffset;

        const vx = v.x + offsetX;
        const vz = v.y + offsetZ;

        const vehicleY = type === 'metro_train' ? UNDERGROUND_TUNNEL_Y : 0.025;

        rotation.makeRotationY(v.heading);
        translation.makeTranslation(vx, vehicleY, vz);
        matrix.copy(translation).multiply(rotation);
        mesh.setMatrixAt(i, matrix);

        // Color: cars get random per-ID color, others are fixed
        if (type === 'car') {
          color.set(CAR_COLORS[v.id % CAR_COLORS.length]!);
        } else if (type === 'bus' || type === 'transport_bus') {
          color.set(0xff9800); // 橘色
        } else if (type === 'truck') {
          color.set(0x78909c);
        } else if (type === 'firetruck') {
          color.set(0xd32f2f);
        } else if (type === 'metro_train') {
          color.set(0x00bcd4); // 青色
        } else if (type === 'tram') {
          color.set(0x8bc34a); // 淺綠色
        } else if (type === 'rail_train') {
          color.set(0xff5722); // 橘紅色
        } else if (type === 'ferry') {
          color.set(0x0097a7); // 深青色
        } else if (type === 'taxi') {
          color.set(0xfdd835); // 黃色
        } else {
          color.set(0xd32f2f);
        }
        mesh.setColorAt(i, color);

        // Headlight/taillight matrices (heading: 0 = +x; rotation Y convention)
        if (lightIndex < this.maxLights && this.headlightMesh && this.taillightMesh) {
          const cosH = Math.cos(v.heading);
          const sinH = Math.sin(v.heading);

          // Headlight beam: position at car front, rotate to match heading
          // Beam geometry extends along local +X, so Y-rotate by heading
          const hlX = vx + cosH * fOff;
          const hlZ = vz - sinH * fOff;
          hlMatrix.makeRotationY(v.heading);
          hlTranslation.makeTranslation(hlX, 0.055, hlZ);
          hlMatrix.premultiply(hlTranslation);
          this.headlightMesh.setMatrixAt(lightIndex, hlMatrix);

          // Taillights: offset backward
          const tlX = vx - cosH * rOff;
          const tlZ = vz + sinH * rOff;
          tlTranslation.makeTranslation(tlX, 0.055, tlZ);
          tlMatrix.copy(tlTranslation);
          this.taillightMesh.setMatrixAt(lightIndex, tlMatrix);

          lightIndex++;
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // Visibility: underground mode shows only metro_train, normal hides it
      if (this._underground) {
        mesh.visible = type === 'metro_train';
      } else {
        mesh.visible = type !== 'metro_train';
      }
    }

    // Update headlight/taillight counts and opacity
    if (this.headlightMesh && this.taillightMesh) {
      this.headlightMesh.count = lightIndex;
      this.taillightMesh.count = lightIndex;
      this.headlightMesh.instanceMatrix.needsUpdate = true;
      this.taillightMesh.instanceMatrix.needsUpdate = true;

      if (this._underground) {
        if (this.headlightMaterial) this.headlightMaterial.opacity = 0;
        if (this.taillightMaterial) this.taillightMaterial.opacity = 0;
      } else {
        // Control opacity based on sun intensity
        const sun = sunIntensity ?? 1;
        const hlOpacity = Math.max(0, 0.4 * (1 - sun / 0.3));
        const tlOpacity = Math.max(0, 0.25 * (1 - sun / 0.3));
        if (this.headlightMaterial) this.headlightMaterial.opacity = hlOpacity;
        if (this.taillightMaterial) this.taillightMaterial.opacity = tlOpacity;
      }
    }
  }

  /** Switch to underground visual mode (hide surface vehicles). */
  setUndergroundMode(enabled: boolean): void {
    this._underground = enabled;
    for (const [type, mesh] of this.meshes) {
      if (type === 'metro_train') {
        // Metro trains become visible in underground mode
        mesh.visible = enabled;
      } else {
        // Surface vehicles hidden in underground mode
        mesh.visible = !enabled;
      }
    }
    if (this.headlightMesh) this.headlightMesh.visible = !enabled;
    if (this.taillightMesh) this.taillightMesh.visible = !enabled;
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.meshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();

    if (this.headlightMesh) {
      scene.remove(this.headlightMesh);
      this.headlightMesh.geometry.dispose();
      this.headlightMaterial?.dispose();
      this.headlightMesh = null;
      this.headlightMaterial = null;
    }
    if (this.taillightMesh) {
      scene.remove(this.taillightMesh);
      this.taillightMesh.geometry.dispose();
      this.taillightMaterial?.dispose();
      this.taillightMesh = null;
      this.taillightMaterial = null;
    }
  }
}
