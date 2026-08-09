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
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => { pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };

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

function shapeOf(v: Volume): THREE.BufferGeometry[] {
  const alongZ = (v.facing ?? 0) % 2 === 0;
  const sign = (v.facing ?? 0) < 2 ? 1 : -1;

  switch (v.shape ?? 'box') {
    case 'box':
      return [frustum(v, v.w, v.d, 0, 0)];
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
