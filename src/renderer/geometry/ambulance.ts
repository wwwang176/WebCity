import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

export function buildAmbulanceGeometry(): THREE.BufferGeometry {
  // Van-like body — white (L=0.30, H=0.110, W=0.10)
  const body = new THREE.BoxGeometry(0.30, 0.110, 0.1);
  body.translate(0, 0.055, 0);
  setVertexColors(body, 1, 1, 1);

  // Red stripe along sides
  const stripeL = new THREE.BoxGeometry(0.20, 0.024, 0.005);
  stripeL.translate(-0.013, 0.080, 0.052);
  setVertexColors(stripeL, 0.827, 0.184, 0.184); // 0xd32f2f

  const stripeR = new THREE.BoxGeometry(0.20, 0.024, 0.005);
  stripeR.translate(-0.013, 0.080, -0.052);
  setVertexColors(stripeR, 0.827, 0.184, 0.184);

  // Cab windshield
  const cabWindow = new THREE.BoxGeometry(0.008, 0.050, 0.09);
  cabWindow.translate(0.153, 0.096, 0);
  setVertexColors(cabWindow, 0.08, 0.1, 0.15);

  // Rear box (higher than cab, L=0.175, H=0.130, W=0.10)
  const rearBox = new THREE.BoxGeometry(0.175, 0.130, 0.1);
  rearBox.translate(-0.038, 0.065, 0);
  setVertexColors(rearBox, 0.95, 0.95, 0.95);

  const parts: THREE.BufferGeometry[] = [body, stripeL, stripeR, cabWindow, rearBox];

  // Light bar on top — red
  const lightBar = new THREE.BoxGeometry(0.05, 0.024, 0.05);
  lightBar.translate(0.075, 0.118, 0);
  setVertexColors(lightBar, 0.827, 0.184, 0.184); // 0xd32f2f
  parts.push(lightBar);

  // Red cross emblem on sides
  const crossH = new THREE.BoxGeometry(0.025, 0.012, 0.005);
  const crossV = new THREE.BoxGeometry(0.008, 0.040, 0.005);
  for (const wz of [0.053, -0.053]) {
    const ch = crossH.clone();
    ch.translate(-0.050, 0.100, wz);
    setVertexColors(ch, 0.9, 0.15, 0.15);
    parts.push(ch);

    const cv = crossV.clone();
    cv.translate(-0.050, 0.100, wz);
    setVertexColors(cv, 0.9, 0.15, 0.15);
    parts.push(cv);
  }

  // Wheels (4 corners)
  const wheelGeo = new THREE.BoxGeometry(0.035, 0.022, 0.014);
  for (const [wx, wz] of [[0.094, 0.054], [0.094, -0.054], [-0.094, 0.054], [-0.094, -0.054]]) {
    const w = wheelGeo.clone();
    w.translate(wx!, 0.011, wz!);
    setVertexColors(w, 0.05, 0.05, 0.05);
    parts.push(w);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.010, 0.020, 0.015);
  for (const wz of [0.035, -0.035]) {
    const hl = hlGeo.clone();
    hl.translate(0.153, 0.035, wz);
    setVertexColors(hl, 1.0, 0.95, 0.6);
    parts.push(hl);
  }

  return mergeGeometries(parts)!;
}
