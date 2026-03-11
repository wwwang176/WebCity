import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

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
