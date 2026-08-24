import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** Rail locomotive: a single unit, the train's leading car. */
export function buildRailTrainGeometry(): THREE.BufferGeometry {
  // The body.
  const body = new THREE.BoxGeometry(0.22, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // The windscreen, at the front.
  const windshield = new THREE.BoxGeometry(0.006, 0.05, 0.11);
  windshield.translate(0.113, 0.06, 0);
  setVertexColors(windshield, 0.08, 0.1, 0.15);

  // The roof.
  const roof = new THREE.BoxGeometry(0.22, 0.01, 0.11);
  roof.translate(0, 0.1, 0);
  setVertexColors(roof, 0.6, 0.6, 0.6);

  const parts: THREE.BufferGeometry[] = [body, windshield, roof];

  // The bogies.
  const bogieGeo = new THREE.BoxGeometry(0.06, 0.015, 0.13);
  for (const bx of [0.07, -0.07]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}

/** Rail passenger carriage: a trailing car behind the locomotive. */
export function buildRailCarriageGeometry(): THREE.BufferGeometry {
  // The body.
  const body = new THREE.BoxGeometry(0.25, 0.09, 0.12);
  body.translate(0, 0.045, 0);
  setVertexColors(body, 0.85, 0.85, 0.85);

  // The window band.
  const windows = new THREE.BoxGeometry(0.2, 0.025, 0.122);
  windows.translate(0, 0.07, 0);
  setVertexColors(windows, 0.08, 0.1, 0.15);

  // The roof.
  const roof = new THREE.BoxGeometry(0.25, 0.01, 0.11);
  roof.translate(0, 0.09, 0);
  setVertexColors(roof, 0.6, 0.6, 0.6);

  const parts: THREE.BufferGeometry[] = [body, windows, roof];

  // The bogies.
  const bogieGeo = new THREE.BoxGeometry(0.06, 0.015, 0.13);
  for (const bx of [0.09, -0.09]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}
