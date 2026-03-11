import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** 火車機車頭 — 單節車頭，作為列車最前方車廂 */
export function buildRailTrainGeometry(): THREE.BufferGeometry {
  // 車體
  const body = new THREE.BoxGeometry(0.22, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // 擋風玻璃（前端）
  const windshield = new THREE.BoxGeometry(0.006, 0.05, 0.11);
  windshield.translate(0.113, 0.06, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.22, 0.01, 0.11);
  roof.translate(0, 0.1, 0);
  setVertexColors(roof, 0.6, 0.6, 0.6);

  const parts: THREE.BufferGeometry[] = [body, windshield, roof];

  // 轉向架
  const bogieGeo = new THREE.BoxGeometry(0.06, 0.015, 0.13);
  for (const bx of [0.07, -0.07]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}

/** 火車客車廂 — 尾隨車廂，排在機車頭後方 */
export function buildRailCarriageGeometry(): THREE.BufferGeometry {
  // 車體
  const body = new THREE.BoxGeometry(0.25, 0.09, 0.12);
  body.translate(0, 0.045, 0);
  setVertexColors(body, 0.85, 0.85, 0.85);

  // 窗帶
  const windows = new THREE.BoxGeometry(0.2, 0.025, 0.122);
  windows.translate(0, 0.07, 0);
  setVertexColors(windows, 0.08, 0.1, 0.15);

  // 車頂
  const roof = new THREE.BoxGeometry(0.25, 0.01, 0.11);
  roof.translate(0, 0.09, 0);
  setVertexColors(roof, 0.6, 0.6, 0.6);

  const parts: THREE.BufferGeometry[] = [body, windows, roof];

  // 轉向架
  const bogieGeo = new THREE.BoxGeometry(0.06, 0.015, 0.13);
  for (const bx of [0.09, -0.09]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}
