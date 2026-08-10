import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapeOf } from '../buildings/massing/assemble';
import { partOf, type Volume } from '../buildings/massing/volume';
import { GROUND_LAYERS } from '../buildings/massing/metrics';
import {
  tagPart, setGroundShade, PART_WALL, PART_GROUND, PART_FOLIAGE,
} from '../buildings/parts';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { CIVIC_INSET, type CivicDecal, type CivicVolume, type Footprint } from './types';
import { CIVIC_DEFAULT_COLOR, type CivicColor } from './colors';

/**
 * 公共建築的量體與貼片組裝。
 *
 * 圖元（`frustum` / `cylinder` / `shapeOf`）全部沿用 `buildings/massing`，
 * 這裡只換護欄與貼片的產生方式。各寫一份圖元的下場這個專案已經示範過
 * （BUG-231 的地板顏色兩份、BUG-231 之後才收斂）。
 */

/** 空的但**有頂點色**的幾何。少了頂點色，shader 會把它當成 partType 0。 */
function emptyTagged(part: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  tagPart(geo, part);
  tagColor(geo, CIVIC_DEFAULT_COLOR);
  return geo;
}

/**
 * 把建築色攤到每個頂點上（`aBldgColor`）。
 *
 * 逐**量體**寫而不是最後整份寫：醫院的紅十字、大學的金頂是單獨一塊量體的
 * 顏色，而合併之後就分不出誰是誰了。與 `tagPart` 完全同一個道理。
 */
function tagColor(geo: THREE.BufferGeometry, c: CivicColor): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('aBldgColor', new THREE.BufferAttribute(arr, 3));
}

/** 離佔地中心的最大距離，逐軸。非置中的量體會單邊外凸，寬度看不出來。 */
function extentOf(v: Volume): { x: number; z: number } {
  return {
    x: Math.max(Math.abs(v.x - v.w / 2), Math.abs(v.x + v.w / 2)),
    z: Math.max(Math.abs(v.z - v.d / 2), Math.abs(v.z + v.d / 2)),
  };
}

/**
 * 量體越出佔地就丟例外。
 *
 * 與分區版 `assemble()` 的護欄是**不同的東西**：那邊擋的是行人包絡線
 * （格內的概念，門節點放在它外側，越過就是行人穿牆 BUG-221）。公共建築
 * 佔好幾格，包絡線不適用 —— 它要擋的是「壓到鄰格的建築或馬路」。
 *
 * 逐軸量而不是取單一半徑：2×3 的醫院在 z 方向有 3 格可用、x 方向只有 2 格。
 * 取單一半徑的話，不是浪費掉長邊就是讓短邊溢出。
 *
 * 量離中心的最大距離而不是包圍盒寬度：偏心的量體會單邊外凸，而寬度看不出來
 * —— 那是 BUG-222 的形狀。
 */
function assertInside(volumes: readonly Volume[], footprint: Footprint, inset: number): void {
  const limX = footprint.w / 2 - inset;
  const limZ = footprint.h / 2 - inset;
  let over = 0;
  for (const v of volumes) {
    const e = extentOf(v);
    over = Math.max(over, e.x - limX, e.z - limZ);
  }
  if (over > 1e-6) {
    throw new Error(
      `量體超出佔地 ${(over * METRES_PER_CELL).toFixed(3)} m —— 會壓到鄰格`,
    );
  }
}

/** 公共建築的量體轉幾何。越出佔地時丟例外。 */
export function assembleCivic(
  volumes: readonly CivicVolume[], footprint: Footprint, baseColor: CivicColor,
): THREE.BufferGeometry {
  assertInside(volumes, footprint, CIVIC_INSET);

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      tagColor(g, v.color ?? baseColor);
      parts.push(g);
    }
  }
  // 公園可能完全沒有量體（只有貼片與樹）。空陣列丟給 mergeGeometries 會回傳
  // null，而 null 一路傳到 `new THREE.Mesh` 才炸 —— 離現場很遠。
  if (parts.length === 0) return emptyTagged(PART_WALL);
  return mergeGeometries(parts)!;
}

const layerY = (d: CivicDecal) =>
  (d.layer === 'mark' ? GROUND_LAYERS.MARKING : GROUND_LAYERS.DECAL);

/** 兩塊貼片的水平交集面積。共邊（接觸）回傳 0。 */
function overlapArea(a: CivicDecal, b: CivicDecal): number {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  return ox > 1e-6 && oz > 1e-6 ? ox * oz : 0;
}

/**
 * 貼片轉幾何。
 *
 * 貼片**不吃 `CIVIC_INSET`** —— 它是平的鋪面，鋪到格子邊界是對的：人行道
 * 本來就一路鋪到路邊。但它仍然不得越出佔地。
 */
export function assembleDecals(
  decals: readonly CivicDecal[], footprint: Footprint,
): THREE.BufferGeometry {
  // 借量體的護欄：把貼片當成零高度的量體，護欄的算術完全一樣。
  assertInside(
    decals.map(d => ({ x: d.x, z: d.z, w: d.w, d: d.d, y0: 0, y1: 0 })),
    footprint,
    0,
  );

  // 底層彼此不得重疊。標線層可以疊在鋪面上，也可以彼此疊（停車格線畫在
  // 入口踏板上）—— 因為它們高度不同，或本來就是設計成疊的。
  const base = decals.filter(d => (d.layer ?? 'base') === 'base');
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const area = overlapArea(base[i]!, base[j]!);
      if (area > 0) {
        throw new Error(
          `底層貼片重疊 ${(area * METRES_PER_CELL * METRES_PER_CELL).toFixed(2)} m2`
          + ' —— 兩塊同高的四邊形會 z-fighting，靜止時看不出來、一移動鏡頭就閃',
        );
      }
    }
  }

  const parts = decals.map((d) => {
    const geo = new THREE.PlaneGeometry(d.w, d.d);
    geo.rotateX(-Math.PI / 2);   // 朝上。材質是 FrontSide，朝下就完全看不到。
    geo.translate(d.x, layerY(d), d.z);
    tagPart(geo, d.lawn ? PART_FOLIAGE : PART_GROUND);
    setGroundShade(geo, d.shade);
    // 貼片的顏色由 PART_GROUND / PART_FOLIAGE 的分支決定，不吃 aBldgColor。
    // 仍然要寫：屬性缺席時 WebGL 一律餵 0，而 `isFloor` 分支會讀到它。
    tagColor(geo, CIVIC_DEFAULT_COLOR);
    return geo;
  });

  if (parts.length === 0) return emptyTagged(PART_GROUND);
  return mergeGeometries(parts)!;
}
