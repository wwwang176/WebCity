import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildGarbageTruckGeometry(): THREE.BufferGeometry {
  // Cab (front) — dark green (L=0.14, H=0.108, W=0.125)
  const cab = new THREE.BoxGeometry(0.14, 0.108, 0.125);
  cab.translate(0.155, 0.054, 0);
  setVertexColors(cab, 0.180, 0.490, 0.196); // 0x2e7d32

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.008, 0.047, 0.12);
  cabWindow.translate(0.228, 0.075, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Cab side windows
  const sideWinGeo = new THREE.BoxGeometry(0.056, 0.037, 0.006);
  const cabSideL = sideWinGeo.clone();
  cabSideL.translate(0.141, 0.080, 0.065);
  setVertexColors(cabSideL, 0.08, 0.1, 0.15);
  const cabSideR = sideWinGeo.clone();
  cabSideR.translate(0.141, 0.080, -0.065);
  setVertexColors(cabSideR, 0.08, 0.1, 0.15);

  // Cargo container (behind cab) — olive green (L=0.31, H=0.15, W=0.125)
  const cargo = new THREE.BoxGeometry(0.31, 0.15, 0.125);
  cargo.translate(-0.070, 0.075, 0);
  setVertexColors(cargo, 0.333, 0.545, 0.184); // 0x558b2f

  // Hopper opening on top (dark gap)
  const hopper = new THREE.BoxGeometry(0.253, 0.013, 0.10);
  hopper.translate(-0.056, 0.153, 0);
  setVertexColors(hopper, 0.12, 0.12, 0.12);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, cabSideL, cabSideR, cargo, hopper];

  // Rear loader plate
  const rearPlate = new THREE.BoxGeometry(0.014, 0.10, 0.125);
  rearPlate.translate(-0.225, 0.050, 0);
  setVertexColors(rearPlate, 0.25, 0.42, 0.15);
  parts.push(rearPlate);

  // Wheels (6)
  const wheelGeo = new THREE.BoxGeometry(0.04, 0.025, 0.018);
  for (const [wx, wz] of [
    [0.155, 0.068], [0.155, -0.068],
    [-0.112, 0.068], [-0.112, -0.068],
    [-0.169, 0.068], [-0.169, -0.068],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.012, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.008, 0.020, 0.020);
  for (const wz of [0.044, -0.044]) {
    const hl = hlGeo.clone();
    hl.translate(0.228, 0.033, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  return mergeGeometries(parts)!;
}
