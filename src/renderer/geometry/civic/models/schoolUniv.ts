import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 大學 —— 3×3 格 = 36 × 36 m。
 *
 * 辨識特徵：**四面圍合的方庭**、圓頂主樓、鐘塔。方庭是最強的那一個 ——
 * 它是城市裡唯一一棟「中間是空的」建築，而那在等角視角下一眼就看得出來。
 *
 * ```
 *   z-  ┌───────────────────────────┐
 *       │      北棟（圓頂在中央）       │
 *       ├────┬─────────────────┬────┤
 *       │ 西 │   方庭：草地      │ 東 │
 *       │ 棟 │   ＋十字步道      │ 棟 │
 *       │    │   ＋中央水池      │    │
 *       ├────┴─────────────────┴────┤
 *       │      南棟（鐘塔在中央）       │
 *       └───────────▔▔▔─────────────┘
 *   z+          前庭（校車與訪客車）
 * ```
 */

const RANGE_N_TOP = M(14.0);
const RANGE_N_ROOF = M(14.5);
const RANGE_TOP = M(12.0);
const RANGE_ROOF = M(12.5);

/**
 * 北棟的中心。圓頂疊在它正上方。
 *
 * 北棟比其他三棟深（9 m 對 7 m）—— 圓頂要**整個落在它上面**，而 8.4 m 的
 * 圓頂放在 7 m 深的棟上會前後各伸出 0.7 m，後面那一邊直接掉出基地。
 */
const NORTH_Z = M(-12.5);
/** 南棟的中心。鐘塔疊在它正上方。 */
const SOUTH_Z = M(9.5);

/**
 * 圓頂 —— **鼓座 + 半球**。
 *
 * 使用者：「大學保留圓頂，移除另一個高塔，但圓頂我覺得要改一下，要看起來是
 * 半球形」。原本它是一疊愈往上愈窄的八角柱（8.4 → 7.6 → 5.6 → 3.4 m），
 * 遠景讀得出「圓頂」，走近就是四層邊緣分明的台階。
 *
 * 現在半球走 `shape: 'dome'`（`shapeOf` 新增的形狀），而下面墊一段鼓座 ——
 * 直接把半球扣在屋頂上的話它太扁：半球的高度必然只有直徑的一半，而圓頂的
 * 高度是這一棟的剪影。鼓座同時是真實圓頂的做法（採光層就在那一圈）。
 *
 * 兩段都走 `PART_ROOF` 而不是 `PART_WALL`：牆的分支會在它身上畫窗格，
 * 而一個長滿窗戶的圓頂看起來就只是一個有點怪的塔。
 *
 * 直徑不得超過北棟的深度（9 m）。
 */
/**
 * 使用者：「大學圓頂的高度可以-30%」。
 *
 * 半球的高度**必然**是直徑的一半，所以「降低圓頂」只有兩條路：縮直徑，
 * 或縮鼓座。兩條各走一半 —— 直徑 8.4 → 6.4、鼓座 3.5 → 2.2 m，整組
 * （鼓座 + 半球）從 7.7 m 降到 5.4 m，剛好 −30%。
 *
 * 只縮鼓座的話它會低到讀不出「這是一座鼓」；只縮直徑的話圓頂會小得像
 * 屋頂上的一個帽子。
 */
const DOME_DIA = 6.4;
const DRUM_BASE = M(14.5);
const DRUM_TOP = M(16.7);
/** 半球的高度 = 半徑。 */
const DOME_TOP_M = 16.7 + DOME_DIA / 2;

const massing: CivicVolume[] = [
  // ── 四棟圍成方庭 ──────────────────────────────────────────
  // 北棟：x [−17, 17]、z [−17, −8]。比其他三棟深，好放得下圓頂。
  {
    tag: 'range',
    x: 0, z: NORTH_Z, w: M(34.0), d: M(9.0), y0: 0, y1: RANGE_N_TOP,
  },
  {
    // 只往北出簷 —— 南緣是方庭，東西兩端接著側棟。
    tag: 'rangeRoof', part: PART_ROOF,
    x: 0, z: M(-12.65), w: M(34.6), d: M(9.3), y0: RANGE_N_TOP, y1: RANGE_N_ROOF,
  },
  // 南棟：x [−17, 17]、z [6, 13]
  {
    tag: 'range',
    x: 0, z: SOUTH_Z, w: M(34.0), d: M(7.0), y0: 0, y1: RANGE_TOP,
  },
  {
    tag: 'rangeRoof', part: PART_ROOF,
    x: 0, z: M(9.65), w: M(34.6), d: M(7.3), y0: RANGE_TOP, y1: RANGE_ROOF,
  },
  // 東西兩棟：z [−8, 6]，**兩端剛好接上**北棟與南棟 —— 留縫的話方庭會從
  // 角落漏出去，圍合就白做了。
  ...([-13.5, 13.5] as const).map((x): CivicVolume => ({
    tag: 'range',
    x: M(x), z: M(-1.0), w: M(7.0), d: M(14.0), y0: 0, y1: RANGE_TOP,
  })),
  ...([-13.65, 13.65] as const).map((x): CivicVolume => ({
    // 只往外出簷。往內伸的話屋簷會蓋住方庭的一角。
    tag: 'rangeRoof', part: PART_ROOF,
    x: M(x), z: M(-1.0), w: M(7.3), d: M(14.0), y0: RANGE_TOP, y1: RANGE_ROOF,
  })),

  // ── 圓頂 ──────────────────────────────────────────────────
  {
    tag: 'domeDrum', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: NORTH_Z, w: M(DOME_DIA), d: M(DOME_DIA),
    y0: DRUM_BASE, y1: DRUM_TOP,
  },
  {
    tag: 'dome', part: PART_ROOF, shape: 'dome',
    x: 0, z: NORTH_Z, w: M(DOME_DIA), d: M(DOME_DIA),
    y0: DRUM_TOP, y1: M(DOME_TOP_M),
  },
  {
    // 頂尖的燈籠。夜裡圓頂只剩它還看得見。
    tag: 'finial', part: PART_LAMP, shape: 'cylinder',
    x: 0, z: NORTH_Z, w: M(1.2), d: M(1.2),
    y0: M(DOME_TOP_M), y1: M(DOME_TOP_M + 1.1),
  },

  // ── 屋頂設備 ──────────────────────────────────────────────
  ...([-11, 11] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: NORTH_Z, w: M(2.0), d: M(1.4), y0: RANGE_N_ROOF, y1: M(15.3),
  })),
];

/**
 * 地面。
 *
 * 方庭是四塊草地 + 一個十字步道 —— 底層貼片彼此不得重疊，所以步道不能整條
 * 疊在草地上，只能把草地切成四塊。東西向的步道因此也是兩段（中間那一格
 * 歸南北向那一條）。
 */
const PATH_HALF = 1.5;
const QUAD = { x: 10.0, z0: -8.0, z1: 6.0 };

const decals: CivicDecal[] = [
  // 南北向步道，穿過中心。
  {
    x: 0, z: M((QUAD.z0 + QUAD.z1) / 2),
    w: M(PATH_HALF * 2), d: M(QUAD.z1 - QUAD.z0), shade: 0.62,
  },
  // 前庭：南棟之外，z [13, 18]
  { x: 0, z: M(15.5), w: M(36.0), d: M(5.0), shade: 0.6 },
];

// 東西向步道的兩段。
for (const side of [-1, 1]) {
  const inner = PATH_HALF;
  const outer = QUAD.x;
  decals.push({
    x: M(side * (inner + outer) / 2), z: 0,
    w: M(outer - inner), d: M(PATH_HALF * 2), shade: 0.62,
  });
}

// 四塊草地。
for (const sx of [-1, 1]) {
  for (const [za, zb] of [[QUAD.z0, -PATH_HALF], [PATH_HALF, QUAD.z1]] as const) {
    decals.push({
      x: M(sx * (PATH_HALF + QUAD.x) / 2), z: M((za + zb) / 2),
      w: M(QUAD.x - PATH_HALF), d: M(zb - za), shade: 0.0, lawn: true,
    });
  }
}

// 前庭的停車格分隔線。
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(4.0 + i * 2.8), z: M(15.6), w: M(0.15), d: M(4.6),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * 方庭中央的水池 —— 這一棟最便宜的「這裡是大學」訊號。
 *
 * `geometry/props` 沒有水池，所以它是自訂量體。
 */
const props: CivicVolume[] = [
  {
    tag: 'fountain', part: PART_DETAIL, shape: 'cylinder',
    x: 0, z: 0, w: M(3.0), d: M(3.0), y0: 0, y1: M(0.6),
  },
  {
    tag: 'fountain', part: PART_DETAIL, shape: 'cylinder',
    x: 0, z: 0, w: M(0.7), d: M(0.7), y0: M(0.6), y1: M(1.7),
  },
];

const overhead: CivicVolume[] = [
  // 大門的門廊。鐘塔正下方 —— 從前庭看過去，門廊、鐘面、尖頂在同一條軸線上。
  {
    tag: 'portico',
    x: 0, z: M(13.7), w: M(9.0), d: M(2.6), y0: M(4.4), y1: M(4.9),
  },
];

const fixtures: PropSpec[] = [
  // ── 方庭的四棵大樹，一塊草地一棵。 ──
  ...([-1, 1] as const).flatMap(sx => ([-5.2, 3.2] as const).map(z => ({
    kind: 'tree' as const,
    x: M(sx * 6.0), z: M(z), heightM: 8.0, crownRadius: M(1.8),
  }))),
  // 步道兩側的矮籬，把草地與路分開。
  ...([-1, 1] as const).map(sx => ({
    kind: 'hedge' as const,
    x: M(sx * 2.4), z: M(-1.0), axis: 'x' as const,
    length: M(13.0), depth: M(0.5), heightM: 0.8,
  })),
  { kind: 'shrub', x: M(-3.0), z: M(4.6), radius: M(0.7) },
  { kind: 'shrub', x: M(3.0), z: M(4.6), radius: M(0.7) },
  { kind: 'topiary', x: M(-3.0), z: M(-6.6), radius: M(0.7) },
  { kind: 'topiary', x: M(3.0), z: M(-6.6), radius: M(0.7) },
  { kind: 'flowerBed', x: M(-2.6), z: M(2.2), radius: M(0.7) },
  { kind: 'flowerBed', x: M(2.6), z: M(2.2), radius: M(0.7) },

  // ── 街道家具 ──
  // 方庭的燈沿著步道排 —— 大學的夜景就是那一條發亮的軸線。
  { kind: 'lamp', x: M(-2.2), z: M(-6.0), heightM: 4.0 },
  { kind: 'lamp', x: M(2.2), z: M(-6.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-2.2), z: M(4.0), heightM: 4.0 },
  { kind: 'lamp', x: M(2.2), z: M(4.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-14.0), z: M(15.0), heightM: 4.5 },
  { kind: 'lamp', x: M(17.0), z: M(15.0), heightM: 4.5 },

  { kind: 'flagpole', x: M(-6.0), z: M(14.0), axis: 'z' },
  { kind: 'signPost', x: M(6.0), z: M(14.0), axis: 'z' },
  { kind: 'bin', x: M(-2.2), z: M(13.8), radius: M(0.26) },
  // 大學的單車架要多。
  ...([-11.0, -10.2, -9.4] as const).map(x => ({
    kind: 'bikeRack' as const, x: M(x), z: M(14.4), axis: 'x' as const,
  })),
  ...([-16.0, -12.0, 12.0, 16.0] as const).map(x => ({
    kind: 'bollard' as const, x: M(x), z: M(13.6), radius: M(0.11),
  })),
];

const vehicles: CivicVehicle[] = [
  // 校車沿著前庭的路邊停 —— 與兩所學校同一個理由。
  { kind: 'bus', x: M(-6.0), z: M(16.4) },
  { kind: 'car', x: M(5.4), z: M(15.6), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(8.2), z: M(15.6), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(11.0), z: M(15.6), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`。
 *
 * `.x` = 0.42 給出 0.2536 格 = 3.04 m 的樓高 —— 老校舍的層高比中小學大。
 * 14 m 的北棟在 4.11 m 的門廳之上還有 3.2 層的窗格。
 */
const SEED = [0.42, 0.29, 0.81] as const;

export const universityPlan: CivicPlan = {
  footprint: { w: 3, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school_univ'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
