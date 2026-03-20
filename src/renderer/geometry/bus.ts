import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildBusGeometry(): THREE.BufferGeometry {
  // Long rectangular body (L=0.60, H=0.132, W=0.125)
  const body = new THREE.BoxGeometry(0.60, 0.132, 0.125);
  body.translate(0, 0.066, 0);
  setVertexColors(body, 1, 1, 1);

  // Window strip (dark band)
  const windowStrip = new THREE.BoxGeometry(0.48, 0.047, 0.127);
  windowStrip.translate(-0.020, 0.113, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // Roof
  const roof = new THREE.BoxGeometry(0.587, 0.015, 0.118);
  roof.translate(0, 0.147, 0);
  setVertexColors(roof, 0.75, 0.75, 0.75);

  // Windshield (front)
  const windshield = new THREE.BoxGeometry(0.008, 0.076, 0.119);
  windshield.translate(0.300, 0.095, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, windshield];

  // Wheels (6 — front pair + rear double)
  const wheelGeo = new THREE.BoxGeometry(0.045, 0.025, 0.019);
  for (const [wx, wz] of [
    [0.200, 0.069], [0.200, -0.069],
    [-0.160, 0.069], [-0.160, -0.069],
    [-0.227, 0.069], [-0.227, -0.069],
  ]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.012, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  return mergeGeometries(parts)!;
}
