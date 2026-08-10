import * as THREE from 'three';
import { tagPart, PART_DETAIL, PART_LAMP } from './buildings/parts';
import { M } from './buildings/massing/metrics';
import {
  columnarTree, shrubBall, topiary, flowerBed, hedge,
} from './plants';

/**
 * 街道家具與工業雜項 —— 人造的矮物件。
 *
 * 綠化在 `plants.ts`，這裡是其餘的：路燈、垃圾桶、單車架、矮柱、圍籬、
 * 告示牌、信箱、消防栓、旗桿，以及工業的油桶、管架、氣瓶、棧板。
 *
 * 抽出來的理由與 `plants.ts` 相同：這些東西原本綁在「格子的物件帶」上
 * （吃 `band` / `axis` / `sign` / `t`），而公共建築佔 2×2 到 9×6 格，
 * 根本沒有環帶這回事。使用者的一句話：「花盆什麼的所有矮物件都可以做成共用?」
 *
 * **這個模組不知道呼叫者是誰。** 它吃世界座標與尺寸（單位是格），住宅那一側
 * 從帶算出座標再呼叫它，公共建築直接給座標。
 *
 * `axis` 一律是「這個東西**延伸的方向**」：`'z'` 表示沿世界 x 展開。那個
 * 看起來反過來的約定來自住宅那一側的「沿著格子的哪一條邊」—— 兩邊用同一套
 * 才不會有人得在腦中翻譯。
 */

export type PropAxis = 'x' | 'z';

/** 一段連續的帶狀物（矮牆、花台邊、路緣）。標 `PART_DETAIL` 走金屬灰分支。 */
export function strip(
  x: number, z: number, axis: PropAxis,
  length: number, depth: number, heightM: number, part = PART_DETAIL,
): THREE.BufferGeometry {
  const h = M(heightM);
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(length, h, depth)
    : new THREE.BoxGeometry(depth, h, length);
  geo.translate(x, h / 2, z);
  tagPart(geo, part);
  return geo;
}

/** 信箱：一根柱加一個箱。 */
export function mailbox(x: number, z: number): THREE.BufferGeometry[] {
  const post = new THREE.BoxGeometry(M(0.12), M(1.0), M(0.12));
  post.translate(x, M(0.5), z);
  tagPart(post, PART_DETAIL);
  const box = new THREE.BoxGeometry(M(0.34), M(0.24), M(0.22));
  box.translate(x, M(1.12), z);
  tagPart(box, PART_DETAIL);
  return [post, box];
}

/** 垃圾桶。 */
export function bin(x: number, z: number, radius: number): THREE.BufferGeometry[] {
  const body = new THREE.CylinderGeometry(radius, radius * 0.85, M(0.9), 5);
  body.translate(x, M(0.45), z);
  tagPart(body, PART_DETAIL);
  const lid = new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, M(0.08), 5);
  lid.translate(x, M(0.94), z);
  tagPart(lid, PART_DETAIL);
  return [body, lid];
}

/** 一根擋車矮柱。方柱而不是圓柱：0.11 m 的柱子在等角視角下看不出圓方，圓柱貴八成。 */
export function bollard(x: number, z: number, radius: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(radius * 1.7, M(0.85), radius * 1.7);
  post.translate(x, M(0.425), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** 一根圍籬柱。比矮柱細。 */
export function fencePost(x: number, z: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(M(0.1), M(1.0), M(0.1));
  post.translate(x, M(0.5), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** 圍籬的橫桿。 */
export function fenceRail(
  x: number, z: number, axis: PropAxis, span: number,
): THREE.BufferGeometry {
  const rail = axis === 'z'
    ? new THREE.BoxGeometry(span, M(0.1), M(0.06))
    : new THREE.BoxGeometry(M(0.06), M(0.1), span);
  rail.translate(x, M(0.72), z);
  tagPart(rail, PART_DETAIL);
  return rail;
}

/** 單車架：兩個半圓環。 */
export function bikeRack(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const off of [-M(0.35), M(0.35)]) {
    const hoop = new THREE.TorusGeometry(M(0.32), M(0.045), 3, 5, Math.PI);
    hoop.rotateY(axis === 'z' ? 0 : Math.PI / 2);
    hoop.translate(axis === 'z' ? x + off : x, 0, axis === 'z' ? z : z + off);
    tagPart(hoop, PART_DETAIL);
    out.push(hoop);
  }
  return out;
}

/**
 * 庭園燈／路燈。
 *
 * 燈桿是冷的金屬（`PART_DETAIL`），只有**燈頭**發光（`PART_LAMP`）——
 * 整支都標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
 */
export function lamp(x: number, z: number, heightM: number): THREE.BufferGeometry[] {
  const pole = new THREE.CylinderGeometry(M(0.07), M(0.09), M(heightM), 4);
  pole.translate(x, M(heightM) / 2, z);
  tagPart(pole, PART_DETAIL);
  const head = new THREE.SphereGeometry(M(0.18), 4, 3);
  head.translate(x, M(heightM) + M(0.14), z);
  tagPart(head, PART_LAMP);
  return [pole, head];
}

/** 曬衣桿的一根柱。 */
export function dryingPost(x: number, z: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(M(0.09), M(1.7), M(0.09));
  post.translate(x, M(0.85), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** 曬衣繩。 */
export function dryingLine(
  x: number, z: number, axis: PropAxis, span: number, heightM: number,
): THREE.BufferGeometry {
  const line = axis === 'z'
    ? new THREE.BoxGeometry(span, M(0.04), M(0.04))
    : new THREE.BoxGeometry(M(0.04), M(0.04), span);
  line.translate(x, M(heightM), z);
  tagPart(line, PART_DETAIL);
  return line;
}

/** 告示牌／招牌立柱。 */
export function signPost(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
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

/** 油桶。 */
export function drum(x: number, z: number, radius: number): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(radius, radius, M(0.88), 6);
  body.translate(x, M(0.44), z);
  tagPart(body, PART_DETAIL);
  return body;
}

/**
 * 管架：兩根立柱撐著兩條橫管。
 *
 * 廠區最好認的東西之一，而且它是**水平**的 —— 一整層站著的柱狀物裡加一個
 * 橫的，立刻讀得出「這裡有製程」。
 *
 * 高度壓在 2 m 以下：再高就侵入懸挑層的淨空（`OVERHEAD_CLEARANCE`）。
 */
export function pipeRack(
  x: number, z: number, axis: PropAxis, span: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const t of [-span / 2, span / 2]) {
    const post = new THREE.BoxGeometry(M(0.16), M(2.0), M(0.16));
    post.translate(axis === 'z' ? x + t : x, M(1.0), axis === 'z' ? z : z + t);
    tagPart(post, PART_DETAIL);
    out.push(post);
  }
  for (const [h, r] of [[1.35, 0.13], [1.75, 0.1]] as const) {
    const pipe = new THREE.CylinderGeometry(M(r), M(r), span, 4);
    // `CylinderGeometry` 的軸是 y。沿邊擺就得先轉倒 —— z 軸的邊沿 x 展開，
    // x 軸的邊沿 z 展開（與 `strip` 同一套約定）。
    if (axis === 'z') pipe.rotateZ(Math.PI / 2);
    else pipe.rotateX(Math.PI / 2);
    pipe.translate(x, M(h), z);
    tagPart(pipe, PART_DETAIL);
    out.push(pipe);
  }
  return out;
}

/** 氣瓶架：三支高壓氣瓶靠著一道矮框。 */
export function gasBottles(
  x: number, z: number, axis: PropAxis, radius: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= 1; i++) {
    const off = i * M(0.42);
    const body = new THREE.CylinderGeometry(radius, radius, M(1.3), 4);
    body.translate(axis === 'z' ? x + off : x, M(0.65), axis === 'z' ? z : z + off);
    tagPart(body, PART_DETAIL);
    out.push(body);
  }
  const frame = axis === 'z'
    ? new THREE.BoxGeometry(M(1.5), M(0.1), M(0.08))
    : new THREE.BoxGeometry(M(0.08), M(0.1), M(1.5));
  frame.translate(x, M(1.05), z);
  tagPart(frame, PART_DETAIL);
  out.push(frame);
  return out;
}

/**
 * 棧板堆：三層木棧板疊著。
 *
 * 沿邊的長度不受帶寬限制 —— 住宅那側的帶子只有 0.4 m 深，但沿著牆可以擺
 * 1.2 m 長。所以這是窄帶裡少數還放得下的「有體積的貨」。
 */
export function palletStack(
  x: number, z: number, axis: PropAxis, depth: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const slab = axis === 'z'
      ? new THREE.BoxGeometry(M(1.2), M(0.16), depth)
      : new THREE.BoxGeometry(depth, M(0.16), M(1.2));
    slab.translate(x, M(0.16) * (i + 0.5) + M(0.06) * i, z);
    tagPart(slab, PART_DETAIL);
    out.push(slab);
  }
  return out;
}

/** 消防栓。 */
export function hydrant(x: number, z: number): THREE.BufferGeometry[] {
  const body = new THREE.CylinderGeometry(M(0.11), M(0.14), M(0.7), 5);
  body.translate(x, M(0.35), z);
  tagPart(body, PART_DETAIL);
  const cap = new THREE.SphereGeometry(M(0.12), 4, 2);
  cap.translate(x, M(0.72), z);
  tagPart(cap, PART_DETAIL);
  return [body, cap];
}

/** 旗桿。回傳順序是 [旗, 桿] —— 與住宅那側的舊實作一致。 */
export function flagpole(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
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

// ===== 宣告式介面 =====

/**
 * 一件矮物件的宣告。
 *
 * 上面那些函式吃座標與尺寸，適合住宅那側（它從帶算出座標）。公共建築是
 * **宣告式**的 —— 一棟建築就是一張表 —— 所以它需要一個能寫進表裡的形式。
 *
 * 綠化與街道家具放在同一個聯集：對呼叫者來說它們是同一件事（「在這裡放一個
 * 東西」），而分開成兩張表只會讓每棟建築多一個欄位要記得填。
 */
export type PropSpec =
  | { kind: 'tree'; x: number; z: number; heightM: number; crownRadius: number }
  | { kind: 'shrub'; x: number; z: number; radius: number }
  | { kind: 'topiary'; x: number; z: number; radius: number }
  | { kind: 'flowerBed'; x: number; z: number; radius: number }
  | {
    kind: 'hedge'; x: number; z: number; axis: PropAxis;
    length: number; depth: number; heightM: number;
  }
  | { kind: 'lamp'; x: number; z: number; heightM: number }
  | { kind: 'bin'; x: number; z: number; radius: number }
  | { kind: 'bikeRack'; x: number; z: number; axis: PropAxis }
  | { kind: 'bollard'; x: number; z: number; radius: number }
  | { kind: 'hydrant'; x: number; z: number }
  | { kind: 'flagpole'; x: number; z: number; axis: PropAxis }
  | { kind: 'signPost'; x: number; z: number; axis: PropAxis }
  | { kind: 'mailbox'; x: number; z: number }
  | { kind: 'drum'; x: number; z: number; radius: number }
  | { kind: 'pipeRack'; x: number; z: number; axis: PropAxis; span: number }
  | { kind: 'gasBottles'; x: number; z: number; axis: PropAxis; radius: number }
  | { kind: 'palletStack'; x: number; z: number; axis: PropAxis; depth: number }
  | { kind: 'fence'; x: number; z: number; axis: PropAxis; length: number };

/** 圍籬柱的間距（格）。2 m —— 再疏的話橫桿看起來是垂的。 */
const FENCE_POST_SPACING = M(2.0);
/** 圍籬柱的邊長。與 `fencePost` 裡的一致。 */
const FENCE_POST_W = M(0.1);

/**
 * 一段圍籬：等距的柱子加一條橫桿。
 *
 * 柱數隨長度成長 —— 固定三根的話，一道 30 m 的圍籬中間會垂著兩條沒有支撐的
 * 長桿。圖元本身（`fencePost` / `fenceRail`）與住宅那側共用。
 */
function fenceRun(
  x: number, z: number, axis: PropAxis, length: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [fenceRail(x, z, axis, length)];
  // 兩端的柱子往內縮半個柱寬，整段圍籬才**剛好**佔 `length` —— 柱心對齊
  // 端點的話它會多伸出去半個柱寬，而兩道相接的圍籬就會在轉角互相插進去。
  const run = length - FENCE_POST_W;
  const spans = Math.max(1, Math.round(run / FENCE_POST_SPACING));
  for (let i = 0; i <= spans; i++) {
    const t = -run / 2 + (run * i) / spans;
    out.push(axis === 'z' ? fencePost(x + t, z) : fencePost(x, z + t));
  }
  return out;
}

/** 這件物件的幾何。 */
export function propGeometry(p: PropSpec): THREE.BufferGeometry[] {
  switch (p.kind) {
    case 'tree': return columnarTree(p.x, p.z, p.heightM, p.crownRadius);
    case 'shrub': return [shrubBall(p.x, p.z, p.radius)];
    case 'topiary': return topiary(p.x, p.z, p.radius);
    case 'flowerBed': return flowerBed(p.x, p.z, p.radius);
    case 'hedge': return [hedge(p.x, p.z, p.axis, p.length, p.depth, p.heightM)];
    case 'lamp': return lamp(p.x, p.z, p.heightM);
    case 'bin': return bin(p.x, p.z, p.radius);
    case 'bikeRack': return bikeRack(p.x, p.z, p.axis);
    case 'bollard': return [bollard(p.x, p.z, p.radius)];
    case 'hydrant': return hydrant(p.x, p.z);
    case 'flagpole': return flagpole(p.x, p.z, p.axis);
    case 'signPost': return signPost(p.x, p.z, p.axis);
    case 'mailbox': return mailbox(p.x, p.z);
    case 'drum': return [drum(p.x, p.z, p.radius)];
    case 'pipeRack': return pipeRack(p.x, p.z, p.axis, p.span);
    case 'gasBottles': return gasBottles(p.x, p.z, p.axis, p.radius);
    case 'palletStack': return palletStack(p.x, p.z, p.axis, p.depth);
    case 'fence': return fenceRun(p.x, p.z, p.axis, p.length);
  }
}

/**
 * 這件物件在 x / z 兩軸各佔多寬（半寬，單位是格）。
 *
 * 公共建築用它做佔地檢查。**寧可高報**：少報的話東西會伸出去壓到鄰格，
 * 而多報只是讓它站得離邊界遠一點。
 */
export function propExtent(p: PropSpec): { x: number; z: number } {
  const iso = (r: number) => ({ x: r, z: r });
  // 沿 `axis` 展開的東西：`'z'` 表示沿世界 x 展開（見檔頭的約定）。
  const along = (len: number, thick: number, axis: PropAxis) =>
    (axis === 'z' ? { x: len / 2, z: thick } : { x: thick, z: len / 2 });

  switch (p.kind) {
    case 'tree': return iso(p.crownRadius);
    case 'shrub': return iso(p.radius);
    case 'topiary': return iso(p.radius);
    case 'flowerBed': return iso(p.radius);
    case 'hedge': return along(p.length, p.depth / 2, p.axis);
    case 'lamp': return iso(M(0.18));
    case 'bin': return iso(p.radius * 1.1);
    // 兩個環各偏 0.35 m，環半徑 0.32 m。
    case 'bikeRack': return along(M(1.34), M(0.37), p.axis);
    case 'bollard': return iso(p.radius * 0.85);
    case 'hydrant': return iso(M(0.14));
    // 旗子往 +x（或 +z）伸出 0.32 m，再加半個旗寬。
    case 'flagpole': return along(M(1.0), M(0.5), p.axis);
    case 'signPost': return along(M(0.7), M(0.06), p.axis);
    case 'mailbox': return iso(M(0.17));
    case 'drum': return iso(p.radius);
    case 'pipeRack': return along(p.span, M(0.08), p.axis);
    case 'gasBottles': return along(M(1.5), p.radius, p.axis);
    case 'palletStack': return along(M(1.2), p.depth / 2, p.axis);
    // 柱子 0.1 m 見方，橫桿 0.06 m —— 厚度取柱子的半寬。
    case 'fence': return along(p.length, M(0.05), p.axis);
  }
}
