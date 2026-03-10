import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

// ── Transport system vehicle geometry builders ───────────────────────

/** 交通系統公車 — 與道路 bus 相同模型但顏色不同（由 update() 上色） */
function buildTransportBusGeometry(): THREE.BufferGeometry {
  return buildBusGeometry();
}

/** 地鐵列車 — 長方形車廂，比公車更大更高 */
function buildMetroTrainGeometry(): THREE.BufferGeometry {
  // 主車體
  const body = new THREE.BoxGeometry(0.55, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // 窗帶
  const windowStrip = new THREE.BoxGeometry(0.45, 0.03, 0.122);
  windowStrip.translate(0, 0.08, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.54, 0.01, 0.11);
  roof.translate(0, 0.105, 0);
  setVertexColors(roof, 0.65, 0.65, 0.65);

  // 前端（流線型）
  const nose = new THREE.BoxGeometry(0.06, 0.08, 0.11);
  nose.translate(0.28, 0.04, 0);
  setVertexColors(nose, 0.9, 0.9, 0.9);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, nose];

  // 車輪 — 地鐵沒有明顯車輪但加上轉向架
  const bogieGeo = new THREE.BoxGeometry(0.08, 0.015, 0.13);
  for (const bx of [0.18, -0.18]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}

/** 電車 — 中型車輛，有集電弓（pantograph） */
function buildTramGeometry(): THREE.BufferGeometry {
  // 車體
  const body = new THREE.BoxGeometry(0.4, 0.065, 0.1);
  body.translate(0, 0.032, 0);
  setVertexColors(body, 1, 1, 1);

  // 窗帶
  const windowStrip = new THREE.BoxGeometry(0.32, 0.022, 0.102);
  windowStrip.translate(0, 0.055, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.39, 0.008, 0.094);
  roof.translate(0, 0.072, 0);
  setVertexColors(roof, 0.7, 0.7, 0.7);

  // 集電弓（pantograph）
  const pantoBase = new THREE.BoxGeometry(0.02, 0.03, 0.04);
  pantoBase.translate(0, 0.09, 0);
  setVertexColors(pantoBase, 0.3, 0.3, 0.3);

  const pantoArm = new THREE.BoxGeometry(0.005, 0.025, 0.06);
  pantoArm.translate(0, 0.115, 0);
  setVertexColors(pantoArm, 0.4, 0.4, 0.4);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, pantoBase, pantoArm];

  // 車輪
  const wheelGeo = new THREE.BoxGeometry(0.035, 0.018, 0.014);
  for (const [wx, wz] of [
    [0.13, 0.052], [0.13, -0.052],
    [-0.13, 0.052], [-0.13, -0.052],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.009, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}

/** 火車 — 大型車輛，有機車頭和車廂 */
function buildRailTrainGeometry(): THREE.BufferGeometry {
  // 機車頭
  const loco = new THREE.BoxGeometry(0.2, 0.1, 0.12);
  loco.translate(0.22, 0.05, 0);
  setVertexColors(loco, 1, 1, 1);

  // 擋風玻璃
  const windshield = new THREE.BoxGeometry(0.006, 0.05, 0.11);
  windshield.translate(0.32, 0.06, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  // 車廂
  const car = new THREE.BoxGeometry(0.35, 0.09, 0.12);
  car.translate(-0.06, 0.045, 0);
  setVertexColors(car, 0.85, 0.85, 0.85);

  // 車廂窗帶
  const carWindows = new THREE.BoxGeometry(0.3, 0.025, 0.122);
  carWindows.translate(-0.06, 0.07, 0);
  setVertexColors(carWindows, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.6, 0.01, 0.11);
  roof.translate(0.06, 0.1, 0);
  setVertexColors(roof, 0.6, 0.6, 0.6);

  const parts: THREE.BufferGeometry[] = [loco, windshield, car, carWindows, roof];

  // 轉向架
  const bogieGeo = new THREE.BoxGeometry(0.08, 0.015, 0.13);
  for (const bx of [0.22, -0.1]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}

/** 渡輪 — 船型，稍大 */
function buildFerryGeometry(): THREE.BufferGeometry {
  // 船體（底部）
  const hull = new THREE.BoxGeometry(0.4, 0.04, 0.14);
  hull.translate(0, 0.02, 0);
  setVertexColors(hull, 1, 1, 1);

  // 船首（尖端）
  const bow = new THREE.BoxGeometry(0.08, 0.035, 0.08);
  bow.translate(0.22, 0.017, 0);
  setVertexColors(bow, 0.9, 0.9, 0.9);

  // 甲板
  const deck = new THREE.BoxGeometry(0.32, 0.01, 0.12);
  deck.translate(-0.02, 0.045, 0);
  setVertexColors(deck, 0.8, 0.75, 0.65);

  // 駕駛艙
  const cabin = new THREE.BoxGeometry(0.08, 0.05, 0.08);
  cabin.translate(-0.1, 0.075, 0);
  setVertexColors(cabin, 0.95, 0.95, 0.95);

  // 窗戶
  const cabinWindow = new THREE.BoxGeometry(0.004, 0.025, 0.082);
  cabinWindow.translate(-0.06, 0.07, 0);
  setVertexColors(cabinWindow, 0.08, 0.1, 0.15);

  // 煙囪
  const funnel = new THREE.BoxGeometry(0.02, 0.04, 0.025);
  funnel.translate(-0.14, 0.07, 0);
  setVertexColors(funnel, 0.3, 0.3, 0.3);

  return mergeGeometries([hull, bow, deck, cabin, cabinWindow, funnel])!;
}

/** 計程車 — 與轎車相同模型但顏色為黃色（由 update() 上色） */
function buildTaxiGeometry(): THREE.BufferGeometry {
  return buildCarGeometry();
}

// ── Renderer ─────────────────────────────────────────────────────────

export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private readonly maxPerType = 500;
  private readonly maxLights = 2000; // total vehicles across all types

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

        rotation.makeRotationY(v.heading);
        translation.makeTranslation(vx, 0.025, vz);
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
    }

    // Update headlight/taillight counts and opacity
    if (this.headlightMesh && this.taillightMesh) {
      this.headlightMesh.count = lightIndex;
      this.taillightMesh.count = lightIndex;
      this.headlightMesh.instanceMatrix.needsUpdate = true;
      this.taillightMesh.instanceMatrix.needsUpdate = true;

      // Control opacity based on sun intensity
      const sun = sunIntensity ?? 1;
      const hlOpacity = Math.max(0, 0.4 * (1 - sun / 0.3));
      const tlOpacity = Math.max(0, 0.25 * (1 - sun / 0.3));
      if (this.headlightMaterial) this.headlightMaterial.opacity = hlOpacity;
      if (this.taillightMaterial) this.taillightMaterial.opacity = tlOpacity;
    }
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
