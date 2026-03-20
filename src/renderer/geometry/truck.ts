import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildTruckGeometry(): THREE.BufferGeometry {
  // Cab (front, L=0.14, H=0.145, W=0.125)
  const cab = new THREE.BoxGeometry(0.14, 0.145, 0.125);
  cab.translate(0.155, 0.072, 0);
  setVertexColors(cab, 1, 1, 1);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.008, 0.063, 0.12);
  cabWindow.translate(0.228, 0.100, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Cab side windows
  const sideWinGeo = new THREE.BoxGeometry(0.056, 0.049, 0.006);
  const cabSideL = sideWinGeo.clone();
  cabSideL.translate(0.141, 0.107, 0.065);
  setVertexColors(cabSideL, 0.08, 0.1, 0.15);
  const cabSideR = sideWinGeo.clone();
  cabSideR.translate(0.141, 0.107, -0.065);
  setVertexColors(cabSideR, 0.08, 0.1, 0.15);

  // Cargo container (behind cab, L=0.31, H=0.19, W=0.125)
  const cargo = new THREE.BoxGeometry(0.31, 0.19, 0.125);
  cargo.translate(-0.070, 0.095, 0);
  setVertexColors(cargo, 0.7, 0.72, 0.74);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, cabSideL, cabSideR, cargo];

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
    hl.translate(0.228, 0.035, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  return mergeGeometries(parts)!;
}
