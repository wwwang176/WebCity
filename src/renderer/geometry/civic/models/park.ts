import {
  FACADE_GREEN, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * 公園 —— 1×1 格 = 12 × 12 m。全專案最小的公共設施。
 *
 * 可用範圍只有 ±5.76 m，所以它沒有「建築」—— 有的只是一座涼亭、一個十字
 * 步道、四塊草地與一圈樹。這正是公園該有的樣子：**地是主角，量體是配角**。
 *
 * 因為小，它也是唯一一種會被大量重複擺放的公共設施（一格 200 元），所以
 * 三角形要省。二十棵樹的公園在城市裡出現三十次就是三十倍的成本。
 *
 * ```
 *        │
 *   草地  │  草地
 *   ──────┼──────   十字步道，四個端點都通到格子邊界
 *   草地  │  草地
 *        │
 *      中央涼亭
 * ```
 */

/** 涼亭的柱頂。屋頂從這裡開始。 */
const EAVE = M(2.7);
/** 步道半寬。 */
const PATH_HALF = 0.9;
/** 格子的半邊長（公尺）。貼片鋪到這裡，不留內縮 —— 人行道本來就鋪到路邊。 */
const HALF = 6.0;

const massing: CivicVolume[] = [
  // 涼亭的台座。走 `PART_GROUND` + `shade`：它是**鋪面**，不是牆 ——
  // 標成牆的話這座 0.25 m 高的台子會長出窗戶。
  {
    tag: 'deck', part: PART_GROUND, shade: 0.62, shape: 'cylinder',
    x: 0, z: 0, w: M(3.8), d: M(3.8), y0: 0, y1: M(0.25),
  },
  // 兩段收分的屋頂。`cylinder` 是八角柱，兩層疊起來就讀得出攢尖頂。
  {
    tag: 'gazeboRoof', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: 0, w: M(4.4), d: M(4.4), y0: EAVE, y1: M(3.1),
  },
  {
    tag: 'gazeboRoof', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: 0, w: M(2.6), d: M(2.6), y0: M(3.1), y1: M(3.5),
  },
  {
    // 亭子裡的燈。夜裡整座公園只剩它 —— 沒有它公園在夜景裡是一塊黑地。
    tag: 'finial', part: PART_LAMP, shape: 'cylinder',
    x: 0, z: 0, w: M(0.5), d: M(0.5), y0: M(3.5), y1: M(3.9),
  },
];

/**
 * 地面。四塊草地 + 一個十字步道。
 *
 * 步道的四個端點都通到格子邊界 —— 走不進去的公園是一塊裝飾用的草皮。
 * 底層貼片彼此不得重疊，所以草地被切成四塊，東西向的步道也是兩段
 * （中央那一格歸南北向那一條）。
 */
const decals: CivicDecal[] = [
  { x: 0, z: 0, w: M(PATH_HALF * 2), d: M(HALF * 2), shade: 0.62 },
];

for (const side of [-1, 1]) {
  decals.push({
    x: M(side * (PATH_HALF + HALF) / 2), z: 0,
    w: M(HALF - PATH_HALF), d: M(PATH_HALF * 2), shade: 0.62,
  });
  for (const sz of [-1, 1]) {
    decals.push({
      x: M(side * (PATH_HALF + HALF) / 2), z: M(sz * (PATH_HALF + HALF) / 2),
      w: M(HALF - PATH_HALF), d: M(HALF - PATH_HALF), shade: 0.0, lawn: true,
    });
  }
}

/** 涼亭的四根柱，加四張長椅。`geometry/props` 兩者都沒有。 */
const props: CivicVolume[] = [
  ...([[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'post', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(0.16), d: M(0.16), y0: M(0.25), y1: EAVE,
    })),
  // 長椅沿著步道擺，背對草地。
  ...([[-2.6, 1.5, 'x'], [2.6, 1.5, 'x'], [-2.6, -1.5, 'x'], [2.6, -1.5, 'x']] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'bench', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(1.6), d: M(0.5), y0: M(0.3), y1: M(0.45),
    })),
];

/**
 * 綠化。公園的三角形幾乎全部花在這裡 —— 它就是這棟建築的內容。
 *
 * 樹種在四塊草地上，不種在步道上。
 */
const fixtures: PropSpec[] = [
  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'tree' as const,
    x: M(sx * 3.6), z: M(sz * 3.6), heightM: 7.0, crownRadius: M(1.5),
  }))),
  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'tree' as const,
    x: M(sx * 4.6), z: M(sz * 1.6), heightM: 5.2, crownRadius: M(1.0),
  }))),

  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'shrub' as const, x: M(sx * 1.8), z: M(sz * 4.8), radius: M(0.7),
  }))),
  { kind: 'flowerBed', x: M(-4.8), z: M(4.8), radius: M(0.7) },
  { kind: 'flowerBed', x: M(4.8), z: M(4.8), radius: M(0.7) },
  { kind: 'topiary', x: M(-4.8), z: M(-4.8), radius: M(0.7) },
  { kind: 'topiary', x: M(4.8), z: M(-4.8), radius: M(0.7) },

  // 步道的兩支燈。涼亭的燈照不到入口。
  { kind: 'lamp', x: M(-1.3), z: M(4.2), heightM: 3.6 },
  { kind: 'lamp', x: M(1.3), z: M(-4.2), heightM: 3.6 },
  { kind: 'bin', x: M(1.3), z: M(4.2), radius: M(0.24) },
  { kind: 'signPost', x: M(-1.3), z: M(-4.2), axis: 'z' },
];

/**
 * `aSeed`。
 *
 * 公園沒有牆，所以 `.x`（樓層節奏）在它身上不影響任何東西 —— 給一個中間值。
 * `.z` 是材質微調，它會影響涼亭燈的明度。
 */
const SEED = [0.5, 0.66, 0.55] as const;

export const parkPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_GREEN,
  color: civicColorOf('park'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead: [],
  fixtures,
  // 12 × 12 m 的公園沒有停車場，也不該有 —— 走路來的。
  vehicles: [],
};
