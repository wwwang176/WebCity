import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildFiretruckGeometry(): THREE.BufferGeometry {
  // Cab (front, red)
  const cab = new THREE.BoxGeometry(0.1, 0.065, 0.1);
  cab.translate(0.13, 0.032, 0);
  setVertexColors(cab, 1, 1, 1);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.006, 0.028, 0.096);
  cabWindow.translate(0.182, 0.045, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Equipment body
  const body = new THREE.BoxGeometry(0.24, 0.055, 0.1);
  body.translate(-0.02, 0.027, 0);
  setVertexColors(body, 1, 1, 1);

  // Hose reel / equipment compartments (side panels)
  const panelGeo = new THREE.BoxGeometry(0.16, 0.025, 0.005);
  const panelL = panelGeo.clone();
  panelL.translate(-0.02, 0.04, 0.052);
  setVertexColors(panelL, 0.6, 0.6, 0.6);
  const panelR = panelGeo.clone();
  panelR.translate(-0.02, 0.04, -0.052);
  setVertexColors(panelR, 0.6, 0.6, 0.6);

  // Ladder rack on top
  const ladder = new THREE.BoxGeometry(0.2, 0.01, 0.03);
  ladder.translate(-0.01, 0.062, 0);
  setVertexColors(ladder, 0.5, 0.5, 0.5);

  // Light bar (flashing red/blue)
  const lightBar = new THREE.BoxGeometry(0.04, 0.014, 0.06);
  lightBar.translate(0.13, 0.072, 0);
  setVertexColors(lightBar, 1.0, 0.15, 0.15);

  const parts: THREE.BufferGeometry[] = [cab, cabWindow, body, panelL, panelR, ladder, lightBar];

  // Wheels (6)
  const wheelGeo = new THREE.BoxGeometry(0.035, 0.02, 0.015);
  for (const [wx, wz] of [
    [0.13, 0.054], [0.13, -0.054],
    [-0.06, 0.054], [-0.06, -0.054],
    [-0.1, 0.054], [-0.1, -0.054],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.01, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}
