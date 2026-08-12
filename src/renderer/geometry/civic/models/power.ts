import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_SHELL,
} from '../../buildings/parts';
import { M, STACK } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 電廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**兩支煙囪**（頂上有紅色航警燈、管口凹到接近底部）、鋸齒屋頂的
 * 汽機廠房、變電場。
 *
 * 中間試過一版用**冷卻塔**當辨識剪影：城市裡沒有第二種建築是有腰的旋轉體，
 * 那個形狀本身就是「這是電廠」。但兩座塔的底徑接近 10 m，在 24 m 的地上
 * 佔掉整個北半，等角視角下是兩坨蓋住廠房的圓桶 —— 這一棟真正的內容
 * （長條的汽機廠房加一整片開關場）全被它們擋在後面。
 *
 * 兩支煙囪換回了那片天空：剪影從「兩坨」變成「兩根細的加一棟長的」。
 * `shape: 'cooling'` 留在形狀庫裡沒有拿掉 —— 那是一個通用形狀，
 * `MassingGeometry.test.ts` 仍然在測它。
 *
 * 四座公用設施共用 `FACADE_UTILITY`（鍍鋅浪板色票 + 高窗帶），所以它們讀起來
 * 是同一家族。彼此的差別在**剪影**：煙囪／白圓桶／土丘／方池。
 */

/**
 * 全廠的高度**一律 ×0.7**。
 *
 * 動的是廠房、煙囪與出線構架 —— 也就是剪影。變壓器與雨庇留著：
 * 它們是人的尺度的東西，跟著縮只會讓開關場看起來像模型。
 */
const HALL_TOP = M(7.7);
const HALL_ROOF = M(8.8);
/** 兩支煙囪的高度（公尺）。一高一矮 —— 等高的兩支讀起來是複製貼上。 */
const STACK_TOP = 17.5;
const STACK2_TOP = 14.0;
/** 兩支同排，站在廠房後面那一條。 */
const STACK_Z = M(-6.0);

/**
 * 清水混凝土。煙囪的殼。
 *
 * 它原本走 `PART_DETAIL` —— 窗戶是沒了，但那條分支寫死一片偏藍的金屬灰
 * （m ≈ 0.42–0.58），`vBldgColor` 連讀都沒讀。而混凝土在現實裡是很亮的，
 * 遠遠就看得到靠的正是那個亮度。`PART_SHELL` 是照著這個顏色畫的那一條路。
 */
const CONCRETE = [0.80, 0.79, 0.76] as const;

/**
 * 管口內側的煤黑。
 *
 * 凹槽本身由幾何負責（`shape: 'stack'` 的內壁法線朝軸心，見 `assemble.ts`），
 * 而深度也真的凹到接近底部。但光挖深沒有用：管壁跟著塔身走混凝土色，而管壁
 * 的法線是水平的 —— 它拿到的光與塔身外側幾乎一樣，所以俯視看進去是一圈
 * **亮的**米色，那個洞讀起來仍然是頂蓋上的一圈紋路。
 *
 * 這個引擎沒有環境光遮蔽，管口內側不會自己變暗。所以管口裡塞一支深色的內襯，
 * 它比管口窄一點、從槽底一路到管口 —— 俯視時最近的那個面就是它。
 */
const SOOT = [0.09, 0.09, 0.10] as const;

/** 一支煙囪：塔身 + 管口內襯 + 航警燈。 */
function chimney(x: number, dia: number, top: number): CivicVolume[] {
  // 凹槽的底在全高的 (1 − DEPTH) 處 —— 這個數字由幾何決定，抄一份的話
  // 幾何調深了內襯會從半空中開始。
  const floor = top * (1 - STACK.DEPTH);
  return [
    // 煙囪不該有窗戶。它原本沒有標 `part`，也就是**牆** ——
    // 而 `FACADE_UTILITY` 的牆會在上面畫一條高窗帶。
    {
      tag: 'stack', part: PART_SHELL, color: CONCRETE, shape: 'stack',
      x: M(x), z: STACK_Z, w: M(dia), d: M(dia), y0: 0, y1: M(top),
    },
    {
      // 也是開口的（`tub`）：實心圓柱的頂是一片圓盤，那會變成「管口下面
      // 0.3 m 處蓋著一塊深色的板子」，洞就只有那麼深。
      tag: 'boreLining', part: PART_SHELL, color: SOOT, shape: 'tub',
      x: M(x), z: STACK_Z,
      w: M(dia * STACK.BORE * 2 * 0.94), d: M(dia * STACK.BORE * 2 * 0.94),
      y0: M(floor), y1: M(top),
    },
    // 航警燈。夜裡的電廠就是天上那顆紅點。站在管口的**環**上，
    // 不是懸在洞的正中央 —— 偏出去的距離要落在管口內緣與塔身之間。
    {
      tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
      x: M(x + dia * 0.35), z: STACK_Z, w: M(0.5), d: M(0.5),
      y0: M(top), y1: M(top + 0.6),
    },
  ];
}

const massing: CivicVolume[] = [
  ...chimney(-6.5, 3.6, STACK_TOP),
  ...chimney(0.5, 3.0, STACK2_TOP),

  // ── 汽機廠房。煙囪前面那一排。 ──────────────────────────────
  {
    tag: 'hall',
    x: M(-2.0), z: M(2.4), w: M(18.0), d: M(6.4), y0: 0, y1: HALL_TOP,
  },
  {
    // 鋸齒屋頂 —— 廠房最好認的頂。平頂的話它與倉庫分不出來。
    tag: 'hallRoof', part: PART_ROOF, shape: 'sawtooth', facing: 0,
    x: M(-2.0), z: M(2.4), w: M(18.6), d: M(7.0), y0: HALL_TOP, y1: HALL_ROOF,
  },
];

const decals: CivicDecal[] = [
  // 煙囪那一帶的混凝土：z [−12, −0.8]
  { x: 0, z: M(-6.4), w: M(24.0), d: M(11.2), shade: 0.55 },
  // 廠房與變電場的柏油：z [−0.8, 12]
  { x: 0, z: M(5.6), w: M(24.0), d: M(12.8), shade: 0.0 },
];

// 出入口的斑馬線與車道邊線。
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-9.0 + i * 2.2), z: M(10.6), w: M(0.5), d: M(2.0),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * 變電場：三台變壓器 + 兩座出線構架。
 *
 * 構架（門型的兩柱一樑）是「電從這裡出去」的訊號 —— 少了它，那三個方塊
 * 只是地上的三個方塊。
 */
const props: CivicVolume[] = [
  ...([-9.0, -5.4, -1.8] as const).map((x): CivicVolume => ({
    tag: 'transformer', part: PART_DETAIL,
    x: M(x), z: M(9.4), w: M(2.6), d: M(2.2), y0: 0, y1: M(2.4),
  })),
  ...([3.0, 8.0] as const).flatMap((x): CivicVolume[] => [
    ...([-1.6, 1.6] as const).map((dz): CivicVolume => ({
      tag: 'gantryPost', part: PART_DETAIL,
      x: M(x), z: M(9.4 + dz), w: M(0.4), d: M(0.4), y0: 0, y1: M(4.9),
    })),
    {
      tag: 'gantryBeam', part: PART_DETAIL,
      x: M(x), z: M(9.4), w: M(0.4), d: M(3.6), y0: M(4.9), y1: M(5.2),
    },
  ]),
];

const overhead: CivicVolume[] = [
  // 廠房側門的雨庇。
  {
    tag: 'canopy',
    x: M(-8.0), z: M(6.2), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // 廠區圍籬 —— 三面。第四面（z 正向）是大門，留空。
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  // 工業雜項。這些是「這裡有製程」的訊號 —— 排在煙囪、廠房與變電場之間的
  // 通道上。冷卻塔換成兩支煙囪之後北半空了一大片，所以那一帶也放了幾件：
  // 一整片沒有東西的混凝土讀起來是停車場，不是廠區。
  { kind: 'pipeRack', x: M(8.0), z: M(4.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(9.6), z: M(-5.5), axis: 'x', span: M(3.5) },
  { kind: 'pipeRack', x: M(-3.0), z: M(-9.6), axis: 'z', span: M(6.0) },
  { kind: 'drum', x: M(10.2), z: M(2.0), radius: M(0.42) },
  { kind: 'drum', x: M(10.2), z: M(3.2), radius: M(0.42) },
  { kind: 'drum', x: M(6.0), z: M(-8.6), radius: M(0.42) },
  { kind: 'drum', x: M(7.2), z: M(-8.6), radius: M(0.42) },
  { kind: 'gasBottles', x: M(-10.4), z: M(6.6), axis: 'z', radius: M(0.24) },
  { kind: 'palletStack', x: M(-2.0), z: M(11.0), axis: 'z', depth: M(1.0) },
  { kind: 'palletStack', x: M(-10.0), z: M(-3.4), axis: 'z', depth: M(1.0) },

  // 廠區的高桿燈。夜裡沒有它，整片柏油是一塊黑。
  { kind: 'lamp', x: M(-10.4), z: M(7.4), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(11.0), heightM: 6.0 },
  { kind: 'lamp', x: M(10.4), z: M(7.4), heightM: 6.0 },
  { kind: 'lamp', x: M(9.4), z: M(-10.2), heightM: 6.0 },

  // 沿著街廓那一側的綠籬與樹 —— 廠區對外總得有一點遮蔽。
  { kind: 'hedge', x: M(-7.0), z: M(11.4), axis: 'z', length: M(6.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-10.6), z: M(10.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(5.4), z: M(10.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(-1.0), z: M(9.4), radius: M(0.8) },
  { kind: 'shrub', x: M(0.8), z: M(9.4), radius: M(0.8) },

  { kind: 'signPost', x: M(1.0), z: M(6.6), axis: 'z' },
  { kind: 'hydrant', x: M(10.6), z: M(6.0) },
  { kind: 'bollard', x: M(-0.6), z: M(11.4), radius: M(0.12) },
  { kind: 'bollard', x: M(0.6), z: M(11.4), radius: M(0.12) },
];


/**
 * 廠區的兩台車，停在廠房與變電場之間那條通道上。
 *
 * 廠房橫在基地中間，變電場（變壓器 + 出線構架）佔了南緣，兩者之間這一條
 * 是南半唯一容得下車身的空地。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.0), z: M(7.0) },
  { kind: 'van', x: M(5.0), z: M(7.0) },
];

/**
 * `aSeed`。
 *
 * `FACADE_UTILITY` 畫的是**高窗帶**而不是逐層窗格，所以 `.x` 影響的是帶的
 * 高度而不是樓層數 —— 0.62 讓 12 m 的廠房只在接近屋簷處有一條採光帶，
 * 那正是汽機廠房的樣子。
 */
const SEED = [0.62, 0.18, 0.44] as const;

export const powerPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('power'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
