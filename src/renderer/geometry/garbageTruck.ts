import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildGarbageTruckGeometry(): THREE.BufferGeometry {
  // Cab (front) — dark green
  const cab = new THREE.BoxGeometry(0.1, 0.065, 0.1);
  cab.translate(0.11, 0.032, 0);
  setVertexColors(cab, 0.180, 0.490, 0.196); // 0x2e7d32

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

  // Cargo container (behind cab) — olive green
  const cargo = new THREE.BoxGeometry(0.22, 0.09, 0.1);
  cargo.translate(-0.05, 0.045, 0);
  setVertexColors(cargo, 0.333, 0.545, 0.184); // 0x558b2f

  // Hopper opening on top (dark gap)
  const hopper = new THREE.BoxGeometry(0.18, 0.008, 0.08);
  hopper.translate(-0.04, 0.092, 0);
  setVertexColors(hopper, 0.12, 0.12, 0.12);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, cabSideL, cabSideR, cargo, hopper];

  // Rear loader plate
  const rearPlate = new THREE.BoxGeometry(0.01, 0.06, 0.1);
  rearPlate.translate(-0.16, 0.03, 0);
  setVertexColors(rearPlate, 0.25, 0.42, 0.15);
  parts.push(rearPlate);

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
