import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tagPart, PART_WALL } from '../parts';
import { HALF_ENVELOPE } from './metrics';
import { maxAbsOf, partOf, type Volume } from './volume';
import { METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * `massing/` 裡唯一碰 Three.js 的地方。
 *
 * 所有形狀都用同一個 `frustum` 產生，差別只在頂面的尺寸與偏移：盒子的頂面與底面
 * 同大、山牆的頂面是一條線、四坡的頂面是一小塊、單斜的頂面是推到一側的線。
 * 五個形狀寫成五份幾何是五份幾乎一樣的頂點算術，而算錯只表現為
 * 「某個變體的屋頂怪怪的」。
 */

/** 山牆的屋脊寬度佔比。0 會產生退化三角形，所以留一條細邊。 */
const RIDGE = 0.04;

/**
 * 一個底面 w×d、頂面 topW×topD（可偏移）的稜台。
 *
 * `y0 === 0` 時省略底面：那兩個三角形永遠貼在地上，看不到。
 */
function frustum(
  v: Volume, topW: number, topD: number, offX: number, offZ: number,
): THREE.BufferGeometry {
  const hw = v.w / 2;
  const hd = v.d / 2;
  const tw = topW / 2;
  const td = topD / 2;
  const b: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const t: Array<[number, number]> = [
    [offX - tw, offZ - td], [offX + tw, offZ - td],
    [offX + tw, offZ + td], [offX - tw, offZ + td],
  ];

  const pos: number[] = [];
  /**
   * 一個四邊形，四個角**逆時針排列（從該面的外側看）**。
   *
   * 纏繞方向決定 `computeVertexNormals` 算出來的法線指向哪一側，而建築材質是
   * `FrontSide` —— 反了就會看到建築的內壁，而且不會有任何東西報錯（BUG-227）。
   */
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => { pos.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2); };

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      [b[i]![0], v.y0, b[i]![1]], [b[j]![0], v.y0, b[j]![1]],
      [t[j]![0], v.y1, t[j]![1]], [t[i]![0], v.y1, t[i]![1]],
    );
  }
  // 頂面
  quad(
    [t[0]![0], v.y1, t[0]![1]], [t[1]![0], v.y1, t[1]![1]],
    [t[2]![0], v.y1, t[2]![1]], [t[3]![0], v.y1, t[3]![1]],
  );
  // 底面只有離地時才需要 —— 貼在地上的那兩個三角形永遠看不到。
  if (v.y0 > 1e-6) {
    quad(
      [b[3]![0], v.y0, b[3]![1]], [b[2]![0], v.y0, b[2]![1]],
      [b[1]![0], v.y0, b[1]![1]], [b[0]![0], v.y0, b[0]![1]],
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  geo.translate(v.x, 0, v.z);
  return geo;
}

/** 一片鋸齒天窗的跨距：大約 6 m 一道，與真實廠房接近。 */
const SAWTOOTH_SPAN = 6 / METRES_PER_CELL;

/**
 * 圓柱的邊數。8 在等角視角下已經讀得出圓，而且**有頂點落在 ±x 與 ±z 上** ——
 * 所以縮放之後它剛好填滿宣告的盒子，量體算出來的牆面位置仍然對得上幾何。
 */
const CYLINDER_SIDES = 8;

/**
 * 圓柱：煙囪、筒倉、儲槽。
 *
 * 這是唯一不走 `frustum` 的形狀。用 `THREE.CylinderGeometry` 而不是自己疊三角形，
 * 因為它的纏繞方向本來就是外向的（BUG-227 的教訓）；但它是索引幾何又帶 uv，
 * 跟 `frustum` 的產物合併不起來，所以要先去掉 uv 再攤平。
 *
 * 攤平之後重算法線是刻意的：拿到的是平面著色，與其他形狀的低多邊形觀感一致。
 * 順序不能換 —— 非等比縮放會扭曲既有的法線。
 */
function cylinder(v: Volume): THREE.BufferGeometry {
  const src = new THREE.CylinderGeometry(0.5, 0.5, v.y1 - v.y0, CYLINDER_SIDES);
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  geo.scale(v.w, 1, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, (v.y0 + v.y1) / 2, v.z);
  return geo;
}

/**
 * 一個量體的幾何。一份量體可能產出多份幾何（鋸齒天窗是一排）。
 *
 * 匯出是給 `geometry/civic/` 用的 —— 公共建築用同一組圖元，但護欄不同
 * （擋佔地邊界而不是行人包絡線）。圖元各寫一份的下場這個專案已經示範過
 * （BUG-231 的地板顏色）。
 */
export function shapeOf(v: Volume): THREE.BufferGeometry[] {
  const alongZ = (v.facing ?? 0) % 2 === 0;
  const sign = (v.facing ?? 0) < 2 ? 1 : -1;

  switch (v.shape ?? 'box') {
    case 'box':
      return [frustum(v, v.w, v.d, 0, 0)];
    case 'cylinder':
      return [cylinder(v)];
    case 'gable':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, 0)]
        : [frustum(v, v.w * RIDGE, v.d, 0, 0)];
    case 'hip':
      return [frustum(v, v.w * 0.2, v.d * 0.2, 0, 0)];
    case 'shed':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, sign * (v.d / 2) * (1 - RIDGE))]
        : [frustum(v, v.w * RIDGE, v.d, sign * (v.w / 2) * (1 - RIDGE), 0)];
    case 'sawtooth': {
      const n = Math.max(2, Math.round(v.d / SAWTOOTH_SPAN));
      const teethD = v.d / n;
      const out: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const z = v.z - v.d / 2 + teethD * (i + 0.5);
        out.push(frustum(
          { ...v, z, d: teethD },
          v.w, teethD * RIDGE, 0, sign * (teethD / 2) * (1 - RIDGE),
        ));
      }
      return out;
    }
  }
}

/**
 * 量體轉幾何。越過行人包絡線時**丟例外**。
 *
 * 例外在遊戲執行時不該發生：生成器是確定性的、變體集合固定，所以測試跑過就
 * 表示永遠不會丟。那個 throw 是給未來改原型的人的護欄，不是執行期的錯誤處理 ——
 * 靜靜地讓行人穿牆比當場炸掉難追一百倍。
 */
export function assemble(volumes: readonly Volume[]): THREE.BufferGeometry {
  const over = maxAbsOf(volumes) - HALF_ENVELOPE;
  if (over > 1e-6) {
    throw new Error(
      `量體越過行人包絡線 ${(over * METRES_PER_CELL).toFixed(3)} m —— 行人會穿牆（BUG-221）`,
    );
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      parts.push(g);
    }
  }
  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    tagPart(empty, PART_WALL);
    return empty;
  }
  return mergeGeometries(parts)!;
}
