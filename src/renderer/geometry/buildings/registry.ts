import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { tagPart, PART_WALL, PART_FOLIAGE, PART_ROOF } from './parts';

// ===== Geometry Builders =====

// -- Residential Low: houses with yards/garages --

function makeResLowV1(): THREE.BufferGeometry {
  // House with pitched roof + detached garage
  const body = new THREE.BoxGeometry(0.36, 0.32, 0.34);
  body.translate(-0.08, 0.16, -0.06);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.32, 0.18, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(-0.08, 0.41, -0.06);
  tagPart(roof, PART_ROOF);
  // Garage
  const garage = new THREE.BoxGeometry(0.2, 0.18, 0.22);
  garage.translate(0.22, 0.09, 0.18);
  tagPart(garage, PART_WALL);
  const gRoof = new THREE.BoxGeometry(0.22, 0.03, 0.24);
  gRoof.translate(0.22, 0.195, 0.18);
  tagPart(gRoof, PART_ROOF);
  // Front hedge
  const hedge = new THREE.BoxGeometry(0.3, 0.08, 0.06);
  hedge.translate(-0.08, 0.04, 0.25);
  tagPart(hedge, PART_FOLIAGE);
  // Garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.15, 5);
  trunk.translate(0.28, 0.075, -0.22);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.1, 5, 4);
  canopy.translate(0.28, 0.2, -0.22);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, roof, garage, gRoof, hedge, trunk, canopy])!;
}

function makeResLowV2(): THREE.BufferGeometry {
  // Wide bungalow + garden shed
  const body = new THREE.BoxGeometry(0.5, 0.26, 0.36);
  body.translate(0, 0.13, -0.06);
  tagPart(body, PART_WALL);
  const porch = new THREE.BoxGeometry(0.18, 0.14, 0.1);
  porch.translate(0.18, 0.07, 0.15);
  tagPart(porch, PART_WALL);
  const shed = new THREE.BoxGeometry(0.14, 0.16, 0.14);
  shed.translate(-0.22, 0.08, 0.22);
  tagPart(shed, PART_WALL);
  const shedRoof = new THREE.BoxGeometry(0.16, 0.02, 0.16);
  shedRoof.translate(-0.22, 0.17, 0.22);
  tagPart(shedRoof, PART_ROOF);
  // Side bushes
  const bush1 = new THREE.SphereGeometry(0.06, 5, 4);
  bush1.translate(0.32, 0.06, -0.28);
  tagPart(bush1, PART_FOLIAGE);
  const bush2 = new THREE.SphereGeometry(0.05, 5, 4);
  bush2.translate(0.32, 0.05, -0.16);
  tagPart(bush2, PART_FOLIAGE);
  // Back garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5);
  trunk.translate(-0.08, 0.09, -0.32);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.12, 5, 4);
  canopy.translate(-0.08, 0.24, -0.32);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, porch, shed, shedRoof, bush1, bush2, trunk, canopy])!;
}

function makeResLowV3(): THREE.BufferGeometry {
  // Narrow townhouse with steep roof + small yard wall
  const body = new THREE.BoxGeometry(0.32, 0.4, 0.4);
  body.translate(0, 0.2, -0.04);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.3, 0.22, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.51, -0.04);
  tagPart(roof, PART_ROOF);
  // Low yard wall / fence
  const fence = new THREE.BoxGeometry(0.4, 0.06, 0.03);
  fence.translate(0.05, 0.03, 0.22);
  tagPart(fence, PART_WALL);
  // Front hedge row
  const hedge1 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge1.translate(-0.12, 0.035, 0.22);
  tagPart(hedge1, PART_FOLIAGE);
  const hedge2 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge2.translate(0.22, 0.035, 0.22);
  tagPart(hedge2, PART_FOLIAGE);
  // Corner bush
  const bush = new THREE.SphereGeometry(0.07, 5, 4);
  bush.translate(-0.25, 0.07, 0.28);
  tagPart(bush, PART_FOLIAGE);
  return mergeGeometries([body, roof, fence, hedge1, hedge2, bush])!;
}

// -- Residential High --

function makeResHighV1(): THREE.BufferGeometry {
  const main = new THREE.BoxGeometry(0.6, 0.8, 0.55);
  main.translate(0, 0.4, 0);
  tagPart(main, PART_WALL);
  const top = new THREE.BoxGeometry(0.4, 0.25, 0.35);
  top.translate(0, 0.925, 0);
  tagPart(top, PART_ROOF);
  return mergeGeometries([main, top])!;
}

function makeResHighV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.45, 1.0, 0.45);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  cap.translate(0, 1.03, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

function makeResHighV3(): THREE.BufferGeometry {
  const wing1 = new THREE.BoxGeometry(0.6, 0.7, 0.3);
  wing1.translate(0, 0.35, -0.1);
  tagPart(wing1, PART_WALL);
  const wing2 = new THREE.BoxGeometry(0.3, 0.7, 0.6);
  // z 收到 0.13：原本的 0.15 讓這一翼伸到 z = 0.45，乘上最大深度縮放 1.15
  // 之後是 0.5175，會越過格子邊界吃進鄰居（BUG-218）。
  wing2.translate(-0.15, 0.35, 0.13);
  tagPart(wing2, PART_WALL);
  return mergeGeometries([wing1, wing2])!;
}

// -- Commercial Low --

function makeComLowV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.6, 0.4, 0.55);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const awning = new THREE.BoxGeometry(0.65, 0.03, 0.15);
  awning.translate(0, 0.35, 0.32);
  tagPart(awning, PART_ROOF);
  return mergeGeometries([body, awning])!;
}

function makeComLowV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.7, 0.35, 0.5);
  body.translate(0, 0.175, 0);
  tagPart(body, PART_WALL);
  const sign = new THREE.BoxGeometry(0.55, 0.06, 0.02);
  sign.translate(0, 0.38, 0.26);
  tagPart(sign, PART_ROOF);
  return mergeGeometries([body, sign])!;
}

function makeComLowV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const entry = new THREE.BoxGeometry(0.15, 0.3, 0.08);
  entry.translate(0, 0.15, 0.29);
  tagPart(entry, PART_WALL);
  return mergeGeometries([body, entry])!;
}

// -- Commercial High --

function makeComHighV1(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.6, 0.4, 0.6);
  base.translate(0, 0.2, 0);
  tagPart(base, PART_WALL);
  const tower = new THREE.BoxGeometry(0.45, 0.8, 0.45);
  tower.translate(0, 0.8, 0);
  tagPart(tower, PART_WALL);
  return mergeGeometries([base, tower])!;
}

function makeComHighV2(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.28, 0.3, 1.0, 8);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 8);
  cap.translate(0, 1.025, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

// -- Industrial: factories with yards --

function makeIndV1(): THREE.BufferGeometry {
  // Factory + small utility shed
  const body = new THREE.BoxGeometry(0.5, 0.38, 0.45);
  body.translate(-0.04, 0.19, -0.04);
  tagPart(body, PART_WALL);
  const chimney = new THREE.CylinderGeometry(0.06, 0.08, 0.4, 6);
  chimney.translate(0.15, 0.58, -0.15);
  tagPart(chimney, PART_WALL);
  // Utility shed
  const shed = new THREE.BoxGeometry(0.18, 0.16, 0.2);
  shed.translate(0.26, 0.08, 0.2);
  tagPart(shed, PART_WALL);
  return mergeGeometries([body, chimney, shed])!;
}

function makeIndV2(): THREE.BufferGeometry {
  // Warehouse + loading dock area
  const body = new THREE.BoxGeometry(0.55, 0.28, 0.5);
  body.translate(0, 0.14, -0.05);
  tagPart(body, PART_WALL);
  const dock = new THREE.BoxGeometry(0.3, 0.06, 0.15);
  dock.translate(0, 0.03, 0.28);
  tagPart(dock, PART_WALL);
  return mergeGeometries([body, dock])!;
}

function makeIndV3(): THREE.BufferGeometry {
  // Double chimney factory + yard wall
  const body = new THREE.BoxGeometry(0.48, 0.32, 0.42);
  body.translate(0, 0.16, 0);
  tagPart(body, PART_WALL);
  const ch1 = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6);
  ch1.translate(-0.12, 0.495, -0.12);
  tagPart(ch1, PART_WALL);
  const ch2 = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
  ch2.translate(0.12, 0.47, -0.12);
  tagPart(ch2, PART_WALL);
  // Compound wall
  const wall = new THREE.BoxGeometry(0.5, 0.1, 0.03);
  wall.translate(0, 0.05, 0.26);
  tagPart(wall, PART_WALL);
  return mergeGeometries([body, ch1, ch2, wall])!;
}

// -- Office --

function makeOfficeV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 1.0, 0.5);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const antenna = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4);
  antenna.translate(0, 1.1, 0);
  tagPart(antenna, PART_ROOF);
  return mergeGeometries([body, antenna])!;
}

function makeOfficeV2(): THREE.BufferGeometry {
  const b1 = new THREE.BoxGeometry(0.6, 0.5, 0.6);
  b1.translate(0, 0.25, 0);
  tagPart(b1, PART_WALL);
  const b2 = new THREE.BoxGeometry(0.45, 0.4, 0.45);
  b2.translate(0, 0.7, 0);
  tagPart(b2, PART_WALL);
  const b3 = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  b3.translate(0, 1.05, 0);
  tagPart(b3, PART_ROOF);
  return mergeGeometries([b1, b2, b3])!;
}

function makeOfficeV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.65, 0.8, 0.5);
  body.translate(0, 0.4, 0);
  tagPart(body, PART_WALL);
  const equip = new THREE.BoxGeometry(0.2, 0.1, 0.15);
  equip.translate(0.15, 0.85, 0.1);
  tagPart(equip, PART_ROOF);
  return mergeGeometries([body, equip])!;
}

// ===== Variant Registry =====
type GeoBuilder = () => THREE.BufferGeometry;

const VARIANTS: Record<number, GeoBuilder[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [makeResLowV1, makeResLowV2, makeResLowV3],
  [ZoneType.RESIDENTIAL_HIGH]: [makeResHighV1, makeResHighV2, makeResHighV3],
  [ZoneType.COMMERCIAL_LOW]:   [makeComLowV1, makeComLowV2, makeComLowV3],
  [ZoneType.COMMERCIAL_HIGH]:  [makeComHighV1, makeComHighV2],
  [ZoneType.INDUSTRIAL]:       [makeIndV1, makeIndV2, makeIndV3],
  [ZoneType.OFFICE]:           [makeOfficeV1, makeOfficeV2, makeOfficeV3],
};

export type { GeoBuilder };

/** 有建築的分區。ZoneType.NONE 不在內。 */
export const ZONE_TYPES: number[] = Object.keys(VARIANTS).map(Number);

export const LEVELS = [1, 2, 3] as const;

/** 三角形上限。展示區的計數器照這兩條線標示。 */
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
} as const;

/**
 * 這個 (分區, 等級) 桶的變體清單。
 *
 * `level` 目前收下但不使用 —— 每個等級回傳同一份清單。第二階段會讓
 * (分區, 等級) 各有自己的一組變體；先把參數開出來，呼叫端就不必再改一次。
 */
export function getVariants(zoneType: number, level: number): GeoBuilder[] {
  void level;
  return VARIANTS[zoneType] ?? [];
}
