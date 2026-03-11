import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Vertex color helper ──────────────────────────────────────────────

export function setVertexColors(geo: THREE.BufferGeometry, r: number, g: number, b: number): void {
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

export function buildCarGeometry(): THREE.BufferGeometry {
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

export function buildBusGeometry(): THREE.BufferGeometry {
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

export function buildTruckGeometry(): THREE.BufferGeometry {
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

export function buildFiretruckGeometry(): THREE.BufferGeometry {
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
export function buildTransportBusGeometry(): THREE.BufferGeometry {
  return buildBusGeometry();
}

/** 地鐵列車 — 長方形車廂，比公車更大更高 */
export function buildMetroTrainGeometry(): THREE.BufferGeometry {
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
export function buildTramGeometry(): THREE.BufferGeometry {
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
export function buildRailTrainGeometry(): THREE.BufferGeometry {
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
export function buildFerryGeometry(): THREE.BufferGeometry {
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
export function buildTaxiGeometry(): THREE.BufferGeometry {
  return buildCarGeometry();
}
