import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/**
 * 飛機模型 — 低多邊形客機，vertex colors 內建。
 * 朝 +X 方向（與其他車輛相同慣例）。
 * 包含導航燈色塊：左翼尖紅、右翼尖綠、尾部白。
 */
export function buildAirplaneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // ── 機身 (fuselage) ──
  const fuse = new THREE.BoxGeometry(0.60, 0.10, 0.10);
  fuse.translate(0, 0.05, 0);
  setVertexColors(fuse, 0.96, 0.96, 0.96);
  parts.push(fuse);

  // ── 駕駛艙 (cockpit windshield) ──
  const cockpit = new THREE.BoxGeometry(0.06, 0.06, 0.096);
  cockpit.translate(0.28, 0.07, 0);
  setVertexColors(cockpit, 0.1, 0.15, 0.25);
  parts.push(cockpit);

  // ── 主翼 (wings) ──
  const wing = new THREE.BoxGeometry(0.18, 0.012, 0.60);
  wing.translate(-0.02, 0.05, 0);
  setVertexColors(wing, 0.90, 0.90, 0.90);
  parts.push(wing);

  // ── 左翼尖導航燈 (port - red) — enlarged for visibility ──
  const navLeft = new THREE.BoxGeometry(0.04, 0.02, 0.04);
  navLeft.translate(-0.02, 0.055, -0.31);
  setVertexColors(navLeft, 1.0, 0.1, 0.1);
  parts.push(navLeft);

  // ── 右翼尖導航燈 (starboard - green) ──
  const navRight = new THREE.BoxGeometry(0.04, 0.02, 0.04);
  navRight.translate(-0.02, 0.055, 0.31);
  setVertexColors(navRight, 0.1, 1.0, 0.1);
  parts.push(navRight);

  // ── 垂直尾翼 (vertical stabilizer) ──
  const vTail = new THREE.BoxGeometry(0.10, 0.11, 0.012);
  vTail.translate(-0.25, 0.12, 0);
  setVertexColors(vTail, 0.13, 0.59, 0.95);
  parts.push(vTail);

  // ── 水平尾翼 (horizontal stabilizer) ──
  const hTail = new THREE.BoxGeometry(0.08, 0.01, 0.24);
  hTail.translate(-0.25, 0.08, 0);
  setVertexColors(hTail, 0.90, 0.90, 0.90);
  parts.push(hTail);

  // ── 尾部白色導航燈 (tail - white) — enlarged ──
  const navTail = new THREE.BoxGeometry(0.03, 0.02, 0.03);
  navTail.translate(-0.31, 0.08, 0);
  setVertexColors(navTail, 1.0, 1.0, 1.0);
  parts.push(navTail);

  // ── 引擎 (engines ×2, under wings) ──
  const engineGeo = new THREE.CylinderGeometry(0.024, 0.030, 0.10, 6);
  engineGeo.rotateZ(Math.PI / 2);
  for (const dz of [-0.16, 0.16]) {
    const eng = engineGeo.clone();
    eng.translate(0.02, 0.03, dz);
    setVertexColors(eng, 0.45, 0.45, 0.45);
    parts.push(eng);
  }

  return mergeGeometries(parts)!;
}
