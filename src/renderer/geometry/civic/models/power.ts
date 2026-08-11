import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_SHELL,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 電廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**兩座冷卻塔**、一支高煙囪（頂上有紅色航警燈）、鋸齒屋頂的
 * 汽機廠房、變電場。
 *
 * 使用者：「發電廠的形象也要改一下 現在看不出是電廠」。原本的剪影是兩支
 * 圓柱煙囪加一棟廠房 —— 而那與旁邊的水廠（一支圓柱水塔加一棟機房）幾乎是
 * 同一個剪影，四座公用設施又共用同一組立面色票，於是「看不出是電廠」。
 *
 * 冷卻塔是電廠**獨有**的形狀：城市裡沒有第二種建築是有腰的旋轉體
 * （`shape: 'cooling'`，`shapeOf` 為此新增的形狀）。它比煙囪更好認 ——
 * 煙囪只是一根柱子，而柱子到處都是。
 *
 * 四座公用設施共用 `FACADE_UTILITY`（鍍鋅浪板色票 + 高窗帶），所以它們讀起來
 * 是同一家族。彼此的差別在**剪影**：冷卻塔／圓槽／土丘／方池。
 */

const HALL_TOP = M(11.0);
const HALL_ROOF = M(12.6);
/** 高煙囪。航警燈疊在它上面。 */
const STACK_TOP = M(25.0);
/** 冷卻塔。底座直徑 9.6 m，高 17 m —— 塔身的比例接近真實的雙曲線塔。 */
const COOL_TOP = M(17.0);
const COOL_DIA = 9.6;

/**
 * 清水混凝土。冷卻塔與煙囪的殼。
 *
 * 它們原本走 `PART_DETAIL` —— 窗戶是沒了，但那條分支寫死一片偏藍的金屬灰
 * （m ≈ 0.42–0.58），`vBldgColor` 連讀都沒讀。於是這一棟唯一的辨識剪影是
 * 深灰的，而冷卻塔在現實裡是很亮的一坨混凝土 —— 它遠遠就看得到，靠的正是
 * 那個亮度。`PART_SHELL` 是照著這個顏色畫的那一條路。
 */
const CONCRETE = [0.80, 0.79, 0.76] as const;

const massing: CivicVolume[] = [
  // ── 兩座冷卻塔。這一棟的剪影就是它們。 ──────────────────────
  // 一大一小：等大的兩座讀起來是複製貼上，而真實廠區的機組本來就分期蓋。
  {
    tag: 'coolingTower', part: PART_SHELL, color: CONCRETE, shape: 'cooling',
    x: M(-6.0), z: M(-6.0), w: M(COOL_DIA), d: M(COOL_DIA), y0: 0, y1: COOL_TOP,
  },
  {
    tag: 'coolingTower', part: PART_SHELL, color: CONCRETE, shape: 'cooling',
    x: M(4.6), z: M(-6.6), w: M(8.4), d: M(8.4), y0: 0, y1: M(14.6),
  },

  // ── 汽機廠房。冷卻塔前面那一排。 ────────────────────────────
  {
    tag: 'hall',
    x: M(-2.0), z: M(2.4), w: M(18.0), d: M(6.4), y0: 0, y1: HALL_TOP,
  },
  {
    // 鋸齒屋頂 —— 廠房最好認的頂。平頂的話它與倉庫分不出來。
    tag: 'hallRoof', part: PART_ROOF, shape: 'sawtooth', facing: 0,
    x: M(-2.0), z: M(2.4), w: M(18.6), d: M(7.0), y0: HALL_TOP, y1: HALL_ROOF,
  },

  // ── 煙囪。冷卻塔冒的是水氣，燒的那一支還是要有。 ──────────────
  // 使用者：「電廠的煙囪我覺得不需要窗戶，就單純煙囪就好」。它原本沒有標
  // `part`，也就是**牆** —— 而 `FACADE_UTILITY` 的牆會在上面畫一條高窗帶。
  //
  // 然後：「煙囪好像只畫單面? 會看到破口 是不是可以做凹槽」。圓柱的頂是一片
  // 實心的圓盤，而 25 m 高的東西在等角視角下最先看到的就是它的頂。
  // `shape: 'stack'` 把頂做成一圈環加一個凹下去的管口 —— 見 `assemble.ts`
  // 的 `chimney`：凹槽的內壁法線朝軸心，所以俯視看得進去而不是穿過去。
  {
    tag: 'stack', part: PART_SHELL, color: CONCRETE, shape: 'stack',
    x: M(10.0), z: M(-0.6), w: M(3.0), d: M(3.0), y0: 0, y1: STACK_TOP,
  },
  // 航警燈。夜裡的電廠就是天上那顆紅點 —— 而它本來就該在那裡。
  // 站在管口的**環**上（x 偏 1.05 m），不是懸在洞的正中央。
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(11.05), z: M(-0.6), w: M(0.5), d: M(0.5), y0: STACK_TOP, y1: M(25.6),
  },
];

const decals: CivicDecal[] = [
  // 冷卻塔那一帶的混凝土：z [−12, −0.8]
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
      x: M(x), z: M(9.4 + dz), w: M(0.4), d: M(0.4), y0: 0, y1: M(7.0),
    })),
    {
      tag: 'gantryBeam', part: PART_DETAIL,
      x: M(x), z: M(9.4), w: M(0.4), d: M(3.6), y0: M(7.0), y1: M(7.4),
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

  // 工業雜項。這些是「這裡有製程」的訊號 —— 全部排在冷卻塔、廠房與
  // 變電場之間僅剩的那幾條通道上。
  { kind: 'pipeRack', x: M(8.0), z: M(4.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(9.6), z: M(-5.5), axis: 'x', span: M(3.5) },
  { kind: 'drum', x: M(10.2), z: M(2.0), radius: M(0.42) },
  { kind: 'drum', x: M(10.2), z: M(3.2), radius: M(0.42) },
  { kind: 'gasBottles', x: M(-10.4), z: M(6.6), axis: 'z', radius: M(0.24) },
  { kind: 'palletStack', x: M(-2.0), z: M(11.0), axis: 'z', depth: M(1.0) },

  // 廠區的高桿燈。夜裡沒有它，整片柏油是一塊黑。
  { kind: 'lamp', x: M(-10.4), z: M(7.4), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(11.0), heightM: 6.0 },
  { kind: 'lamp', x: M(10.4), z: M(7.4), heightM: 6.0 },

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
 * 這條通道是重排廠區之後唯一剩下的空地：冷卻塔佔了北半，廠房橫在中間，
 * 變電場（變壓器 + 出線構架）佔了南緣。
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
