import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** 渡輪 — 放大船型，三角船首 + 客艙 + 前後甲板 + 欄杆 */
export function buildFerryGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 船體 hull（底部主體）
  const hull = new THREE.BoxGeometry(0.65, 0.05, 0.22);
  hull.translate(0, 0.025, 0);
  setVertexColors(hull, 0.95, 0.95, 0.95);
  parts.push(hull);

  // 船首 bow（三角錐尖端，朝 +X）
  const bowGeo = new THREE.BufferGeometry();
  const bowY = 0.025;
  const bowVerts = new Float32Array([
    // 底面三角
    0.325, bowY - 0.02, -0.11,   // 左後（船體前端）
    0.325, bowY - 0.02,  0.11,   // 右後
    0.425, bowY - 0.02,  0.0,    // 尖端
    // 頂面三角
    0.325, bowY + 0.02, -0.11,
    0.325, bowY + 0.02,  0.11,
    0.425, bowY + 0.02,  0.0,
    // 左側面
    0.325, bowY - 0.02, -0.11,
    0.425, bowY - 0.02,  0.0,
    0.325, bowY + 0.02, -0.11,
    0.425, bowY - 0.02,  0.0,
    0.425, bowY + 0.02,  0.0,
    0.325, bowY + 0.02, -0.11,
    // 右側面
    0.325, bowY - 0.02,  0.11,
    0.325, bowY + 0.02,  0.11,
    0.425, bowY - 0.02,  0.0,
    0.425, bowY - 0.02,  0.0,
    0.325, bowY + 0.02,  0.11,
    0.425, bowY + 0.02,  0.0,
  ]);
  bowGeo.setAttribute('position', new THREE.BufferAttribute(bowVerts, 3));
  bowGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(18 * 2), 2)); // dummy uv
  bowGeo.setIndex([...Array(18).keys()]);
  bowGeo.computeVertexNormals();
  setVertexColors(bowGeo, 0.9, 0.9, 0.9);
  parts.push(bowGeo);

  // 前甲板 fore deck
  const foreDeck = new THREE.BoxGeometry(0.12, 0.01, 0.20);
  foreDeck.translate(0.21, 0.055, 0);
  setVertexColors(foreDeck, 0.8, 0.75, 0.65);
  parts.push(foreDeck);

  // 後甲板 aft deck
  const aftDeck = new THREE.BoxGeometry(0.12, 0.01, 0.20);
  aftDeck.translate(-0.21, 0.055, 0);
  setVertexColors(aftDeck, 0.8, 0.75, 0.65);
  parts.push(aftDeck);

  // 客艙 cabin（居中偏前）
  const cabin = new THREE.BoxGeometry(0.28, 0.07, 0.18);
  cabin.translate(0.02, 0.095, 0);
  setVertexColors(cabin, 0.95, 0.95, 0.95);
  parts.push(cabin);

  // 窗戶左側
  const winL = new THREE.BoxGeometry(0.26, 0.03, 0.005);
  winL.translate(0.02, 0.095, -0.092);
  setVertexColors(winL, 0.08, 0.15, 0.25);
  parts.push(winL);

  // 窗戶右側
  const winR = new THREE.BoxGeometry(0.26, 0.03, 0.005);
  winR.translate(0.02, 0.095, 0.092);
  setVertexColors(winR, 0.08, 0.15, 0.25);
  parts.push(winR);

  // 煙囪 funnel
  const funnel = new THREE.BoxGeometry(0.03, 0.06, 0.04);
  funnel.translate(-0.12, 0.10, 0);
  setVertexColors(funnel, 0.25, 0.25, 0.25);
  parts.push(funnel);

  // 欄杆左側
  const railL = new THREE.BoxGeometry(0.50, 0.02, 0.005);
  railL.translate(0.0, 0.065, -0.108);
  setVertexColors(railL, 0.7, 0.7, 0.7);
  parts.push(railL);

  // 欄杆右側
  const railR = new THREE.BoxGeometry(0.50, 0.02, 0.005);
  railR.translate(0.0, 0.065, 0.108);
  setVertexColors(railR, 0.7, 0.7, 0.7);
  parts.push(railR);

  return mergeGeometries(parts)!;
}
