import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

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
