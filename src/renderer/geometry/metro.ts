import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

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

/** 地鐵單節車廂 — 比完整列車短（~0.22 長），用於 3 車廂編組 */
export function buildMetroCarriageGeometry(): THREE.BufferGeometry {
  // 車體
  const body = new THREE.BoxGeometry(0.22, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // 窗帶
  const windowStrip = new THREE.BoxGeometry(0.16, 0.03, 0.122);
  windowStrip.translate(0, 0.08, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.21, 0.01, 0.11);
  roof.translate(0, 0.105, 0);
  setVertexColors(roof, 0.65, 0.65, 0.65);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof];

  // 轉向架
  const bogieGeo = new THREE.BoxGeometry(0.05, 0.015, 0.13);
  for (const bx of [0.07, -0.07]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}
