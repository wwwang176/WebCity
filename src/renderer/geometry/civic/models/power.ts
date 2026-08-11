import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 電廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**兩支高煙囪**（頂上有紅色航警燈）、鋸齒屋頂的汽機廠房、
 * 變電場。煙囪是最強的那一個 —— 它是這座城市最高的東西之一，遠景只剩它。
 *
 * 四座公用設施共用 `FACADE_UTILITY`（鍍鋅浪板色票 + 高窗帶），所以它們讀起來
 * 是同一家族。彼此的差別在**剪影**：煙囪／圓槽／土丘／方池。
 */

const HALL_TOP = M(12.0);
const HALL_ROOF = M(13.6);
/** 高煙囪。航警燈疊在它上面。 */
const STACK_TOP = M(25.0);
const STACK2_TOP = M(20.0);

const massing: CivicVolume[] = [
  // ── 汽機廠房。x [−11, 1]、z [−11, 1] ────────────────────────
  {
    tag: 'hall',
    x: M(-5.0), z: M(-5.0), w: M(12.0), d: M(12.0), y0: 0, y1: HALL_TOP,
  },
  {
    // 鋸齒屋頂 —— 廠房最好認的頂。平頂的話它與倉庫分不出來。
    tag: 'hallRoof', part: PART_ROOF, shape: 'sawtooth', facing: 0,
    x: M(-5.0), z: M(-5.0), w: M(12.6), d: M(12.6), y0: HALL_TOP, y1: HALL_ROOF,
  },

  // ── 兩支煙囪，一高一矮。等高的話它們讀起來是一對柱子。 ──────
  {
    tag: 'stack', shape: 'cylinder',
    x: M(6.5), z: M(-7.6), w: M(3.4), d: M(3.4), y0: 0, y1: STACK_TOP,
  },
  {
    tag: 'stack', shape: 'cylinder',
    x: M(6.5), z: M(-2.6), w: M(2.8), d: M(2.8), y0: 0, y1: STACK2_TOP,
  },
  // 航警燈。夜裡的電廠就是天上那兩顆紅點 —— 而它們本來就該在那裡。
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(6.5), z: M(-7.6), w: M(1.0), d: M(1.0), y0: STACK_TOP, y1: M(25.6),
  },
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(6.5), z: M(-2.6), w: M(0.9), d: M(0.9), y0: STACK2_TOP, y1: M(20.6),
  },
];

const decals: CivicDecal[] = [
  // 廠區柏油。整片，z [1, 12] 與 x [1, 12] 的 L 形拆成兩塊不重疊的。
  { x: 0, z: M(6.5), w: M(24.0), d: M(11.0), shade: 0.0 },
  { x: M(6.5), z: M(-5.5), w: M(11.0), d: M(13.0), shade: 0.12 },
  // 廠房底下的混凝土。
  { x: M(-5.5), z: M(-5.5), w: M(13.0), d: M(13.0), shade: 0.55 },
];

// 出入口的斑馬線與車道邊線。
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-9.0 + i * 2.2), z: M(10.6), w: M(0.5), d: M(2.0),
    shade: 1.0, layer: 'mark',
  });
}

/** 變電場的三台變壓器。`geometry/props` 沒有這種東西。 */
const props: CivicVolume[] = ([2.0, 5.4, 8.8] as const).map((z): CivicVolume => ({
  tag: 'transformer', part: PART_DETAIL,
  x: M(8.4), z: M(z), w: M(2.6), d: M(2.2), y0: 0, y1: M(2.4),
}));

const overhead: CivicVolume[] = [
  // 廠房側門的雨庇。
  {
    tag: 'canopy',
    x: M(-5.0), z: M(1.8), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // 廠區圍籬 —— 三面。第四面（z 正向）是大門，留空。
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  // 工業雜項。這些是「這裡有製程」的訊號。
  { kind: 'pipeRack', x: M(2.6), z: M(-6.0), axis: 'x', span: M(6.0) },
  { kind: 'pipeRack', x: M(4.4), z: M(3.0), axis: 'z', span: M(5.0) },
  { kind: 'drum', x: M(-9.6), z: M(3.2), radius: M(0.42) },
  { kind: 'drum', x: M(-8.6), z: M(3.2), radius: M(0.42) },
  { kind: 'drum', x: M(-9.1), z: M(4.2), radius: M(0.42) },
  { kind: 'gasBottles', x: M(-6.0), z: M(3.4), axis: 'z', radius: M(0.24) },
  { kind: 'palletStack', x: M(-2.4), z: M(3.6), axis: 'z', depth: M(1.0) },

  // 廠區的高桿燈。夜裡沒有它，整片柏油是一塊黑。
  { kind: 'lamp', x: M(-10.4), z: M(7.0), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(7.0), heightM: 6.0 },
  { kind: 'lamp', x: M(10.4), z: M(9.4), heightM: 6.0 },

  // 沿著街廓那一側的綠籬與樹 —— 廠區對外總得有一點遮蔽。
  { kind: 'hedge', x: 0, z: M(11.4), axis: 'z', length: M(9.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-6.4), z: M(10.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(6.4), z: M(10.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(-3.0), z: M(10.6), radius: M(0.8) },
  { kind: 'shrub', x: M(3.0), z: M(10.6), radius: M(0.8) },

  { kind: 'signPost', x: M(-9.4), z: M(9.0), axis: 'z' },
  { kind: 'hydrant', x: M(1.6), z: M(2.0) },
  { kind: 'bollard', x: M(-1.2), z: M(9.0), radius: M(0.12) },
  { kind: 'bollard', x: M(1.2), z: M(9.0), radius: M(0.12) },
];

const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.0), z: M(6.0) },
  // x = 4.4：原本停在 1.0，正好壓在大門那兩根擋車柱（x = ±1.2）上。
  { kind: 'van', x: M(4.4), z: M(8.4) },
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
