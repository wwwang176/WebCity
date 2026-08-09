import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { TRIANGLE_BUDGET, heightKey, type Density, type GeoBuilder } from './registry';
import { lowPropBand, type Band } from './propBands';
import { tagPart, PART_FOLIAGE, PART_DETAIL } from './parts';

/**
 * 矮物件層 —— 站在地上、行人會撞到的東西。
 *
 * 它存在的理由是 BUG-219：等級以 `makeScale(w, h, d)` 乘在整份合併幾何上，
 * 所以住宅低密度 L1 升到 L3 時，庭院的樹跟著被拉高 1.75 倍（1.44 -> 2.52 m）。
 * 樹不會因為房子加蓋而長高。搬出來之後這一層只吃旋轉與位置，高度與基地
 * 縮放都不套用 —— 樹在每個等級都是同一個真實尺寸。
 *
 * 幾何一律以**真實尺寸**撰寫（1 格 = 12 m），不再是「會被縮放的相對比例」。
 *
 * 帶寬差很多：住宅低有 1.45 m（放得下樹），其他分區只有 0.4 m（只放得下
 * 矮柱、垃圾桶、單車架）。所以每個零件都吃 `Band`，自己決定塞不塞得下。
 */

export const PROP_TRIANGLE_BUDGET = TRIANGLE_BUDGET.PROP;

/** 公尺換算成格。 */
const M = (metres: number) => metres / METRES_PER_CELL;

export type YardRing = Band;

/**
 * 建築讓出來的環帶 —— 矮物件帶的別名。
 *
 * 推導本身住在 `propBands`：貼片、矮物件、懸挑三類共用同一個內緣（建築抖到
 * 最寬時的外緣），只有外緣不同。把它留在這裡會變成第二份會漂移的推導。
 */
export function yardRing(zoneType: number, density: Density): YardRing | null {
  return lowPropBand(zoneType, density);
}

export function hasGroundProps(zoneType: number, density: Density, level: number): boolean {
  return getGroundPropVariants(zoneType, density, level).length > 0;
}

// ===== 放置輔助 =====

/** 環帶的中線。單點物件放這裡，內外都留一半的餘裕。 */
const mid = (b: Band) => (b.inner + b.outer) / 2;

/** 環帶的半寬。任何單點物件的半徑上限。 */
const halfBand = (b: Band) => (b.outer - b.inner) / 2;

/** 半徑取 `wanted` 與環帶容得下的較小者，讓同一個零件在寬窄帶都能用。 */
function fit(b: Band, wantedM: number, ratio = 0.9): number {
  return Math.min(M(wantedM), halfBand(b) * ratio);
}

type Axis = 'x' | 'z';
type Sign = 1 | -1;

/** 把 (沿邊位置 t, 離心距離 d) 換成 x/z。 */
function place(axis: Axis, sign: Sign, t: number, d: number): [number, number] {
  return axis === 'z' ? [t, sign * d] : [sign * d, t];
}

// ===== 零件 =====

/** 沿著某一邊的連續帶狀物（樹籬、花台、矮牆）。 */
function strip(
  b: Band, axis: Axis, sign: Sign, lengthFrac: number, heightM: number, part: number,
): THREE.BufferGeometry {
  const depth = (b.outer - b.inner) * 0.8;
  const len = b.outer * 2 * lengthFrac;
  const h = M(heightM);
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(len, h, depth)
    : new THREE.BoxGeometry(depth, h, len);
  const [x, z] = place(axis, sign, 0, mid(b));
  geo.translate(x, h / 2, z);
  tagPart(geo, part);
  return geo;
}

/** 樹籬。 */
const hedge = (b: Band, axis: Axis, sign: Sign, lengthFrac: number, heightM: number) =>
  strip(b, axis, sign, lengthFrac, heightM, PART_FOLIAGE);

/** 石砌花台／矮牆。標 PART_DETAIL 走金屬灰分支，不長窗戶也不變綠。 */
const planter = (b: Band, axis: Axis, sign: Sign, lengthFrac: number) =>
  strip(b, axis, sign, lengthFrac, 0.4, PART_DETAIL);

/**
 * 柱狀樹（絲柏型）。
 *
 * 庭院帶最寬也只有 1.45 m，球狀樹冠塞不下；柱狀的樹冠窄、可以往上長，
 * 是這個尺寸下唯一還像樹的選擇。
 */
function columnarTree(
  b: Band, axis: Axis, sign: Sign, t: number, heightM: number,
): THREE.BufferGeometry[] {
  const r = fit(b, 0.7);
  const trunkH = M(heightM * 0.25);
  const crownH = M(heightM * 0.75);
  const [x, z] = place(axis, sign, t, mid(b));

  const trunk = new THREE.CylinderGeometry(M(0.09), M(0.12), trunkH, 5);
  trunk.translate(x, trunkH / 2, z);
  tagPart(trunk, PART_DETAIL); // 樹幹不是牆 —— 標 PART_WALL 會長出窗戶

  const crown = new THREE.ConeGeometry(r, crownH, 6);
  crown.translate(x, trunkH + crownH / 2, z);
  tagPart(crown, PART_FOLIAGE);
  return [trunk, crown];
}

/** 矮灌木叢。 */
function shrub(b: Band, axis: Axis, sign: Sign, t: number, radiusM: number) {
  const r = fit(b, radiusM, 0.95);
  const geo = new THREE.SphereGeometry(r, 5, 4);
  const [x, z] = place(axis, sign, t, mid(b));
  geo.translate(x, r, z);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}

/** 修剪灌木球：兩顆球疊在一根短柱上。 */
function topiary(b: Band, axis: Axis, sign: Sign, t: number) {
  const r = fit(b, 0.35, 0.85);
  const [x, z] = place(axis, sign, t, mid(b));
  const stem = new THREE.CylinderGeometry(M(0.06), M(0.08), M(0.5), 5);
  stem.translate(x, M(0.25), z);
  tagPart(stem, PART_DETAIL);
  const lower = new THREE.SphereGeometry(r, 5, 3);
  lower.translate(x, M(0.5) + r, z);
  tagPart(lower, PART_FOLIAGE);
  const upper = new THREE.SphereGeometry(r * 0.7, 5, 3);
  upper.translate(x, M(0.5) + r * 2.4, z);
  tagPart(upper, PART_FOLIAGE);
  return [stem, lower, upper];
}

/** 圓花圃：一圈矮牆加中間的花。 */
function flowerBed(b: Band, axis: Axis, sign: Sign, t: number) {
  const r = fit(b, 0.45, 0.9);
  const [x, z] = place(axis, sign, t, mid(b));
  const rim = new THREE.CylinderGeometry(r, r, M(0.28), 6);
  rim.translate(x, M(0.14), z);
  tagPart(rim, PART_DETAIL);
  const bloom = new THREE.SphereGeometry(r * 0.85, 6, 2);
  bloom.scale(1, 0.5, 1);
  bloom.translate(x, M(0.28) + r * 0.2, z);
  tagPart(bloom, PART_FOLIAGE);
  return [rim, bloom];
}

/** 信箱：一根柱加一個箱。 */
function mailbox(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  const post = new THREE.BoxGeometry(M(0.12), M(1.0), M(0.12));
  post.translate(x, M(0.5), z);
  tagPart(post, PART_DETAIL);
  const box = new THREE.BoxGeometry(M(0.34), M(0.24), M(0.22));
  box.translate(x, M(1.12), z);
  tagPart(box, PART_DETAIL);
  return [post, box];
}

/** 垃圾桶。 */
function bin(b: Band, axis: Axis, sign: Sign, t: number) {
  const r = fit(b, 0.28, 0.9);
  const [x, z] = place(axis, sign, t, mid(b));
  const body = new THREE.CylinderGeometry(r, r * 0.85, M(0.9), 5);
  body.translate(x, M(0.45), z);
  tagPart(body, PART_DETAIL);
  const lid = new THREE.CylinderGeometry(r * 1.1, r * 1.1, M(0.08), 5);
  lid.translate(x, M(0.94), z);
  tagPart(lid, PART_DETAIL);
  return [body, lid];
}

/** 矮柱列：沿著一條邊等距的短柱，擋車用。 */
function bollards(b: Band, axis: Axis, sign: Sign, count: number) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 1.5;
  const r = fit(b, 0.11, 0.5);
  for (let i = 0; i <= count; i++) {
    const t = -span / 2 + (span / count) * i;
    const [x, z] = place(axis, sign, t, mid(b));
    // 方柱而不是圓柱：0.11 m 的柱子在等角視角下看不出圓方，圓柱貴八成。
    const post = new THREE.BoxGeometry(r * 1.7, M(0.85), r * 1.7);
    post.translate(x, M(0.425), z);
    tagPart(post, PART_DETAIL);
    out.push(post);
  }
  return out;
}

/** 圍籬柱列：比矮柱細，配上一道橫桿。 */
function picketFence(b: Band, axis: Axis, sign: Sign, count: number) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 1.7;
  for (let i = 0; i <= count; i++) {
    const t = -span / 2 + (span / count) * i;
    const [x, z] = place(axis, sign, t, mid(b));
    const post = new THREE.BoxGeometry(M(0.1), M(1.0), M(0.1));
    post.translate(x, M(0.5), z);
    tagPart(post, PART_DETAIL);
    out.push(post);
  }
  const rail = axis === 'z'
    ? new THREE.BoxGeometry(span, M(0.1), M(0.06))
    : new THREE.BoxGeometry(M(0.06), M(0.1), span);
  const [rx, rz] = place(axis, sign, 0, mid(b));
  rail.translate(rx, M(0.72), rz);
  tagPart(rail, PART_DETAIL);
  out.push(rail);
  return out;
}

/** 單車架：兩個環。 */
function bikeRack(b: Band, axis: Axis, sign: Sign, t: number) {
  const out: THREE.BufferGeometry[] = [];
  for (const off of [-M(0.35), M(0.35)]) {
    const [x, z] = place(axis, sign, t + off, mid(b));
    const hoop = new THREE.TorusGeometry(M(0.32), M(0.045), 3, 5, Math.PI);
    hoop.rotateY(axis === 'z' ? 0 : Math.PI / 2);
    hoop.translate(x, 0, z);
    tagPart(hoop, PART_DETAIL);
    out.push(hoop);
  }
  return out;
}

/** 庭園燈／路燈。 */
function lamp(b: Band, axis: Axis, sign: Sign, t: number, heightM: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  const pole = new THREE.CylinderGeometry(M(0.07), M(0.09), M(heightM), 4);
  pole.translate(x, M(heightM) / 2, z);
  tagPart(pole, PART_DETAIL);
  const head = new THREE.SphereGeometry(M(0.18), 4, 3);
  head.translate(x, M(heightM) + M(0.14), z);
  tagPart(head, PART_DETAIL);
  return [pole, head];
}

/** 曬衣桿：兩根柱加兩條橫線。 */
function dryingRack(b: Band, axis: Axis, sign: Sign) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 0.9;
  for (const t of [-span / 2, span / 2]) {
    const [x, z] = place(axis, sign, t, mid(b));
    const post = new THREE.BoxGeometry(M(0.09), M(1.7), M(0.09));
    post.translate(x, M(0.85), z);
    tagPart(post, PART_DETAIL);
    out.push(post);
  }
  for (const h of [1.4, 1.6]) {
    const line = axis === 'z'
      ? new THREE.BoxGeometry(span, M(0.04), M(0.04))
      : new THREE.BoxGeometry(M(0.04), M(0.04), span);
    const [x, z] = place(axis, sign, 0, mid(b));
    line.translate(x, M(h), z);
    tagPart(line, PART_DETAIL);
    out.push(line);
  }
  return out;
}

/** 告示牌／招牌立柱。 */
function signPost(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  const post = new THREE.CylinderGeometry(M(0.06), M(0.06), M(1.6), 5);
  post.translate(x, M(0.8), z);
  tagPart(post, PART_DETAIL);
  const board = axis === 'z'
    ? new THREE.BoxGeometry(M(0.7), M(0.5), M(0.05))
    : new THREE.BoxGeometry(M(0.05), M(0.5), M(0.7));
  board.translate(x, M(1.5), z);
  tagPart(board, PART_DETAIL);
  return [post, board];
}

/** 油桶（工業）。 */
function drum(b: Band, axis: Axis, sign: Sign, t: number) {
  const r = fit(b, 0.29, 0.9);
  const [x, z] = place(axis, sign, t, mid(b));
  const body = new THREE.CylinderGeometry(r, r, M(0.88), 6);
  body.translate(x, M(0.44), z);
  tagPart(body, PART_DETAIL);
  return body;
}

/** 消防栓（工業／商業）。 */
function hydrant(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  const body = new THREE.CylinderGeometry(M(0.11), M(0.14), M(0.7), 5);
  body.translate(x, M(0.35), z);
  tagPart(body, PART_DETAIL);
  const cap = new THREE.SphereGeometry(M(0.12), 4, 2);
  cap.translate(x, M(0.72), z);
  tagPart(cap, PART_DETAIL);
  return [body, cap];
}

/** 旗桿（辦公）。 */
function flagpole(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  const pole = new THREE.CylinderGeometry(M(0.06), M(0.08), M(1.9), 5);
  pole.translate(x, M(0.95), z);
  tagPart(pole, PART_DETAIL);
  const flag = axis === 'z'
    ? new THREE.BoxGeometry(M(0.6), M(0.36), M(0.03))
    : new THREE.BoxGeometry(M(0.03), M(0.36), M(0.6));
  flag.translate(
    axis === 'z' ? x + M(0.32) : x,
    M(1.62),
    axis === 'z' ? z : z + M(0.32),
  );
  tagPart(flag, PART_DETAIL);
  return [flag, pole];
}

// ===== 各分區的組合 =====

type Recipe = (b: Band) => THREE.BufferGeometry[];

/**
 * 住宅低密度的庭院階梯（規格修訂 4 的「周邊」欄）。
 *
 *   L1 素土院子：木柵、灌木、信箱、垃圾桶
 *   L2 樹籬與一棵樹：樹籬、柱狀樹、花圃、單車架、曬衣桿
 *   L3 修剪庭園：三面樹籬、兩棵樹、修剪灌木球、花台、庭園燈
 *
 * 每個等級四個組合 —— 兩個配四向旋轉只有 8 種面貌，一個 8x8 街廓看得出
 * 重複。四個就是 16 種。
 */
const RES_LOW: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...picketFence(b, 'z', 1, 5), shrub(b, 'x', 1, -0.1, 0.55), ...mailbox(b, 'z', 1, -0.28)],
    b => [...picketFence(b, 'x', -1, 4), shrub(b, 'z', 1, 0.15, 0.6), ...bin(b, 'z', 1, -0.3)],
    b => [shrub(b, 'x', 1, 0.1, 0.6), shrub(b, 'x', -1, -0.15, 0.45), ...mailbox(b, 'z', 1, 0.3)],
    b => [...picketFence(b, 'z', -1, 5), ...bin(b, 'x', -1, 0.2), shrub(b, 'z', -1, -0.2, 0.5)],
  ],
  // L2 保留 L1 的信箱與垃圾桶：房子升級不會把信箱弄丟。少了這一條，
  // 「L2 比 L1 豐富」在幾何上不成立 —— L1 的四道木柵反而零件更多。
  [
    b => [hedge(b, 'z', 1, 0.9, 0.9), ...columnarTree(b, 'x', -1, -0.2, 4.0),
          ...flowerBed(b, 'z', 1, 0.28), ...bikeRack(b, 'z', 1, -0.25),
          ...mailbox(b, 'x', 1, 0.3)],
    b => [hedge(b, 'z', -1, 0.9, 0.8), hedge(b, 'x', -1, 0.6, 0.9),
          ...columnarTree(b, 'x', 1, 0.2, 3.6), ...dryingRack(b, 'z', -1),
          ...bin(b, 'z', 1, 0.3)],
    b => [hedge(b, 'x', 1, 0.8, 0.85), ...columnarTree(b, 'z', -1, -0.25, 4.2),
          ...flowerBed(b, 'x', -1, 0.1), ...mailbox(b, 'z', 1, 0.3),
          ...bin(b, 'z', 1, -0.3)],
    b => [hedge(b, 'z', 1, 0.85, 0.9), ...columnarTree(b, 'z', -1, 0.25, 3.8),
          ...bin(b, 'x', 1, -0.2), shrub(b, 'x', -1, 0.2, 0.5),
          ...mailbox(b, 'z', 1, 0.3)],
  ],
  [
    b => [hedge(b, 'z', 1, 0.95, 1.0), hedge(b, 'x', 1, 0.9, 1.0), hedge(b, 'x', -1, 0.9, 1.0),
          ...columnarTree(b, 'z', -1, -0.24, 4.8), ...columnarTree(b, 'z', -1, 0.24, 4.2),
          ...topiary(b, 'z', 1, 0.28)],
    b => [hedge(b, 'z', -1, 0.95, 1.0), hedge(b, 'z', 1, 0.95, 0.9), hedge(b, 'x', 1, 0.85, 1.0),
          ...columnarTree(b, 'x', -1, 0.22, 5.0), ...columnarTree(b, 'x', -1, -0.22, 4.4),
          ...lamp(b, 'z', 1, 0.3, 2.4)],
    b => [hedge(b, 'x', 1, 0.95, 1.0), hedge(b, 'x', -1, 0.95, 1.0), planter(b, 'z', 1, 0.8),
          ...columnarTree(b, 'z', -1, -0.2, 4.6), ...topiary(b, 'z', 1, -0.3),
          ...topiary(b, 'z', 1, 0.3)],
    b => [hedge(b, 'z', 1, 0.95, 1.0), hedge(b, 'x', -1, 0.9, 1.0), planter(b, 'z', -1, 0.7),
          ...columnarTree(b, 'x', 1, 0.2, 4.8), ...flowerBed(b, 'x', 1, -0.22),
          ...lamp(b, 'z', 1, -0.3, 2.2)],
  ],
];

/** 商業：人行道家具。窄帶（0.4 m）只放得下柱狀物。 */
const COMMERCIAL: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bin(b, 'z', 1, 0.28), ...hydrant(b, 'x', 1, -0.2)],
    b => [...bin(b, 'z', 1, -0.28), ...bollards(b, 'z', 1, 4)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...signPost(b, 'z', 1, -0.3), ...bin(b, 'x', 1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.1), ...signPost(b, 'x', 1, -0.2), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...signPost(b, 'z', 1, 0.3), ...lamp(b, 'x', 1, 0.1, 3.2),
          ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 6), ...lamp(b, 'z', 1, -0.3, 3.4), ...bin(b, 'x', 1, -0.15),
          ...signPost(b, 'x', -1, 0.15)],
  ],
];

/** 工業：油桶、矮柱、消防栓。廠區沒有綠化。 */
const INDUSTRIAL: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [drum(b, 'x', 1, 0.1), drum(b, 'x', 1, -0.15), ...hydrant(b, 'z', 1, 0.3)],
    b => [drum(b, 'z', -1, 0.2), ...hydrant(b, 'x', -1, -0.1)],
  ],
  [
    b => [drum(b, 'x', 1, 0.12), drum(b, 'x', 1, -0.12), drum(b, 'x', 1, 0.36),
          ...bollards(b, 'z', 1, 4), ...hydrant(b, 'z', 1, -0.32)],
    b => [drum(b, 'z', -1, 0.18), drum(b, 'z', -1, -0.18), ...bollards(b, 'x', -1, 4),
          ...hydrant(b, 'z', 1, 0.3)],
  ],
  [
    b => [drum(b, 'x', 1, 0.12), drum(b, 'x', 1, -0.12), drum(b, 'x', 1, 0.36),
          ...bollards(b, 'z', 1, 6), ...lamp(b, 'x', -1, 0.2, 4.0),
          ...hydrant(b, 'z', 1, -0.32), ...signPost(b, 'z', 1, 0.3)],
    b => [drum(b, 'z', -1, 0.2), drum(b, 'z', -1, -0.2), ...bollards(b, 'x', -1, 5),
          ...lamp(b, 'z', 1, 0.3, 4.2), ...signPost(b, 'x', 1, -0.15),
          ...hydrant(b, 'x', 1, 0.25)],
  ],
];

/** 辦公：旗桿、花圃、單車架。 */
const OFFICE: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bollards(b, 'z', 1, 4), ...bin(b, 'x', 1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.15), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...flowerBed(b, 'z', 1, -0.3), ...bikeRack(b, 'x', 1, 0)],
    b => [...bollards(b, 'x', 1, 4), ...flowerBed(b, 'z', 1, 0.3), ...bin(b, 'z', 1, -0.28)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...flagpole(b, 'z', 1, -0.3), ...flowerBed(b, 'z', 1, 0.3),
          ...lamp(b, 'x', 1, 0.15, 3.4), ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 6), ...flagpole(b, 'x', 1, 0.2), ...flowerBed(b, 'x', -1, -0.15),
          ...lamp(b, 'z', 1, 0.3, 3.6), ...topiary(b, 'z', 1, -0.3)],
  ],
];

/** 住宅高：入口綠化，介於住宅低與商業之間。 */
const RES_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bin(b, 'z', 1, 0.28), ...bollards(b, 'z', 1, 4)],
    b => [...bin(b, 'x', 1, -0.2), ...bikeRack(b, 'z', 1, 0.1)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...flowerBed(b, 'z', 1, -0.3), ...bin(b, 'x', -1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.15), ...flowerBed(b, 'x', 1, -0.1), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...flowerBed(b, 'z', 1, 0.3), ...topiary(b, 'z', 1, -0.3),
          ...lamp(b, 'x', 1, 0.15, 3.0), ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 5), ...topiary(b, 'x', 1, 0.2), ...topiary(b, 'x', 1, -0.2),
          ...lamp(b, 'z', 1, -0.3, 3.2), ...flowerBed(b, 'z', 1, 0.3)],
  ],
];

const RECIPES: Record<string, [Recipe[], Recipe[], Recipe[]]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   RES_LOW,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: RES_HIGH,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    COMMERCIAL,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  COMMERCIAL,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        INDUSTRIAL,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            OFFICE,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           OFFICE,
};

/** 這個 (分區, 密度, 等級) 的矮物件組合。沒有帶子就沒有物件。 */
export function getGroundPropVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = lowPropBand(zoneType, density);
  if (!band) return [];
  const byLevel = RECIPES[heightKey(zoneType, density)];
  if (!byLevel) return [];
  const recipes = byLevel[Math.max(1, Math.min(3, level)) - 1]!;
  return recipes.map(recipe => () => mergeGeometries(recipe(band))!);
}
