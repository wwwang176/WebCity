import * as THREE from 'three';
import { tagPart, PART_DETAIL, PART_FOLIAGE } from './buildings/parts';
import { M } from './buildings/massing/metrics';

/**
 * 植栽圖元 —— 樹與灌木。
 *
 * 住宅的庭院與公共建築的綠地共用這裡的東西。抽出來之前，公共建築自己畫了
 * 一棵樹：同一座城市裡兩棵長得不一樣的樹，而且改了一邊不會連動另一邊。
 *
 * **這個模組不知道呼叫者是誰。** 它吃世界座標與尺寸（單位是格），不吃
 * 「格子的物件帶」—— 住宅那一側從帶算出座標再呼叫，公共建築直接給座標。
 * 把帶的概念留在這裡的話，公共建築就用不了：它佔 2×2 到 9×6 格，根本沒有
 * 「環帶」這回事。
 *
 * 幾何用 `THREE` 的圖元而不是 `massing` 的 `frustum`：樹冠是圓錐、灌木是球，
 * 兩者都不是稜台。代價是它們帶著 uv 且是索引幾何，所以**不能與量體合併**
 * —— 公共建築把植栽放在自己的一層（見 `civic/assemble.ts` 的 `assemblePlants`）。
 */

/** 一棵樹或一叢灌木的宣告。座標與尺寸都是格。 */
export type Plant =
  | { kind: 'tree'; x: number; z: number; heightM: number; crownRadius: number }
  | { kind: 'shrub'; x: number; z: number; radius: number };

/**
 * 柱狀樹（絲柏型）。
 *
 * 住宅的庭院帶最寬也只有 1.45 m，球狀樹冠塞不下；柱狀的樹冠窄、可以往上長，
 * 是那個尺寸下唯一還像樹的選擇。公共建築的空間寬得多，但共用同一棵樹是
 * 刻意的 —— 一座城市裡的樹該是同一種樹。
 */
export function columnarTree(
  x: number, z: number, heightM: number, crownRadius: number,
): THREE.BufferGeometry[] {
  const trunkH = M(heightM * 0.25);
  const crownH = M(heightM * 0.75);

  const trunk = new THREE.CylinderGeometry(M(0.09), M(0.12), trunkH, 5);
  trunk.translate(x, trunkH / 2, z);
  tagPart(trunk, PART_DETAIL); // 樹幹不是牆 —— 標 PART_WALL 會長出窗戶

  const crown = new THREE.ConeGeometry(crownRadius, crownH, 6);
  crown.translate(x, trunkH + crownH / 2, z);
  tagPart(crown, PART_FOLIAGE);
  return [trunk, crown];
}

/** 矮灌木叢。 */
export function shrubBall(x: number, z: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 5, 4);
  geo.translate(x, radius, z);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}

/** 這株植栽的水平半徑。公共建築拿它做佔地檢查。 */
export function plantRadius(p: Plant): number {
  return p.kind === 'tree' ? p.crownRadius : p.radius;
}

/** 這株植栽的幾何。 */
export function plantGeometry(p: Plant): THREE.BufferGeometry[] {
  return p.kind === 'tree'
    ? columnarTree(p.x, p.z, p.heightM, p.crownRadius)
    : [shrubBall(p.x, p.z, p.radius)];
}
