import {
  FACADE_GREEN, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * 墓園 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**成排對齊的墓碑**、一座紀念碑與它頂上的發光十字、入口門柱。
 * 墓碑是最強的那一個 —— 一片整齊的矮方塊陣列在城市裡沒有第二個。
 *
 * **這一棟沒有建築。** 使用者：「墓園的造型，我認為可以在簡單一點，不一定
 * 要有建築?」對 —— 原本那座禮拜堂（8 × 6 m、山牆屋頂、鐘塔）在 24 m 的
 * 基地上吃掉整個北端，而它對辨識度的貢獻是零：城市裡讀出「這是墓園」靠的
 * 是墓碑陣列，那座小房子只是又一個帶山牆的方塊。拆掉它換成一座 5.5 m 的
 * 紀念碑，十字還在原來的高度，而墓園終於看起來像一片地而不是一塊建地。
 *
 * 對齊是重點。散落的矮方塊讀起來是「地上有一堆東西」；排成格線才是墓園，
 * 所以行列座標是算出來的，不是一顆一顆手寫的。
 *
 * ```
 *   z-  ┌────────────────────────┐
 *       │        紀念碑（十字）      │
 *       ├────────┬──┬────────────┤
 *       │ 墓碑列  │步│  墓碑列      │
 *       │ ▪ ▪ ▪  │道│  ▪ ▪ ▪      │
 *       │ ▪ ▪ ▪  │  │  ▪ ▪ ▪      │
 *   z+  └────────┴╥╨┴────────────┘
 *                 門柱
 * ```
 */

/** 紀念碑的中心。步道的盡頭。 */
const MEMORIAL_Z = -8.5;
/** 石柱頂 —— 十字從這裡開始。 */
const SHAFT_TOP = M(4.2);
/** 步道半寬。墓碑不得踏進來。 */
const PATH_HALF = 2.0;

/** 墓碑的行列。算出來的，不是手寫的 —— 手寫的三十顆一定會有一顆沒對齊。 */
const STONE_COLS = [-9.4, -6.6, -3.8, 3.8, 6.6, 9.4];
const STONE_ROWS = [-3.4, -0.6, 2.2, 5.0, 7.8];

const massing: CivicVolume[] = [
  // ── 紀念碑。三階石台 + 石柱 + 十字。 ────────────────────────
  // 一階一階往上收 —— 直接一根柱子插在地上的話它讀起來是一根電線桿。
  {
    tag: 'plinth',
    x: 0, z: M(MEMORIAL_Z), w: M(3.2), d: M(3.2), y0: 0, y1: M(0.45),
  },
  {
    tag: 'plinth',
    x: 0, z: M(MEMORIAL_Z), w: M(2.2), d: M(2.2), y0: M(0.45), y1: M(0.9),
  },
  {
    tag: 'shaft',
    x: 0, z: M(MEMORIAL_Z), w: M(0.9), d: M(0.9), y0: M(0.9), y1: SHAFT_TOP,
  },

  // ── 十字。三段共邊不重疊 —— 一豎一橫直接疊的話中間是看不見的內部面。 ──
  // 全部走 `PART_LAMP`：夜裡整座墓園只剩這個十字，那正是它該有的樣子。
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(0.26), d: M(0.26), y0: SHAFT_TOP, y1: M(4.7),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(1.3), d: M(0.26), y0: M(4.7), y1: M(5.0),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(0.26), d: M(0.26), y0: M(5.0), y1: M(5.5),
  },

  // ── 入口門柱。兩根柱，過樑在 `overhead`。 ────────────────────
  ...([-3.2, 3.2] as const).map((x): CivicVolume => ({
    tag: 'gatePier',
    x: M(x), z: M(10.6), w: M(1.0), d: M(1.0), y0: 0, y1: M(3.2),
  })),
];

/**
 * 地面。中央步道從門口一路通到紀念碑 —— 走不到頭的步道是一條裝飾線。
 *
 * 鋪面只留兩塊：步道與碑前的小廣場。原本碑前那塊是**整整 24 m 寬**的鋪面
 * （那是為了襯托禮拜堂），拆掉建築之後它就只是一大片沒有理由的水泥。
 */
const decals: CivicDecal[] = [
  // 中央步道：x [−2, 2]、z [−5.5, 12]
  { x: 0, z: M(3.25), w: M(PATH_HALF * 2), d: M(17.5), shade: 0.62 },
  // 碑前廣場：x [−5, 5]、z [−12, −5.5]
  { x: 0, z: M(-8.75), w: M(10.0), d: M(6.5), shade: 0.55 },
];

// 兩塊墓區草地。
for (const side of [-1, 1]) {
  decals.push({
    x: M(side * (PATH_HALF + 12.0) / 2), z: M(3.25),
    w: M(12.0 - PATH_HALF), d: M(17.5), shade: 0.0, lawn: true,
  });
  // 廣場兩側的草地。少了它，那兩塊角落是裸地。
  decals.push({
    x: M(side * (5.0 + 12.0) / 2), z: M(-8.75),
    w: M(7.0), d: M(6.5), shade: 0.0, lawn: true,
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
  // 碑的兩側。原本這裡有一對修剪樹、一對花圃、一對灌木共六樣東西圍著
  // 禮拜堂 —— 碑比房子小得多，同樣的六樣會把它埋掉。
  { kind: 'flowerBed', x: M(-2.6), z: M(-8.5), radius: M(0.7) },
  { kind: 'flowerBed', x: M(2.6), z: M(-8.5), radius: M(0.7) },
  { kind: 'topiary', x: M(-4.0), z: M(-5.4), radius: M(0.7) },
  { kind: 'topiary', x: M(4.0), z: M(-5.4), radius: M(0.7) },

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

/**
 * **不停車。**
 *
 * 原本靈車與家屬的車停在禮拜堂前 —— 沒有禮拜堂就沒有那個門口，而碑前廣場
 * 只有 10 m 寬，兩台車會把它變成一個停車場。順帶修掉一個既有的錯：那台
 * 靈車本來就壓在旗桿上。
 */
const vehicles: CivicPlan['vehicles'] = [];

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
