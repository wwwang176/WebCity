import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

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
