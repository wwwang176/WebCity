import * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * 零件類型寫在頂點色的 R 通道，分區類別寫在 G 通道，B 保留。
 *
 * 門檻與標籤值放在同一個檔案，是因為 shader 的判斷式是用這些數字組出來的
 * （見 BuildingMaterial.ts）。分開放的話，改了一邊不會有任何東西報錯。
 */
export const PART_WALL = 0.0;
/** 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶。 */
export const PART_DETAIL = 0.2;
export const PART_FOLIAGE = 0.5;
export const PART_ROOF = 1.0;

/** shader 用來把 R 通道切成四段的門檻。 */
export const PART_THRESHOLDS = {
  /** 低於此值且法線朝上者視為屋頂（讓平頂不必特別標記）。 */
  ROOF_BY_NORMAL: 0.1,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.65,
  ROOF_MIN: 0.8,
} as const;

export function tagPart(geo: THREE.BufferGeometry, part: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = part;
    arr[i * 3 + 1] = 0; // 分區稍後由 stampZoneCategory 填
    arr[i * 3 + 2] = 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** 分區類別常數（寫在頂點色 G 通道）。 */
export const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
};

/**
 * 這份幾何有幾個三角形。
 *
 * `position.count / 3` 只有在非索引幾何上才對。所有建築幾何都經過
 * `mergeGeometries`，輸入是 Box / Sphere / Cylinder / Cone —— 全部索引，
 * 頂點會被多個面共用，所以那個算法少報三到五成（BUG-223）。
 */
export function triangleCount(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : geo.getAttribute('position').count / 3;
}

export function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}
