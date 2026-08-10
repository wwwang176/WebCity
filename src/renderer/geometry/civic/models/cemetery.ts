import {
  FACADE_GREEN, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 墓園 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**成排對齊的墓碑**、小禮拜堂與它頂上的發光十字、入口門柱。
 * 墓碑是最強的那一個 —— 一片整齊的矮方塊陣列在城市裡沒有第二個。
 *
 * 對齊是重點。散落的矮方塊讀起來是「地上有一堆東西」；排成格線才是墓園，
 * 所以行列座標是算出來的，不是一顆一顆手寫的。
 *
 * ```
 *   z-  ┌────────────────────────┐
 *       │      禮拜堂（十字）        │
 *       ├────────┬──┬────────────┤
 *       │ 墓碑列  │步│  墓碑列      │
 *       │ ▪ ▪ ▪  │道│  ▪ ▪ ▪      │
 *       │ ▪ ▪ ▪  │  │  ▪ ▪ ▪      │
 *   z+  └────────┴╥╨┴────────────┘
 *                 門柱
 * ```
 */

const CHAPEL_TOP = M(5.4);
const CHAPEL_RIDGE = M(7.6);
const BELFRY_TOP = M(9.2);
/** 步道半寬。墓碑不得踏進來。 */
const PATH_HALF = 2.0;

/** 墓碑的行列。算出來的，不是手寫的 —— 手寫的三十顆一定會有一顆沒對齊。 */
const STONE_COLS = [-9.4, -6.6, -3.8, 3.8, 6.6, 9.4];
const STONE_ROWS = [-3.4, -0.6, 2.2, 5.0, 7.8];

const massing: CivicVolume[] = [
  // ── 禮拜堂。x [−4, 4]、z [−11.5, −5.5] ──────────────────────
  {
    tag: 'chapel',
    x: 0, z: M(-8.5), w: M(8.0), d: M(6.0), y0: 0, y1: CHAPEL_TOP,
  },
  {
    // 只往前出簷。往後多 0.3 m 的話屋簷會伸出基地 0.04 m —— 小到看不出來，
    // 大到會壓進鄰格。
    tag: 'chapelRoof', part: PART_ROOF, shape: 'gable',
    x: 0, z: M(-8.35), w: M(8.6), d: M(6.6), y0: CHAPEL_TOP, y1: CHAPEL_RIDGE,
  },
  {
    tag: 'belfry', shape: 'cylinder',
    x: 0, z: M(-8.5), w: M(1.8), d: M(1.8), y0: CHAPEL_RIDGE, y1: BELFRY_TOP,
  },

  // ── 十字。三段共邊不重疊 —— 一豎一橫直接疊的話中間是看不見的內部面。 ──
  // 全部走 `PART_LAMP`：夜裡整座墓園只剩這個十字，那正是它該有的樣子。
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(-8.5), w: M(0.26), d: M(0.26), y0: BELFRY_TOP, y1: M(9.7),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(-8.5), w: M(1.3), d: M(0.26), y0: M(9.7), y1: M(10.0),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(-8.5), w: M(0.26), d: M(0.26), y0: M(10.0), y1: M(10.5),
  },

  // ── 入口門柱。兩根柱，過樑在 `overhead`。 ────────────────────
  ...([-3.2, 3.2] as const).map((x): CivicVolume => ({
    tag: 'gatePier',
    x: M(x), z: M(10.6), w: M(1.0), d: M(1.0), y0: 0, y1: M(3.2),
  })),
];

/**
 * 地面。中央步道從門口一路通到禮拜堂 —— 走不到禮拜堂的墓園是一片草皮。
 */
const decals: CivicDecal[] = [
  // 中央步道：x [−2, 2]、z [−5.5, 12]
  { x: 0, z: M(3.25), w: M(PATH_HALF * 2), d: M(17.5), shade: 0.62 },
  // 禮拜堂前的鋪面：z [−12, −5.5]
  { x: 0, z: M(-8.75), w: M(24.0), d: M(6.5), shade: 0.55 },
];

// 兩塊墓區草地。
for (const side of [-1, 1]) {
  decals.push({
    x: M(side * (PATH_HALF + 12.0) / 2), z: M(3.25),
    w: M(12.0 - PATH_HALF), d: M(17.5), shade: 0.0, lawn: true,
  });
}

/**
 * 墓碑 —— 這一棟唯一真正需要自訂量體的東西。
 *
 * 放在 `props`：遠景整層關掉，而三十顆 0.9 m 的方塊在遠景本來就看不見。
 */
const props: CivicVolume[] = STONE_COLS.flatMap(x => STONE_ROWS.map((z): CivicVolume => ({
  tag: 'headstone', part: PART_DETAIL,
  x: M(x), z: M(z), w: M(0.7), d: M(0.25), y0: 0, y1: M(0.9),
})));

const overhead: CivicVolume[] = [
  // 門柱之間的過樑。行人淨空 2.2 m 之上。
  {
    tag: 'gateLintel',
    x: 0, z: M(10.6), w: M(7.4), d: M(0.8), y0: M(3.2), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // ── 邊界的樹。墓園的樹是圍出「這裡是另一個地方」的那道界線。 ──
  ...([-1, 1] as const).flatMap(sx => ([-2.0, 3.4, 8.8] as const).map(z => ({
    kind: 'tree' as const,
    x: M(sx * 11.0), z: M(z), heightM: 7.5, crownRadius: M(0.7),
  }))),
  { kind: 'tree', x: M(-6.0), z: M(11.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'tree', x: M(6.0), z: M(11.0), heightM: 6.0, crownRadius: M(0.7) },

  // 步道兩側的矮籬。
  ...([-1, 1] as const).map(sx => ({
    kind: 'hedge' as const,
    x: M(sx * 2.4), z: M(3.0), axis: 'x' as const,
    length: M(16.0), depth: M(0.5), heightM: 0.8,
  })),
  { kind: 'topiary', x: M(-2.6), z: M(-4.6), radius: M(0.8) },
  { kind: 'topiary', x: M(2.6), z: M(-4.6), radius: M(0.8) },
  { kind: 'flowerBed', x: M(-1.2), z: M(-5.0), radius: M(0.6) },
  { kind: 'flowerBed', x: M(1.2), z: M(-5.0), radius: M(0.6) },
  { kind: 'shrub', x: M(-5.4), z: M(-6.0), radius: M(0.8) },
  { kind: 'shrub', x: M(5.4), z: M(-6.0), radius: M(0.8) },

  // ── 街道家具。少而暗 —— 墓園不需要熱鬧。 ──
  { kind: 'lamp', x: M(-2.6), z: M(9.0), heightM: 3.6 },
  { kind: 'lamp', x: M(2.6), z: M(9.0), heightM: 3.6 },
  { kind: 'lamp', x: M(-2.6), z: M(-3.0), heightM: 3.6 },
  { kind: 'lamp', x: M(2.6), z: M(-3.0), heightM: 3.6 },
  { kind: 'flagpole', x: M(-10.0), z: M(-7.4), axis: 'z' },
  { kind: 'signPost', x: M(4.6), z: M(11.2), axis: 'z' },
  { kind: 'bin', x: M(-4.6), z: M(11.2), radius: M(0.26) },
  ...([-8.0, 8.0] as const).map(x => ({
    kind: 'bollard' as const, x: M(x), z: M(11.4), radius: M(0.11),
  })),
];

/** 靈車與家屬的車停在禮拜堂前。 */
const vehicles: CivicVehicle[] = [
  { kind: 'van', x: M(-8.0), z: M(-8.6) },
  { kind: 'car', x: M(8.0), z: M(-8.6) },
];

/**
 * `aSeed`。
 *
 * `FACADE_GREEN` 的牆沒有窗格，所以 `.x`（樓層節奏）在這一棟身上沒有作用
 * —— 禮拜堂靠的是山牆屋頂與十字，不是窗戶。
 */
const SEED = [0.5, 0.21, 0.38] as const;

export const cemeteryPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_GREEN,
  color: civicColorOf('cemetery'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
