import * as THREE from 'three';
import { VEHICLE_CONFIG } from './vehicleConfig';
import { buildAirplaneNavLightsGeometry, buildAirplaneVTailGeometry } from './geometry';
import { ViewMode, getVehicleVisibility } from '../core/ViewMode';

/** Airline body colors (vivid, multiplied with near-white vertex colors). */
const AIRLINE_BODY_COLORS = [
  0xffffff, 0x42a5f5, 0x66bb6a, 0xffa726, 0xec407a,
  0x26c6da, 0xab47bc, 0xffee58, 0x78909c, 0xff7043,
];

/** Airline tail colors (bold, shown directly via white vertex colors). */
const AIRLINE_TAIL_COLORS = [
  0x1565c0, 0xc62828, 0x2e7d32, 0xe65100, 0x6a1b9a,
  0x00695c, 0x0d47a1, 0xd32f2f, 0xef6c00, 0x4a148c,
];

export interface VehicleData {
  id: number;
  x: number;
  y: number;
  heading: number; // radians, 0 = facing +x (east)
  type: 'car' | 'van' | 'bus' | 'truck' | 'firetruck' | 'police_car' | 'ambulance' | 'garbage_truck' | 'transport_bus' | 'rail_train' | 'rail_carriage' | 'ferry' | 'airplane';
  laneOffset: number; // lateral offset perpendicular to heading (positive = right of heading)
  /** World Y position override (airplane altitude). */
  altitude?: number;
  /** Pitch angle in radians (nose up = positive). */
  pitch?: number;
  /** Roll angle in radians (right wing down = positive). */
  roll?: number;
  /** Uniform scale override. */
  scale?: number;
  /** Elevation level (0 = ground, 1-3 = elevated). Adds level × 0.6 to Y. */
  elevation?: number;
}

const CAR_COLORS = [
  0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xf4511e,
  0x8e24aa, 0x546e7a, 0xd4e157, 0xff8a65, 0x90a4ae,
  0x3949ab, 0x00897b, 0xc0ca33, 0x6d4c41, 0xffffff,
  0x263238, 0x1565c0, 0x4e342e,
];

/** Commercial / utility vehicle colors (trucks & vans). */
const COMMERCIAL_COLORS = [
  0xffffff, 0xeceff1, 0xcfd8dc,  // white / light grey (most common)
  0x37474f, 0x263238,             // dark grey / charcoal
  0x1565c0, 0x0d47a1,            // blue fleet
  0xc62828, 0xbf360c,            // red / dark orange
  0x2e7d32, 0x1b5e20,            // green
  0xf9a825, 0xff8f00,            // yellow / amber
];

// ── Renderer ─────────────────────────────────────────────────────────

export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private readonly maxPerType = 500;
  private readonly maxLights = 2000; // total vehicles across all types
  private _viewMode = ViewMode.NORMAL;

  // Airplane sub-meshes: separate InstancedMesh for vtail (random color) and nav lights (blink)
  private airplaneVTailMesh: THREE.InstancedMesh | null = null;
  private airplaneNavMesh: THREE.InstancedMesh | null = null;

  // Headlight / taillight instanced meshes
  private headlightMesh: THREE.InstancedMesh | null = null;
  private taillightMesh: THREE.InstancedMesh | null = null;
  private headlightMaterial: THREE.MeshBasicMaterial | null = null;
  private taillightMaterial: THREE.MeshBasicMaterial | null = null;

  // Reusable per-frame objects (avoids ~720 allocations/second at 60fps)
  private readonly _groups = new Map<string, VehicleData[]>();
  private readonly _rotation = new THREE.Matrix4();
  private readonly _pitchRoll = new THREE.Matrix4();
  private readonly _pitchMat = new THREE.Matrix4();
  private readonly _translation = new THREE.Matrix4();
  private readonly _matrix = new THREE.Matrix4();
  private readonly _color = new THREE.Color();
  private readonly _hlMatrix = new THREE.Matrix4();
  private readonly _hlTranslation = new THREE.Matrix4();
  private readonly _tlMatrix = new THREE.Matrix4();
  private readonly _tlTranslation = new THREE.Matrix4();

  build(scene: THREE.Scene): void {
    this.dispose(scene);

    for (const [type, cfg] of Object.entries(VEHICLE_CONFIG)) {
      const geometry = cfg.buildGeometry();
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geometry, material, this.maxPerType);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(type, mesh);
    }

    // Airplane vertical tail: separate mesh for independent airline tail color
    const vtGeo = buildAirplaneVTailGeometry();
    const vtMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.airplaneVTailMesh = new THREE.InstancedMesh(vtGeo, vtMat, this.maxPerType);
    this.airplaneVTailMesh.count = 0;
    this.airplaneVTailMesh.castShadow = true;
    this.airplaneVTailMesh.frustumCulled = false;
    scene.add(this.airplaneVTailMesh);

    // Airplane nav lights: separate mesh with MeshBasicMaterial (always bright)
    const navGeo = buildAirplaneNavLightsGeometry();
    const navMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.airplaneNavMesh = new THREE.InstancedMesh(navGeo, navMat, this.maxPerType);
    this.airplaneNavMesh.count = 0;
    this.airplaneNavMesh.frustumCulled = false;
    scene.add(this.airplaneNavMesh);

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

  update(vehicles: VehicleData[], sunIntensity?: number, time?: number, simSpeed?: number): void {
    // Group vehicles by type (reuse Map + clear arrays instead of creating new ones)
    const groups = this._groups;
    for (const arr of groups.values()) arr.length = 0;
    for (const v of vehicles) {
      let arr = groups.get(v.type);
      if (!arr) { arr = []; groups.set(v.type, arr); }
      arr.push(v);
    }

    const rotation = this._rotation;
    const translation = this._translation;
    const matrix = this._matrix;
    const color = this._color;

    // Collect all vehicles in order for headlight/taillight indexing
    let lightIndex = 0;
    const hlMatrix = this._hlMatrix;
    const hlTranslation = this._hlTranslation;
    const tlMatrix = this._tlMatrix;
    const tlTranslation = this._tlTranslation;

    for (const [type, mesh] of this.meshes) {
      const list = groups.get(type) ?? [];
      const count = Math.min(list.length, this.maxPerType);
      mesh.count = count;

      const cfg = VEHICLE_CONFIG[type];
      const fOff = cfg?.frontOffset ?? 0.12;
      const rOff = cfg?.rearOffset ?? 0.12;

      for (let i = 0; i < count; i++) {
        const v = list[i]!;

        // Lane offset: perpendicular to heading direction
        // Positive laneOffset shifts to the right of heading (sin/cos pattern)
        const offsetX = Math.sin(v.heading) * v.laneOffset;
        const offsetZ = Math.cos(v.heading) * v.laneOffset;

        const vx = v.x + offsetX;
        const vz = v.y + offsetZ;

        // Ferry bobbing animation: gentle vertical oscillation on water
        let yPos = cfg?.yPosition ?? 0.025;
        if (type === 'ferry' && time !== undefined) {
          yPos += Math.sin(time * 2 + v.id * 1.7) * 0.012;
        }
        // Airplane: override Y with altitude
        if (type === 'airplane' && v.altitude !== undefined) {
          yPos = v.altitude;
        }
        // Elevated road: add elevation height
        if (v.elevation && v.elevation > 0) {
          yPos += v.elevation * 0.6;
        }

        rotation.makeRotationY(v.heading);
        // Pitch/roll: apply in local space (airplane, ramp vehicles, etc.)
        if (v.pitch || v.roll) {
          const pr = this._pitchRoll;
          pr.makeRotationX(v.roll ?? 0);
          if (v.pitch) {
            this._pitchMat.makeRotationZ(v.pitch);
            pr.multiply(this._pitchMat);
          }
          rotation.multiply(pr);
        }
        translation.makeTranslation(vx, yPos, vz);
        matrix.copy(translation).multiply(rotation);
        if (v.scale !== undefined) {
          this._pitchRoll.makeScale(v.scale, v.scale, v.scale);
          matrix.multiply(this._pitchRoll);
        }
        mesh.setMatrixAt(i, matrix);

        // Color: per-instance random from type-appropriate palette
        if (cfg && cfg.color === -1) {
          if (type === 'airplane') {
            color.set(AIRLINE_BODY_COLORS[v.id % AIRLINE_BODY_COLORS.length]!);
          } else {
            const palette = (type === 'truck' || type === 'van')
              ? COMMERCIAL_COLORS : CAR_COLORS;
            color.set(palette[v.id % palette.length]!);
          }
        } else {
          color.set(cfg?.color ?? 0xd32f2f);
        }
        mesh.setColorAt(i, color);

        // Airplane vtail: set tail color from separate palette
        if (type === 'airplane' && this.airplaneVTailMesh) {
          color.set(AIRLINE_TAIL_COLORS[(v.id * 7 + 3) % AIRLINE_TAIL_COLORS.length]!);
          this.airplaneVTailMesh.setColorAt(i, color);
        }

        // Headlight/taillight matrices — skip for rail carriages only
        if (type === 'rail_carriage') continue;
        if (lightIndex < this.maxLights && this.headlightMesh && this.taillightMesh) {
          const cosH = Math.cos(v.heading);
          const sinH = Math.sin(v.heading);

          // Headlight beam: position at car front, rotate to match heading
          // Beam geometry extends along local +X, so Y-rotate by heading
          const hlX = vx + cosH * fOff;
          const hlZ = vz - sinH * fOff;
          // Light Y: airplane follows altitude; others use base + elevation
          const lightY = type === 'airplane' ? yPos + 0.01 : 0.055 + (v.elevation ? v.elevation * 0.6 : 0);
          hlMatrix.makeRotationY(v.heading);
          if (type === 'airplane') {
            // Airplane: pitch rotation + 2× longer/wider beam
            if (v.pitch) {
              this._pitchMat.makeRotationZ(v.pitch);
              hlMatrix.multiply(this._pitchMat);
            }
            this._pitchRoll.makeScale(2, 1, 2);
            hlMatrix.multiply(this._pitchRoll);
          }
          hlTranslation.makeTranslation(hlX, lightY, hlZ);
          hlMatrix.premultiply(hlTranslation);
          this.headlightMesh.setMatrixAt(lightIndex, hlMatrix);

          // Taillights: offset backward (airplanes: hide with zero scale)
          if (type === 'airplane') {
            tlMatrix.makeScale(0, 0, 0);
          } else {
            const tlX = vx - cosH * rOff;
            const tlZ = vz + sinH * rOff;
            tlTranslation.makeTranslation(tlX, lightY, tlZ);
            tlMatrix.copy(tlTranslation);
          }
          this.taillightMesh.setMatrixAt(lightIndex, tlMatrix);

          lightIndex++;
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // Focus modes: show only relevant vehicle types
      mesh.visible = getVehicleVisibility(this._viewMode, type);
    }

    // Airplane sub-meshes: copy transforms from main airplane mesh
    const airplaneMesh = this.meshes.get('airplane');
    if (airplaneMesh) {
      const count = airplaneMesh.count;
      const m = this._matrix;

      // Vertical tail (with per-instance airline tail color)
      if (this.airplaneVTailMesh) {
        this.airplaneVTailMesh.count = count;
        for (let i = 0; i < count; i++) {
          airplaneMesh.getMatrixAt(i, m);
          this.airplaneVTailMesh.setMatrixAt(i, m);
        }
        if (count > 0) {
          this.airplaneVTailMesh.instanceMatrix.needsUpdate = true;
          if (this.airplaneVTailMesh.instanceColor) this.airplaneVTailMesh.instanceColor.needsUpdate = true;
        }
      }

      // Nav lights (blink)
      if (this.airplaneNavMesh) {
        this.airplaneNavMesh.count = count;
        for (let i = 0; i < count; i++) {
          airplaneMesh.getMatrixAt(i, m);
          this.airplaneNavMesh.setMatrixAt(i, m);
        }
        if (count > 0) this.airplaneNavMesh.instanceMatrix.needsUpdate = true;
        // Blink: short bright (20%), long dark (80%), follows game speed
        const blinkTime = time !== undefined ? time * (simSpeed ?? 1) : 0;
        const cycle = blinkTime % 1.0; // 1-second cycle
        this.airplaneNavMesh.visible = cycle < 0.2; // bright 0.2s, dark 0.8s
      }
    }

    // Update headlight/taillight counts and opacity
    if (this.headlightMesh && this.taillightMesh) {
      this.headlightMesh.count = lightIndex;
      this.taillightMesh.count = lightIndex;
      this.headlightMesh.instanceMatrix.needsUpdate = true;
      this.taillightMesh.instanceMatrix.needsUpdate = true;

      if (this._viewMode !== ViewMode.NORMAL) {
        if (this.headlightMaterial) this.headlightMaterial.opacity = 0;
        if (this.taillightMaterial) this.taillightMaterial.opacity = 0;
      } else {
        // Control opacity based on sun intensity
        const sun = sunIntensity ?? 1;
        const hlOpacity = Math.max(0, 0.6 * (1 - sun / 0.8));
        const tlOpacity = Math.max(0, 0.375 * (1 - sun / 0.8));
        if (this.headlightMaterial) this.headlightMaterial.opacity = hlOpacity;
        if (this.taillightMaterial) this.taillightMaterial.opacity = tlOpacity;
      }
    }
  }

  /** Switch view mode — controls per-type vehicle visibility. */
  setViewMode(mode: ViewMode): void {
    this._viewMode = mode;
    for (const [type, mesh] of this.meshes) {
      mesh.visible = getVehicleVisibility(mode, type);
    }
    const showLights = mode === ViewMode.NORMAL;
    if (this.headlightMesh) this.headlightMesh.visible = showLights;
    if (this.taillightMesh) this.taillightMesh.visible = showLights;
  }

  /** @deprecated Use setViewMode instead. */
  setUndergroundMode(enabled: boolean): void {
    this.setViewMode(enabled ? ViewMode.UNDERGROUND : ViewMode.NORMAL);
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.meshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();
    if (this.airplaneVTailMesh) {
      scene.remove(this.airplaneVTailMesh);
      this.airplaneVTailMesh.geometry.dispose();
      (this.airplaneVTailMesh.material as THREE.Material).dispose();
      this.airplaneVTailMesh = null;
    }
    if (this.airplaneNavMesh) {
      scene.remove(this.airplaneNavMesh);
      this.airplaneNavMesh.geometry.dispose();
      (this.airplaneNavMesh.material as THREE.Material).dispose();
      this.airplaneNavMesh = null;
    }

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
