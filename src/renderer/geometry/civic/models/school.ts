import { FACADE_CIVIC, PART_ROOF, PART_DETAIL } from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 小學 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**低矮**、兩排平行的教室翼、操場、遊具。低矮是最重要的一項 ——
 * 它是小學與高中、大學之間唯一在遠景就分得出來的差別，所以整棟壓在 9 m。
 *
 * ```
 *   z-  ┌────────────────────────┐
 *       │      教室翼（北）        │
 *       └──────┐  採光縫  ┌───────┘
 *              │  門廳   │
 *       ┌──────┘        └────────┐
 *       │      教室翼（南）        │
 *       └──────────▔▔────────────┘
 *          接送區（校車沿路邊停）
 *       ┌──────────────────┬─────┐
 *   z+  │      操場（草地）   │ 遊具 │
 * ```
 */

const WING_TOP = M(8.0);
const WING_ROOF = M(8.4);

/** 遊具區的鋪面中心與半徑（沙／橡膠墊）。遊具全部要站在它上面。 */
const PLAY = { x: M(9.0), z: M(9.25), w: M(6.0), d: M(5.5) };

const massing: CivicVolume[] = [
  // ── 兩排教室翼。x [−11, 11]，z 分別是 [−11.5, −6] 與 [−3, 2.5] ──────
  ...([-8.75, -0.25] as const).map((z): CivicVolume => ({
    tag: 'wing',
    x: 0, z: M(z), w: M(22.0), d: M(5.5), y0: 0, y1: WING_TOP,
  })),
  ...([-8.75, -0.25] as const).map((z): CivicVolume => ({
    tag: 'wingRoof', part: PART_ROOF,
    x: 0, z: M(z), w: M(22.6), d: M(5.9), y0: WING_TOP, y1: WING_ROOF,
  })),

  // ── 門廳。連兩排，但**不填滿**那道縫 ────────────────────────
  // 填滿了就是一棟深樓，而兩排平行的教室翼正是校舍讀得出來的原因。
  {
    tag: 'link',
    x: 0, z: M(-4.5), w: M(8.0), d: M(3.0), y0: 0, y1: M(5.0),
  },
  {
    tag: 'linkRoof', part: PART_ROOF,
    x: 0, z: M(-4.5), w: M(8.4), d: M(3.0), y0: M(5.0), y1: M(5.3),
  },

  // ── 屋頂設備 ──────────────────────────────────────────────
  ...([-7, 7] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: M(-8.75), w: M(1.8), d: M(1.2), y0: WING_ROOF, y1: M(9.0),
  })),
];

/**
 * 地面。基地上**最大的一塊必須是操場** —— 小學的地被停車場佔掉是一眼就
 * 看得出來的錯。
 */
const decals: CivicDecal[] = [
  // 接送區：z [2.5, 6.5]。校車沿著它停，所以要 4 m 深。
  { x: 0, z: M(4.5), w: M(24.0), d: M(4.0), shade: 0.6 },
  // 操場：x [−12, 6]、z [6.5, 12]
  { x: M(-3.0), z: M(9.25), w: M(18.0), d: M(5.5), shade: 0.0, lawn: true },
  // 遊具區：沙／橡膠墊
  { x: PLAY.x, z: PLAY.z, w: PLAY.w, d: PLAY.d, shade: 0.78 },
];

/**
 * 場地線。一片純綠的草地讀不出是操場 —— 線才是。
 *
 * 一個外框加一條中線：小學的球場就是這樣，不必畫到分毫不差。
 */
const COURT = { x0: -10.0, x1: 2.0, z0: 7.2, z1: 11.5 };
const courtMid = (COURT.z0 + COURT.z1) / 2;
for (const z of [COURT.z0, COURT.z1, courtMid]) {
  decals.push({
    x: M((COURT.x0 + COURT.x1) / 2), z: M(z),
    w: M(COURT.x1 - COURT.x0), d: M(0.15), shade: 1.0, layer: 'mark',
  });
}
for (const x of [COURT.x0, COURT.x1]) {
  decals.push({
    x: M(x), z: M(courtMid),
    w: M(0.15), d: M(COURT.z1 - COURT.z0), shade: 1.0, layer: 'mark',
  });
}

/**
 * 遊具 —— 這一棟唯一真正需要自訂量體的東西。
 *
 * `geometry/props` 沒有溜滑梯、攀爬架、鞦韆，而它們正是「這是小學」的訊號。
 * 全部壓在 2.6 m 以下：三公尺高的鞦韆不是遊具，是塔。
 */
const props: CivicVolume[] = [
  // 溜滑梯：一座平台加一道斜板。
  {
    tag: 'slide', part: PART_DETAIL,
    x: M(8.0), z: M(8.0), w: M(1.4), d: M(1.4), y0: 0, y1: M(1.8),
  },
  {
    tag: 'slide', part: PART_DETAIL, shape: 'shed', facing: 0,
    x: M(8.0), z: M(9.4), w: M(1.2), d: M(1.6), y0: 0, y1: M(1.7),
  },

  // 攀爬架：四根柱加兩條頂桿。實心的方塊讀起來是一個箱子，不是可以爬的架子。
  ...([[9.4, 7.6], [11.0, 7.6], [9.4, 9.4], [11.0, 9.4]] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'climber', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(0.16), d: M(0.16), y0: 0, y1: M(2.0),
    })),
  ...([7.6, 9.4] as const).map((z): CivicVolume => ({
    tag: 'climber', part: PART_DETAIL,
    x: M(10.2), z: M(z), w: M(1.76), d: M(0.14), y0: M(1.9), y1: M(2.04),
  })),

  // 鞦韆：兩根柱、一條橫樑、兩個座板。
  ...([7.4, 10.4] as const).map((x): CivicVolume => ({
    tag: 'swing', part: PART_DETAIL,
    x: M(x), z: M(11.2), w: M(0.18), d: M(0.18), y0: 0, y1: M(2.3),
  })),
  {
    tag: 'swing', part: PART_DETAIL,
    x: M(8.9), z: M(11.2), w: M(3.0), d: M(0.16), y0: M(2.2), y1: M(2.36),
  },
  ...([8.2, 9.6] as const).map((x): CivicVolume => ({
    tag: 'swing', part: PART_DETAIL,
    x: M(x), z: M(11.2), w: M(0.5), d: M(0.16), y0: M(0.5), y1: M(0.58),
  })),
];

const overhead: CivicVolume[] = [
  // 大門雨棚。往教室翼裡插 0.1 m，看起來才是「接上去的」而不是浮著的。
  {
    tag: 'canopy',
    x: 0, z: M(3.4), w: M(7.0), d: M(2.0), y0: M(3.0), y1: M(3.4),
  },
];

const fixtures: PropSpec[] = [
  // ── 綠化。操場邊的行道樹 —— 種在場地線裡面的話球就打到樹了。 ──
  { kind: 'tree', x: M(-10.6), z: M(7.4), heightM: 5.5, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-10.6), z: M(10.4), heightM: 6.0, crownRadius: M(1.1) },
  { kind: 'tree', x: M(-6.0), z: M(3.6), heightM: 5.0, crownRadius: M(0.9) },
  { kind: 'tree', x: M(6.0), z: M(3.6), heightM: 5.0, crownRadius: M(0.9) },

  { kind: 'shrub', x: M(-1.6), z: M(3.4), radius: M(0.7) },
  { kind: 'shrub', x: M(1.6), z: M(3.4), radius: M(0.7) },
  { kind: 'shrub', x: M(5.4), z: M(7.2), radius: M(0.6) },
  { kind: 'topiary', x: M(-4.0), z: M(3.4), radius: M(0.6) },

  // 大門兩側的花圃。小學的門口有人在照顧，那是這一棟的個性。
  { kind: 'flowerBed', x: M(-4.4), z: M(2.9), radius: M(0.6) },
  { kind: 'flowerBed', x: M(4.4), z: M(2.9), radius: M(0.6) },

  // ── 街道家具 ──
  { kind: 'lamp', x: M(-11.0), z: M(5.0), heightM: 4.0 },
  { kind: 'lamp', x: M(11.0), z: M(5.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-11.2), z: M(11.0), heightM: 4.0 },

  { kind: 'flagpole', x: M(-8.6), z: M(3.4), axis: 'z' },
  { kind: 'signPost', x: M(8.6), z: M(3.4), axis: 'z' },

  // 小學的單車架不能只有一組。
  { kind: 'bikeRack', x: M(-9.0), z: M(5.6), axis: 'z' },
  { kind: 'bikeRack', x: M(-9.0), z: M(6.2), axis: 'z' },
  { kind: 'bin', x: M(2.6), z: M(3.0), radius: M(0.26) },
  // 接送區與操場之間的擋車柱 —— 車不准開進操場。
  ...([-8.0, -4.0, 0, 4.0] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(6.4), radius: M(0.11),
  })),
];

/**
 * 校車沿著路邊停 —— **不轉向**。
 *
 * 校車 7.2 m 長。橫著停在 4 m 深的接送區的話，它有一半插在校舍裡（而
 * `assembleVehicles` 只擋佔地邊界，擋不了這個）。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'bus', x: M(-3.0), z: M(4.8) },
  { kind: 'van', x: M(5.4), z: M(4.8) },
];

/**
 * `aSeed`。
 *
 * `.x` = 0.18 給出 0.2344 格 = 2.81 m 的樓高 —— 小學的層高比醫院小。
 * 8 m 的教室翼在 3.79 m 的門廳之上還有 1.5 層的窗格：兩層樓的校舍。
 */
const SEED = [0.18, 0.83, 0.44] as const;

export const schoolPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
