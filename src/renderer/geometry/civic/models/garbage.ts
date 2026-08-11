import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 垃圾場 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**兩座土丘**、傾卸棚、地磅，以及停在場裡的垃圾車。土丘是最強的
 * 那一個 —— 城市裡沒有第二種建築身上有斜的、沒有屋頂的量體。
 *
 * 土丘走 `PART_GROUND` + `shade`：它們是**覆土**，不是牆。標成牆的話立面會
 * 在土堆上畫一條高窗帶。
 */

const SHED_TOP = M(10.0);
const SHED_ROOF = M(11.6);
/** 覆土的明度。偏暗的土色 —— 與旁邊的混凝土鋪面分得開。 */
const EARTH_SHADE = 0.32;

const massing: CivicVolume[] = [
  // ── 傾卸棚。x [−11, 2]、z [−11, −1] ────────────────────────
  {
    tag: 'shed',
    x: M(-4.5), z: M(-6.0), w: M(13.0), d: M(10.0), y0: 0, y1: SHED_TOP,
  },
  {
    // 單斜屋頂。垃圾車從高的那一頭開進去。
    tag: 'shedRoof', part: PART_ROOF, shape: 'shed', facing: 0,
    x: M(-4.5), z: M(-6.0), w: M(13.6), d: M(10.6), y0: SHED_TOP, y1: SHED_ROOF,
  },

  // ── 兩座土丘。`hip` 是四坡收頂 —— 用在沒有屋頂的量體上它就是一座丘。 ──
  // 一大一小：等大的話它們讀起來是兩個一樣的方塊。
  {
    tag: 'mound', part: PART_GROUND, shade: EARTH_SHADE, shape: 'hip',
    x: M(6.6), z: M(-6.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(6.4),
  },
  {
    tag: 'mound', part: PART_GROUND, shade: EARTH_SHADE, shape: 'hip',
    x: M(6.6), z: M(3.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(4.4),
  },

  // ── 地磅房。小、貼著入口。 ──────────────────────────────────
  {
    tag: 'weighHut',
    x: M(-9.0), z: M(6.0), w: M(3.0), d: M(3.0), y0: 0, y1: M(3.2),
  },
  {
    tag: 'weighHutRoof', part: PART_ROOF,
    x: M(-9.0), z: M(6.0), w: M(3.4), d: M(3.4), y0: M(3.2), y1: M(3.5),
  },
  {
    // 地磅的號誌燈。夜裡整場只剩它與高桿燈。
    tag: 'beacon', part: PART_LAMP,
    x: M(-9.0), z: M(6.0), w: M(0.5), d: M(0.5), y0: M(3.5), y1: M(3.9),
  },
];

const decals: CivicDecal[] = [
  // 傾卸棚下的混凝土。
  { x: M(-5.5), z: M(-6.5), w: M(13.0), d: M(11.0), shade: 0.55 },
  // 場區柏油：z [−1, 12]
  { x: 0, z: M(5.5), w: M(24.0), d: M(13.0), shade: 0.0 },
  // 土丘那一側的碎石。
  { x: M(6.5), z: M(-6.5), w: M(11.0), d: M(11.0), shade: 0.28 },
];

// 地磅的秤台標線。
decals.push({ x: M(-5.4), z: M(6.0), w: M(4.0), d: M(3.6), shade: 0.9, layer: 'mark' });

const props: CivicVolume[] = [
  // 地磅的秤台。金屬板，微微高出地面。
  {
    tag: 'weighbridge', part: PART_DETAIL,
    x: M(-5.4), z: M(6.0), w: M(4.0), d: M(3.6), y0: 0, y1: M(0.22),
  },
  // 兩個大型料斗。
  ...([-9.0, -5.4] as const).map((x): CivicVolume => ({
    tag: 'hopper', part: PART_DETAIL,
    x: M(x), z: M(10.0), w: M(3.0), d: M(2.4), y0: 0, y1: M(2.4),
  })),
];

const overhead: CivicVolume[] = [
  // 地磅的雨庇 —— 司機要在那裡搖下車窗。
  {
    tag: 'canopy',
    x: M(-7.2), z: M(6.0), w: M(2.2), d: M(4.4), y0: M(4.0), y1: M(4.4),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: M(-4.0), axis: 'x', length: M(14.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  { kind: 'drum', x: M(-1.4), z: M(9.8), radius: M(0.42) },
  { kind: 'drum', x: M(-0.4), z: M(9.8), radius: M(0.42) },
  { kind: 'drum', x: M(-0.9), z: M(10.8), radius: M(0.42) },
  { kind: 'palletStack', x: M(2.0), z: M(10.2), axis: 'z', depth: M(1.0) },
  { kind: 'palletStack', x: M(3.6), z: M(10.2), axis: 'z', depth: M(1.0) },
  // 傾卸棚之外（棚的前緣在 z = −1）。原本跨在 z = −2.4，也就是在棚子裡。
  { kind: 'pipeRack', x: M(1.4), z: M(-0.2), axis: 'z', span: M(3.4) },

  { kind: 'lamp', x: M(-10.8), z: M(1.0), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(1.0), heightM: 6.0 },
  { kind: 'lamp', x: M(10.8), z: M(9.6), heightM: 6.0 },

  // 對外的綠帶。垃圾場最需要遮蔽 —— 也最需要顯示有人在管理它。
  { kind: 'hedge', x: M(4.0), z: M(11.4), axis: 'z', length: M(12.0), depth: M(0.6), heightM: 1.4 },
  { kind: 'tree', x: M(-6.4), z: M(-10.4), heightM: 6.5, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-2.0), z: M(-10.4), heightM: 6.5, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(9.0), z: M(10.6), radius: M(0.8) },

  // 與兩根擋車柱同一條線（x = −3.2）—— 原本站在 −2.4，也就是站在垃圾車
  // 停放通道裡。
  { kind: 'signPost', x: M(-3.2), z: M(3.0), axis: 'z' },
  { kind: 'hydrant', x: M(-10.8), z: M(9.8) },
  { kind: 'bollard', x: M(-3.2), z: M(4.0), radius: M(0.12) },
  { kind: 'bollard', x: M(-3.2), z: M(8.0), radius: M(0.12) },
];

/**
 * 停在場裡的垃圾車。這一棟最直接的辨識訊號 —— 而且它們本來就停在這裡。
 *
 * 使用者：「垃圾掩埋場的綠色車輛擠到垃圾堆了」。原本兩台橫著停在 x = 1.4，
 * 而車身沿 x 有 6.7 m —— 右半截整個埋進第二座土丘（x ≥ 2.1）裡。
 *
 * 現在**縱著**停（`rotationY = π/2`），排在傾卸棚與土丘之間那條 5 m 寬的
 * 通道上：那是場裡唯一容得下 6.7 m 車身的方向。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'garbageTruck', x: M(-1.6), z: M(4.2), rotationY: Math.PI / 2 },
  { kind: 'garbageTruck', x: M(0.6), z: M(4.2), rotationY: Math.PI / 2 },
  { kind: 'truck', x: M(-6.0), z: M(1.4) },
];

const SEED = [0.7, 0.36, 0.62] as const;

export const garbagePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('garbage'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
