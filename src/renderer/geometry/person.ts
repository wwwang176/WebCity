import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/**
 * Build a low-poly person geometry.
 * Total height ~0.10 units (≈1.7m at 1 cell = 12m scale).
 * Body/arm colors are white (1,1,1) so InstancedMesh per-instance color can override.
 */
export function buildPersonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Head
  const head = new THREE.BoxGeometry(0.025, 0.025, 0.025);
  head.translate(0, 0.09, 0);
  setVertexColors(head, 0.87, 0.75, 0.65); // skin tone

  // Body (torso)
  const body = new THREE.BoxGeometry(0.03, 0.04, 0.02);
  body.translate(0, 0.06, 0);
  setVertexColors(body, 1, 1, 1); // white — overridden by per-instance color

  // Left leg
  const leftLeg = new THREE.BoxGeometry(0.012, 0.035, 0.014);
  leftLeg.translate(-0.007, 0.0175, 0);
  setVertexColors(leftLeg, 0.15, 0.15, 0.2); // dark pants

  // Right leg
  const rightLeg = new THREE.BoxGeometry(0.012, 0.035, 0.014);
  rightLeg.translate(0.007, 0.0175, 0);
  setVertexColors(rightLeg, 0.15, 0.15, 0.2);

  // Left arm
  const leftArm = new THREE.BoxGeometry(0.01, 0.03, 0.012);
  leftArm.translate(-0.023, 0.055, 0);
  setVertexColors(leftArm, 1, 1, 1); // same as body

  // Right arm
  const rightArm = new THREE.BoxGeometry(0.01, 0.03, 0.012);
  rightArm.translate(0.023, 0.055, 0);
  setVertexColors(rightArm, 1, 1, 1);

  parts.push(head, body, leftLeg, rightLeg, leftArm, rightArm);

  return mergeGeometries(parts)!;
}
