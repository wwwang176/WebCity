import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** Metro train: a rectangular car, larger and taller than a bus. */
export function buildMetroTrainGeometry(): THREE.BufferGeometry {
  // The main body.
  const body = new THREE.BoxGeometry(0.55, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // The window band.
  const windowStrip = new THREE.BoxGeometry(0.45, 0.03, 0.122);
  windowStrip.translate(0, 0.08, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // The roof.
  const roof = new THREE.BoxGeometry(0.54, 0.01, 0.11);
  roof.translate(0, 0.105, 0);
  setVertexColors(roof, 0.65, 0.65, 0.65);

  // The streamlined nose.
  const nose = new THREE.BoxGeometry(0.06, 0.08, 0.11);
  nose.translate(0.28, 0.04, 0);
  setVertexColors(nose, 0.9, 0.9, 0.9);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof, nose];

  // Wheels: a metro shows no obvious wheels, so bogies stand in for them.
  const bogieGeo = new THREE.BoxGeometry(0.08, 0.015, 0.13);
  for (const bx of [0.18, -0.18]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}

/** A single metro carriage: shorter than a full train at about 0.22, used in three-car sets. */
export function buildMetroCarriageGeometry(): THREE.BufferGeometry {
  // The body.
  const body = new THREE.BoxGeometry(0.22, 0.1, 0.12);
  body.translate(0, 0.05, 0);
  setVertexColors(body, 1, 1, 1);

  // The window band.
  const windowStrip = new THREE.BoxGeometry(0.16, 0.03, 0.122);
  windowStrip.translate(0, 0.08, 0);
  setVertexColors(windowStrip, 0.08, 0.1, 0.15);

  // The roof.
  const roof = new THREE.BoxGeometry(0.21, 0.01, 0.11);
  roof.translate(0, 0.105, 0);
  setVertexColors(roof, 0.65, 0.65, 0.65);

  const parts: THREE.BufferGeometry[] = [body, windowStrip, roof];

  // The bogies.
  const bogieGeo = new THREE.BoxGeometry(0.05, 0.015, 0.13);
  for (const bx of [0.07, -0.07]) {
    const b = bogieGeo.clone();
    b.translate(bx, 0.007, 0);
    setVertexColors(b, 0.15, 0.15, 0.15);
    parts.push(b);
  }

  return mergeGeometries(parts)!;
}
