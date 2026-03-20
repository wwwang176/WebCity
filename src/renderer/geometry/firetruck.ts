import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildFiretruckGeometry(): THREE.BufferGeometry {
  // Cab (front, red, L=0.172, H=0.132, W=0.125)
  const cab = new THREE.BoxGeometry(0.172, 0.132, 0.125);
  cab.translate(0.189, 0.066, 0);
  setVertexColors(cab, 1, 1, 1);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.008, 0.057, 0.12);
  cabWindow.translate(0.277, 0.091, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Equipment body (L=0.413, H=0.111, W=0.125)
  const body = new THREE.BoxGeometry(0.413, 0.111, 0.125);
  body.translate(-0.069, 0.056, 0);
  setVertexColors(body, 1, 1, 1);

  // Hose reel / equipment compartments (side panels)
  const panelGeo = new THREE.BoxGeometry(0.275, 0.051, 0.006);
  const panelL = panelGeo.clone();
  panelL.translate(-0.069, 0.081, 0.065);
  setVertexColors(panelL, 0.6, 0.6, 0.6);
  const panelR = panelGeo.clone();
  panelR.translate(-0.069, 0.081, -0.065);
  setVertexColors(panelR, 0.6, 0.6, 0.6);

  // Ladder rack on top
  const ladder = new THREE.BoxGeometry(0.344, 0.020, 0.038);
  ladder.translate(-0.017, 0.126, 0);
  setVertexColors(ladder, 0.5, 0.5, 0.5);

  // Light bar (flashing red/blue)
  const lightBar = new THREE.BoxGeometry(0.069, 0.028, 0.075);
  lightBar.translate(0.189, 0.146, 0);
  setVertexColors(lightBar, 1.0, 0.15, 0.15);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, body, panelL, panelR, ladder, lightBar];

  // Wheels (6)
  const wheelGeo = new THREE.BoxGeometry(0.04, 0.025, 0.018);
  for (const [wx, wz] of [
    [0.189, 0.068], [0.189, -0.068],
    [-0.103, 0.068], [-0.103, -0.068],
    [-0.172, 0.068], [-0.172, -0.068],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.012, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}
