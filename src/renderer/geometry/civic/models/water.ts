import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 水廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**三座圓形沉澱池**、一支立式儲水塔、抽水機房。圓槽是最強的
 * 那一個 —— 電廠是煙囪、汙水廠是方池，只有這裡是一排圓的。
 *
 * 沉澱池走 `PART_GROUND` + `shade`：它們是**水面**，不是牆。標成牆的話
 * `FACADE_UTILITY` 會在水面上畫一條高窗帶。
 */

const TANK_TOP = M(4.6);
const HOUSE_TOP = M(7.0);
const HOUSE_ROOF = M(7.4);
const TOWER_TOP = M(15.0);

/** 池水的明度。深色 —— 池壁（`PART_DETAIL`）才有東西可以對比。 */
const WATER_SHADE = 0.1;

/** 三座池的圓心。品字形，不是排成一列 —— 一列讀起來是三個一樣的東西。 */
const TANKS = [[-6.4, -6.4], [2.0, -6.4], [-6.4, 1.6]] as const;

const massing: CivicVolume[] = [
  ...TANKS.flatMap(([x, z]): CivicVolume[] => [
    {
      // 池壁。金屬灰的環 —— 它與水面的明度差就是「這是一個池子」。
      tag: 'tankWall', part: PART_DETAIL, shape: 'cylinder',
      x: M(x), z: M(z), w: M(7.4), d: M(7.4), y0: 0, y1: TANK_TOP,
    },
    {
      tag: 'tankWater', part: PART_GROUND, shade: WATER_SHADE, shape: 'cylinder',
      x: M(x), z: M(z), w: M(6.6), d: M(6.6), y0: TANK_TOP, y1: M(4.72),
    },
  ]),

  // ── 抽水機房。x [4, 11]、z [−1, 8] ──────────────────────────
  {
    tag: 'pumpHouse',
    x: M(7.5), z: M(3.5), w: M(7.0), d: M(9.0), y0: 0, y1: HOUSE_TOP,
  },
  {
    tag: 'pumpRoof', part: PART_ROOF,
    x: M(7.5), z: M(3.5), w: M(7.6), d: M(9.6), y0: HOUSE_TOP, y1: HOUSE_ROOF,
  },

  // ── 立式儲水塔。廠區裡唯一有高度的東西。 ────────────────────
  // 站在三座池與機房之間僅存的那塊空地上（x ∈ [−2.7, 4]、z > 5.3）——
  // 塔的圓與池的圓不得互相插入，那會是看不見的內部面。
  {
    tag: 'tower', shape: 'cylinder',
    x: M(1.0), z: M(8.0), w: M(4.6), d: M(4.6), y0: 0, y1: TOWER_TOP,
  },
  {
    tag: 'towerCap', part: PART_ROOF, shape: 'cylinder',
    x: M(1.0), z: M(8.0), w: M(5.0), d: M(5.0), y0: TOWER_TOP, y1: M(15.6),
  },
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(1.0), z: M(8.0), w: M(0.8), d: M(0.8), y0: M(15.6), y1: M(16.2),
  },
];

const decals: CivicDecal[] = [
  // 廠區混凝土。池與塔都站在它上面。
  { x: M(-4.0), z: M(-1.0), w: M(16.0), d: M(22.0), shade: 0.55 },
  // 機房那一側的柏油車道。
  { x: M(7.5), z: M(-1.0), w: M(7.0), d: M(22.0), shade: 0.0 },
];

for (let i = 0; i < 4; i++) {
  decals.push({
    x: M(7.5), z: M(-8.0 + i * 2.8), w: M(6.0), d: M(0.15),
    shade: 1.0, layer: 'mark',
  });
}

/** 池與池之間的管線走道。`geometry/props` 的 `pipeRack` 太矮，這是架高的。 */
const props: CivicVolume[] = [
  {
    tag: 'walkway', part: PART_DETAIL,
    x: M(-2.2), z: M(-6.4), w: M(1.0), d: M(0.5), y0: M(4.4), y1: M(4.7),
  },
  {
    tag: 'walkway', part: PART_DETAIL,
    x: M(-6.4), z: M(-2.4), w: M(0.5), d: M(1.0), y0: M(4.4), y1: M(4.7),
  },
];

const overhead: CivicVolume[] = [
  {
    tag: 'canopy',
    x: M(3.8), z: M(3.5), w: M(1.6), d: M(4.0), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  { kind: 'pipeRack', x: M(-2.0), z: M(1.6), axis: 'z', span: M(5.0) },
  { kind: 'pipeRack', x: M(2.2), z: M(-2.0), axis: 'x', span: M(5.0) },
  { kind: 'drum', x: M(2.6), z: M(9.4), radius: M(0.4) },
  { kind: 'drum', x: M(3.6), z: M(9.4), radius: M(0.4) },
  { kind: 'gasBottles', x: M(-6.0), z: M(9.6), axis: 'z', radius: M(0.24) },

  { kind: 'lamp', x: M(-10.6), z: M(-2.0), heightM: 5.5 },
  { kind: 'lamp', x: M(-10.6), z: M(8.0), heightM: 5.5 },
  { kind: 'lamp', x: M(3.4), z: M(-10.4), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.4), axis: 'z', length: M(9.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-10.4), z: M(10.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(0.4), z: M(10.4), heightM: 5.4, crownRadius: M(0.9) },
  { kind: 'shrub', x: M(-2.8), z: M(10.6), radius: M(0.8) },

  { kind: 'signPost', x: M(4.2), z: M(10.6), axis: 'z' },
  { kind: 'hydrant', x: M(10.8), z: M(-6.0) },
  { kind: 'bollard', x: M(5.0), z: M(9.4), radius: M(0.12) },
  { kind: 'bollard', x: M(10.0), z: M(9.4), radius: M(0.12) },
];

const vehicles: CivicVehicle[] = [
  { kind: 'van', x: M(7.5), z: M(-6.6), rotationY: Math.PI / 2 },
  { kind: 'truck', x: M(7.5), z: M(-1.0), rotationY: Math.PI / 2 },
];

const SEED = [0.55, 0.72, 0.3] as const;

export const waterPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('water'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
