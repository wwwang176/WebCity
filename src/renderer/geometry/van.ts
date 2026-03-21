import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/**
 * Van / delivery van geometry (Ford Transit / HiAce style).
 * Real-world ~5.2m L × 1.95m W × 2.73m H → game 0.26 × 0.10 × 0.137 at 0.6x scale (1.3× visual boost).
 * Single tall boxy body with cab windows at front.
 */
export function buildVanGeometry(): THREE.BufferGeometry {
  // Main body — single tall box covering entire vehicle
  const body = new THREE.BoxGeometry(0.26, 0.137, 0.10);
  body.translate(0, 0.068, 0);
  setVertexColors(body, 1, 1, 1);

  // Windshield (front face)
  const windshield = new THREE.BoxGeometry(0.006, 0.055, 0.09);
  windshield.translate(0.132, 0.094, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  // Cab side windows (front portion only)
  const sideWinGeo = new THREE.BoxGeometry(0.05, 0.039, 0.005);
  const sideL = sideWinGeo.clone();
  sideL.translate(0.08, 0.099, 0.052);
  setVertexColors(sideL, 0.08, 0.1, 0.15);
  const sideR = sideWinGeo.clone();
  sideR.translate(0.08, 0.099, -0.052);
  setVertexColors(sideR, 0.08, 0.1, 0.15);

  // Rear door seam (subtle dark line)
  const rearSeam = new THREE.BoxGeometry(0.005, 0.091, 0.06);
  rearSeam.translate(-0.132, 0.065, 0);
  setVertexColors(rearSeam, 0.25, 0.25, 0.25);

  const parts: THREE.BufferGeometry[] = [body, windshield, sideL, sideR, rearSeam];

  // Wheels (4)
  const wheelGeo = new THREE.BoxGeometry(0.032, 0.026, 0.014);
  for (const [wx, wz] of [[0.080, 0.052], [0.080, -0.052], [-0.080, 0.052], [-0.080, -0.052]]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.013, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.008, 0.018, 0.016);
  for (const wz of [0.033, -0.033]) {
    const hl = hlGeo.clone();
    hl.translate(0.132, 0.039, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  // Taillights
  const tlGeo = new THREE.BoxGeometry(0.008, 0.018, 0.018);
  for (const wz of [0.035, -0.035]) {
    const tl = tlGeo.clone();
    tl.translate(-0.132, 0.039, wz);
    setVertexColors(tl, 0.8, 0.1, 0.1);
    parts.push(tl);
  }

  return mergeGeometries(parts)!;
}
