import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 汙水廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**四座並排的方形曝氣池**、一座圓形沉澱池、控制樓。方池是最強的
 * 那一個 —— 水廠是一排圓的，這裡是一排方的，兩者在等角視角下立刻分得開。
 *
 * 池子走 `PART_GROUND` + `shade`：它們是**水面**，不是牆。
 */

const BASIN_TOP = M(2.4);
const CTRL_TOP = M(6.6);
const CTRL_ROOF = M(7.0);

/** 池水的明度。比水廠更暗 —— 這裡的水本來就是髒的。 */
const WATER_SHADE = 0.06;
/** 池壁厚度（公尺）。水面比池壁內縮這麼多，才看得出「有一圈邊」。 */
const RIM = 0.5;

/** 四座曝氣池的中心。並排，等距 —— 那個節奏就是它的辨識訊號。 */
const BASINS = [-8.4, -3.0, 2.4, 7.8];
const BASIN_W = 4.8;
const BASIN_D = 10.0;
const BASIN_Z = -5.6;

const massing: CivicVolume[] = [
  ...BASINS.flatMap((x): CivicVolume[] => [
    {
      tag: 'basinWall', part: PART_DETAIL,
      x: M(x), z: M(BASIN_Z), w: M(BASIN_W), d: M(BASIN_D), y0: 0, y1: BASIN_TOP,
    },
    {
      tag: 'basinWater', part: PART_GROUND, shade: WATER_SHADE,
      x: M(x), z: M(BASIN_Z),
      w: M(BASIN_W - RIM * 2), d: M(BASIN_D - RIM * 2),
      y0: BASIN_TOP, y1: M(2.52),
    },
  ]),

  // ── 圓形沉澱池。一排方的裡面放一個圓的，讀得出「這裡是另一段製程」。 ──
  {
    tag: 'clarifierWall', part: PART_DETAIL, shape: 'cylinder',
    x: M(-6.0), z: M(5.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(2.8),
  },
  {
    tag: 'clarifierWater', part: PART_GROUND, shade: WATER_SHADE, shape: 'cylinder',
    x: M(-6.0), z: M(5.4), w: M(8.0), d: M(8.0), y0: M(2.8), y1: M(2.92),
  },

  // ── 控制樓。x [2, 11]、z [1.5, 9.5] ────────────────────────
  {
    tag: 'control',
    x: M(6.5), z: M(5.5), w: M(9.0), d: M(8.0), y0: 0, y1: CTRL_TOP,
  },
  {
    tag: 'controlRoof', part: PART_ROOF,
    x: M(6.5), z: M(5.5), w: M(9.6), d: M(8.6), y0: CTRL_TOP, y1: CTRL_ROOF,
  },
  {
    tag: 'beacon', part: PART_LAMP,
    x: M(6.5), z: M(5.5), w: M(0.6), d: M(0.6), y0: CTRL_ROOF, y1: M(7.5),
  },
];

const decals: CivicDecal[] = [
  // 池區的混凝土。
  { x: 0, z: M(-6.0), w: M(24.0), d: M(12.0), shade: 0.55 },
  // 前場柏油。
  { x: 0, z: M(6.0), w: M(24.0), d: M(12.0), shade: 0.0 },
];

// 池與池之間的走道標線。
for (const x of [-5.7, -0.3, 5.1]) {
  decals.push({
    x: M(x), z: M(BASIN_Z), w: M(0.4), d: M(BASIN_D),
    shade: 0.85, layer: 'mark',
  });
}

/** 池上的走道橋。汙水廠的剪影少了它就只是幾個水坑。 */
const props: CivicVolume[] = [
  {
    tag: 'walkway', part: PART_DETAIL,
    x: 0, z: M(-1.4), w: M(21.0), d: M(0.8), y0: M(2.6), y1: M(2.9),
  },
  ...BASINS.map((x): CivicVolume => ({
    tag: 'walkwayPost', part: PART_DETAIL,
    x: M(x), z: M(-1.4), w: M(0.3), d: M(0.3), y0: 0, y1: M(2.6),
  })),
];

const overhead: CivicVolume[] = [
  {
    tag: 'canopy',
    x: M(6.5), z: M(1.0), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  { kind: 'pipeRack', x: M(-11.0), z: M(-5.6), axis: 'x', span: M(8.0) },
  { kind: 'pipeRack', x: M(0.6), z: M(9.6), axis: 'z', span: M(4.0) },
  { kind: 'gasBottles', x: M(1.4), z: M(2.4), axis: 'x', radius: M(0.24) },
  { kind: 'drum', x: M(-11.0), z: M(1.0), radius: M(0.42) },
  { kind: 'drum', x: M(-10.0), z: M(1.0), radius: M(0.42) },

  { kind: 'lamp', x: M(-10.8), z: M(-10.2), heightM: 5.5 },
  { kind: 'lamp', x: M(10.8), z: M(-10.2), heightM: 5.5 },
  { kind: 'lamp', x: M(-2.0), z: M(10.6), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.4), axis: 'z', length: M(9.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-11.0), z: M(9.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(4.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'shrub', x: M(-0.6), z: M(-0.2), radius: M(0.8) },

  { kind: 'signPost', x: M(2.2), z: M(10.6), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(-0.4) },
  { kind: 'bollard', x: M(4.0), z: M(10.8), radius: M(0.12) },
  { kind: 'bollard', x: M(9.0), z: M(10.8), radius: M(0.12) },
];

const vehicles: CivicVehicle[] = [
  { kind: 'van', x: M(-3.0), z: M(8.0) },
  { kind: 'truck', x: M(-3.0), z: M(10.4) },
];

const SEED = [0.48, 0.9, 0.52] as const;

export const sewagePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('sewage'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
