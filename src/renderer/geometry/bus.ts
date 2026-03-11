import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildBusGeometry(): THREE.BufferGeometry {
  // Long rectangular body
  const body = new THREE.BoxGeometry(0.45, 0.07, 0.1);
  body.translate(0, 0.035, 0);
  setVertexColors(body, 1, 1, 1);

  // Window strip (dark band)
  const windowStrip = new THREE.BoxGeometry(0.36, 0.025, 0.102);
  windowStrip.translate(-0.015, 0.06, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // Roof
  const roof = new THREE.BoxGeometry(0.44, 0.008, 0.094);
  roof.translate(0, 0.078, 0);
  setVertexColors(roof, 0.75, 0.75, 0.75);

  // Windshield (front)
  const windshield = new THREE.BoxGeometry(0.006, 0.04, 0.095);
  windshield.translate(0.225, 0.05, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, windshield];

  // Wheels (6 — front pair + rear double)
  const wheelGeo = new THREE.BoxGeometry(0.04, 0.022, 0.016);
  for (const [wx, wz] of [
    [0.15, 0.055], [0.15, -0.055],
    [-0.12, 0.055], [-0.12, -0.055],
    [-0.17, 0.055], [-0.17, -0.055],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.011, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}
