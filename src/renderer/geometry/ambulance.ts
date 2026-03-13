import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildAmbulanceGeometry(): THREE.BufferGeometry {
  // Van-like body — white, slightly larger than a car
  const body = new THREE.BoxGeometry(0.24, 0.055, 0.1);
  body.translate(0, 0.027, 0);
  setVertexColors(body, 1, 1, 1);

  // Red stripe along sides
  const stripeL = new THREE.BoxGeometry(0.16, 0.012, 0.005);
  stripeL.translate(-0.01, 0.04, 0.052);
  setVertexColors(stripeL, 0.827, 0.184, 0.184); // 0xd32f2f

  const stripeR = new THREE.BoxGeometry(0.16, 0.012, 0.005);
  stripeR.translate(-0.01, 0.04, -0.052);
  setVertexColors(stripeR, 0.827, 0.184, 0.184);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.006, 0.025, 0.09);
  cabWindow.translate(0.122, 0.048, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Rear box (higher than cab)
  const rearBox = new THREE.BoxGeometry(0.14, 0.065, 0.1);
  rearBox.translate(-0.03, 0.032, 0);
  setVertexColors(rearBox, 0.95, 0.95, 0.95);

  const parts: THREE.BufferGeometry[] = [body, stripeL, stripeR, cabWindow, rearBox];

  // Light bar on top — red
  const lightBar = new THREE.BoxGeometry(0.04, 0.012, 0.05);
  lightBar.translate(0.06, 0.068, 0);
  setVertexColors(lightBar, 0.827, 0.184, 0.184); // 0xd32f2f
  parts.push(lightBar);

  // Red cross emblem on sides (small box)
  const crossH = new THREE.BoxGeometry(0.02, 0.006, 0.005);
  const crossV = new THREE.BoxGeometry(0.006, 0.02, 0.005);
  for (const wz of [0.053, -0.053]) {
    const ch = crossH.clone();
    ch.translate(-0.04, 0.05, wz);
    setVertexColors(ch, 0.9, 0.15, 0.15);
    parts.push(ch);

    const cv = crossV.clone();
    cv.translate(-0.04, 0.05, wz);
    setVertexColors(cv, 0.9, 0.15, 0.15);
    parts.push(cv);
  }

  // Wheels (4 corners)
  const wheelGeo = new THREE.BoxGeometry(0.03, 0.018, 0.014);
  for (const [wx, wz] of [[0.075, 0.054], [0.075, -0.054], [-0.075, 0.054], [-0.075, -0.054]]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.009, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.008, 0.012, 0.015);
  for (const wz of [0.035, -0.035]) {
    const hl = hlGeo.clone();
    hl.translate(0.122, 0.02, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  return mergeGeometries(parts)!;
}
