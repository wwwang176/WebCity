import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface VehicleData {
  id: number;
  x: number;
  y: number;
  heading: number; // radians, 0 = facing +x (east)
  type: 'car' | 'bus' | 'truck' | 'firetruck';
  laneOffset: number; // lateral offset perpendicular to heading (positive = right of heading)
}

const CAR_COLORS = [
  0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xf4511e,
  0x8e24aa, 0x546e7a, 0xd4e157, 0xff8a65, 0x90a4ae,
  0x3949ab, 0x00897b, 0xc0ca33, 0x6d4c41, 0xffffff,
  0x263238, 0x1565c0, 0x4e342e,
];

// ── Vertex color helper ──────────────────────────────────────────────

function setVertexColors(geo: THREE.BufferGeometry, r: number, g: number, b: number): void {
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ── Geometry builders (car faces +x direction) ──────────────────────

function buildCarGeometry(): THREE.BufferGeometry {
  // Lower body (chassis + hood + trunk)
  const body = new THREE.BoxGeometry(0.22, 0.04, 0.09);
  body.translate(0, 0.02, 0);
  setVertexColors(body, 1, 1, 1);

  // Cabin with windows (set back slightly)
  const cabin = new THREE.BoxGeometry(0.1, 0.033, 0.082);
  cabin.translate(-0.02, 0.053, 0);
  setVertexColors(cabin, 0.1, 0.13, 0.18);

  // Hood surface
  const hood = new THREE.BoxGeometry(0.055, 0.005, 0.085);
  hood.translate(0.07, 0.042, 0);
  setVertexColors(hood, 0.85, 0.85, 0.85);

  // Wheels (4 corners)
  const parts: THREE.BufferGeometry[] = [body, cabin, hood];
  const wheelGeo = new THREE.BoxGeometry(0.03, 0.018, 0.014);
  for (const [wx, wz] of [[0.065, 0.048], [0.065, -0.048], [-0.065, 0.048], [-0.065, -0.048]]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.009, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights (2 small yellow boxes at front)
  const hlGeo = new THREE.BoxGeometry(0.008, 0.012, 0.015);
  for (const wz of [0.032, -0.032]) {
    const hl = hlGeo.clone();
    hl.translate(0.112, 0.025, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  // Taillights (2 small red boxes at rear)
  const tlGeo = new THREE.BoxGeometry(0.008, 0.012, 0.018);
  for (const wz of [0.033, -0.033]) {
    const tl = tlGeo.clone();
    tl.translate(-0.112, 0.025, wz);
    setVertexColors(tl, 0.8, 0.1, 0.1);
    parts.push(tl);
  }

  return mergeGeometries(parts)!;
}

function buildBusGeometry(): THREE.BufferGeometry {
  // Long rectangular body
  const body = new THREE.BoxGeometry(0.45, 0.07, 0.1);
  body.translate(0, 0.035, 0);
  setVertexColors(body, 1, 1, 1);

  // Window strip (dark band)
  const windowStrip = new THREE.BoxGeometry(0.36, 0.025, 0.102);
  windowStrip.translate(-0.015, 0.06, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // Roof
  const roof = new THREE.BoxGeometry(0.44, 0.008, 0.094);
  roof.translate(0, 0.078, 0);
  setVertexColors(roof, 0.75, 0.75, 0.75);

  // Windshield (front)
  const windshield = new THREE.BoxGeometry(0.006, 0.04, 0.095);
  windshield.translate(0.225, 0.05, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, windshield];

  // Wheels (6 — front pair + rear double)
  const wheelGeo = new THREE.BoxGeometry(0.04, 0.022, 0.016);
  for (const [wx, wz] of [
    [0.15, 0.055], [0.15, -0.055],
    [-0.12, 0.055], [-0.12, -0.055],
    [-0.17, 0.055], [-0.17, -0.055],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.011, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}

function buildTruckGeometry(): THREE.BufferGeometry {
  // Cab (front)
  const cab = new THREE.BoxGeometry(0.1, 0.065, 0.1);
  cab.translate(0.11, 0.032, 0);
  setVertexColors(cab, 1, 1, 1);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.006, 0.028, 0.096);
  cabWindow.translate(0.162, 0.045, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Cab side windows
  const sideWinGeo = new THREE.BoxGeometry(0.04, 0.022, 0.005);
  const cabSideL = sideWinGeo.clone();
  cabSideL.translate(0.1, 0.048, 0.052);
  setVertexColors(cabSideL, 0.08, 0.1, 0.15);
  const cabSideR = sideWinGeo.clone();
  cabSideR.translate(0.1, 0.048, -0.052);
  setVertexColors(cabSideR, 0.08, 0.1, 0.15);

  // Cargo container (behind cab)
  const cargo = new THREE.BoxGeometry(0.22, 0.085, 0.1);
  cargo.translate(-0.05, 0.042, 0);
  setVertexColors(cargo, 0.7, 0.72, 0.74);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, cabSideL, cabSideR, cargo];

  // Wheels (6)
  const wheelGeo = new THREE.BoxGeometry(0.035, 0.02, 0.015);
  for (const [wx, wz] of [
    [0.11, 0.054], [0.11, -0.054],
    [-0.08, 0.054], [-0.08, -0.054],
    [-0.12, 0.054], [-0.12, -0.054],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.01, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.006, 0.012, 0.016);
  for (const wz of [0.035, -0.035]) {
    const hl = hlGeo.clone();
    hl.translate(0.162, 0.02, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  return mergeGeometries(parts)!;
}

function buildFiretruckGeometry(): THREE.BufferGeometry {
  // Cab (front, red)
  const cab = new THREE.BoxGeometry(0.1, 0.065, 0.1);
  cab.translate(0.13, 0.032, 0);
  setVertexColors(cab, 1, 1, 1);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.006, 0.028, 0.096);
  cabWindow.translate(0.182, 0.045, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Equipment body
  const body = new THREE.BoxGeometry(0.24, 0.055, 0.1);
  body.translate(-0.02, 0.027, 0);
  setVertexColors(body, 1, 1, 1);

  // Hose reel / equipment compartments (side panels)
  const panelGeo = new THREE.BoxGeometry(0.16, 0.025, 0.005);
  const panelL = panelGeo.clone();
  panelL.translate(-0.02, 0.04, 0.052);
  setVertexColors(panelL, 0.6, 0.6, 0.6);
  const panelR = panelGeo.clone();
  panelR.translate(-0.02, 0.04, -0.052);
  setVertexColors(panelR, 0.6, 0.6, 0.6);

  // Ladder rack on top
  const ladder = new THREE.BoxGeometry(0.2, 0.01, 0.03);
  ladder.translate(-0.01, 0.062, 0);
  setVertexColors(ladder, 0.5, 0.5, 0.5);

  // Light bar (flashing red/blue)
  const lightBar = new THREE.BoxGeometry(0.04, 0.014, 0.06);
  lightBar.translate(0.13, 0.072, 0);
  setVertexColors(lightBar, 1.0, 0.15, 0.15);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, body, panelL, panelR, ladder, lightBar];

  // Wheels (6)
  const wheelGeo = new THREE.BoxGeometry(0.035, 0.02, 0.015);
  for (const [wx, wz] of [
    [0.13, 0.054], [0.13, -0.054],
    [-0.06, 0.054], [-0.06, -0.054],
    [-0.1, 0.054], [-0.1, -0.054],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.01, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}

// ── Renderer ─────────────────────────────────────────────────────────

export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private readonly maxPerType = 500;

  build(scene: THREE.Scene): void {
    this.dispose(scene);

    const types: [string, THREE.BufferGeometry][] = [
      ['car', buildCarGeometry()],
      ['bus', buildBusGeometry()],
      ['truck', buildTruckGeometry()],
      ['firetruck', buildFiretruckGeometry()],
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
  }

  update(vehicles: VehicleData[]): void {
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

    for (const [type, mesh] of this.meshes) {
      const list = groups.get(type) ?? [];
      const count = Math.min(list.length, this.maxPerType);
      mesh.count = count;

      for (let i = 0; i < count; i++) {
        const v = list[i]!;

        // Lane offset: perpendicular to heading direction
        // Positive laneOffset shifts to the right of heading (sin/cos pattern)
        const offsetX = Math.sin(v.heading) * v.laneOffset;
        const offsetZ = Math.cos(v.heading) * v.laneOffset;

        rotation.makeRotationY(v.heading);
        translation.makeTranslation(v.x + offsetX, 0.025, v.y + offsetZ);
        matrix.copy(translation).multiply(rotation);
        mesh.setMatrixAt(i, matrix);

        // Color: cars get random per-ID color, others are fixed
        if (type === 'car') {
          color.set(CAR_COLORS[v.id % CAR_COLORS.length]!);
        } else if (type === 'bus') {
          color.set(0xff9800);
        } else if (type === 'truck') {
          color.set(0x78909c);
        } else {
          color.set(0xd32f2f);
        }
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.meshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();
  }
}
