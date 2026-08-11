import {
  FACADE_CIVIC, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 醫院 —— 2×3 格 = 24 × 36 m。
 *
 * 可用範圍 ±11.76 m（x）、±17.76 m（z）。所有尺寸用 `M(公尺)` 宣告。
 *
 * 辨識特徵：主樓 + 兩側翼 + 連廊、**頂樓直升機坪**、急診雨棚與紅色急診帶。
 * 直升機坪是最強的那一個 —— 城市裡沒有第二種建築的屋頂上有它。
 *
 * ```
 *   z-  ┌──────────────────────┐
 *       │  主樓（八層，頂樓停機坪） │
 *       └──────────┬───────────┘
 *                 │連廊│
 *       ┌─────────┘  └─────────┐
 *       │  側翼（門診）│（急診）   │  ← 急診那一支有紅帶與發光十字
 *       └────▔▔──────┴──▔▔▔───┘
 *          大門雨棚      急診雨棚
 *       ┌──────────────┬───────┐
 *   z+  │  員工停車     │  草地  │
 * ```
 */

const MAIN_TOP = M(24.0);
const MAIN_ROOF = M(24.5);
/** 停機坪甲板面。H 標線與周邊燈再疊在它之上。 */
const PAD_DECK = M(24.62);
const WING_TOP = M(11.0);
const WING_ROOF = M(11.4);

/**
 * 屋頂平台的明度。
 *
 * 使用者：「醫院白色系」。牆本來就是醫療白（0xe8e8e8），問題出在**屋頂**：
 * `PART_ROOF` 的顏色來自各分區共用的屋頂色盤，而公家建築那一組是深瀝青
 * （0.26–0.38）—— 等角視角下看到的屋頂面積比牆大，於是整棟讀起來是深灰的。
 *
 * 醫院的屋頂是淺色隔熱層，所以這裡走 `PART_GROUND` + 高明度：那是這套
 * shader 裡唯一「這一面的顏色由這一棟自己決定」的水平面分支，而頂樓的
 * 停機坪甲板本來就是這樣畫的。
 */
const ROOF_SHADE = 0.95;

/** 停機坪甲板的明度。深色柏油 —— H 才有東西可以對比。 */
const PAD_SHADE = 0.18;
/** H 標線的明度。與甲板的差距是它看不看得見的全部。 */
const MARK_SHADE = 1.0;

/** 急診那一側。+1 = 右（x 正向）。側翼、紅帶、十字、救護車全部吃它。 */
const ER = 1;
/** 急診的紅。與消防紅刻意不同 —— 兩者並排時要分得出來。 */
const ER_RED = [0.85, 0.16, 0.20] as const;

/** 側翼前緣。急診帶、十字、雨棚都以它為基準往外疊。 */
const WING_FRONT = M(4.5);

const massing: CivicVolume[] = [
  // ── 主樓。x [−11, 11]、z [−17, −6.5] ────────────────────────
  {
    tag: 'main',
    x: 0, z: M(-11.75), w: M(22.0), d: M(10.5), y0: 0, y1: MAIN_TOP,
  },
  {
    tag: 'mainRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: 0, z: M(-11.75), w: M(22.6), d: M(11.1), y0: MAIN_TOP, y1: MAIN_ROOF,
  },

  // ── 頂樓直升機坪 ──────────────────────────────────────────
  // 甲板走 `PART_GROUND` + `shade`，與地面的柏油同一個 shader 分支 ——
  // 各走一套的話，屋頂上的混凝土與地上的混凝土會是兩個顏色。
  {
    tag: 'helipad', part: PART_GROUND, shade: PAD_SHADE,
    x: 0, z: M(-11.75), w: M(12.0), d: M(10.0), y0: MAIN_ROOF, y1: PAD_DECK,
  },
  // H 的三劃：兩豎一橫，彼此共邊。
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: M(-2.0), z: M(-11.75), w: M(0.7), d: M(5.0), y0: PAD_DECK, y1: M(24.68),
  },
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: M(2.0), z: M(-11.75), w: M(0.7), d: M(5.0), y0: PAD_DECK, y1: M(24.68),
  },
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: 0, z: M(-11.75), w: M(3.3), d: M(0.9), y0: PAD_DECK, y1: M(24.68),
  },
  // 周邊燈六盞，沿邊排 —— 排在中間的話直升機會停在燈上。
  ...([
    [-5.4, -15.75], [5.4, -15.75], [-5.4, -7.75], [5.4, -7.75],
    [0, -16.4], [0, -7.1],
  ] as const).map(([x, z]): CivicVolume => ({
    tag: 'padLight', part: PART_LAMP,
    x: M(x), z: M(z), w: M(0.4), d: M(0.4), y0: PAD_DECK, y1: M(24.9),
  })),

  // ── 連廊。z [−6.5, −3]，兩頭**剛好**接上主樓與側翼 ──────────
  // 差幾公分的話畫面上是一條浮在半空、兩頭都沒接的走廊，而它在資料表裡
  // 完全合法（沒有越界、沒有重疊、沒有超支）。
  {
    tag: 'corridor',
    x: 0, z: M(-4.75), w: M(4.0), d: M(3.5), y0: 0, y1: M(5.0),
  },
  {
    tag: 'corridorRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: 0, z: M(-4.75), w: M(4.4), d: M(3.5), y0: M(5.0), y1: M(5.3),
  },

  // ── 兩側翼。x [−11, −1] 與 [1, 11]、z [−3, 4.5] ─────────────
  ...([-6, 6] as const).map((x): CivicVolume => ({
    tag: 'wing',
    x: M(x), z: M(0.75), w: M(10.0), d: M(7.5), y0: 0, y1: WING_TOP,
  })),
  ...([-6, 6] as const).map((x): CivicVolume => ({
    tag: 'wingRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: M(x), z: M(0.75), w: M(10.6), d: M(8.1), y0: WING_TOP, y1: WING_ROOF,
  })),

  // ── 急診的紅色帶 ──────────────────────────────────────────
  // 醫療白的箱子上找不到急診入口。這道帶就是「往這裡走」，而它是**牆**
  // —— 只有牆的分支會讀 `aBldgColor`，屋頂與金屬細節都不讀。
  {
    tag: 'erBand', color: ER_RED,
    x: M(6 * ER), z: WING_FRONT + M(0.175), w: M(10.0), d: M(0.35),
    y0: M(8.6), y1: M(10.6),
  },
  // 發光的十字：一橫兩短豎，共邊不重疊（重疊的話是看不見的內部面）。
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(1.7), d: M(0.25),
    y0: M(9.4), y1: M(9.8),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(0.5), d: M(0.25),
    y0: M(9.8), y1: M(10.3),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(0.5), d: M(0.25),
    y0: M(8.9), y1: M(9.4),
  },

  // ── 側翼屋頂的機組 ────────────────────────────────────────
  ...([-8, -4, 4, 8] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: 0, w: M(2.0), d: M(1.5), y0: WING_ROOF, y1: M(12.2),
  })),
];

/**
 * 地面。四塊不重疊的底層：急診前庭、大門前庭、員工停車、草地。
 *
 * 急診與大門分開鋪（明度不同）——「救護車走哪裡、人走哪裡」在等角視角下
 * 只剩鋪面顏色可以講。
 */
const decals: CivicDecal[] = [
  // 急診前庭：x [1, 12]、z [4.5, 12]
  { x: M(6.5), z: M(8.25), w: M(11.0), d: M(7.5), shade: 0.5 },
  // 大門前庭：x [−12, 1]、z [4.5, 12]
  { x: M(-5.5), z: M(8.25), w: M(13.0), d: M(7.5), shade: 0.62 },
  // 員工停車：x [−12, 4]、z [12, 18]
  { x: M(-4.0), z: M(15.0), w: M(16.0), d: M(6.0), shade: 0.0 },
  // 草地：x [4, 12]、z [12, 18]
  { x: M(8.0), z: M(15.0), w: M(8.0), d: M(6.0), shade: 0.0, lawn: true },
];

// 救護車位的兩條邊線。
for (const side of [-1, 1]) {
  decals.push({
    x: M(6.5) + side * M(2.6), z: M(8.25), w: M(0.15), d: M(7.5),
    shade: 1.0, layer: 'mark',
  });
}
// 員工停車格分隔線。間距 2.8 m、深度 5 m —— 真實的停車格尺寸。
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-11.0 + i * 2.8), z: M(14.5), w: M(0.15), d: M(5.0),
    shade: 1.0, layer: 'mark',
  });
}

/** 急診雨棚下的兩盞燈。共用圖元的 `lamp` 是落地的燈桿，這是掛在雨棚下的。 */
const props: CivicVolume[] = ([-2.6, 2.6] as const).map((dx): CivicVolume => ({
  tag: 'bayLamp', part: PART_LAMP,
  x: M(6 * ER + dx), z: M(6.6), w: M(0.4), d: M(0.4), y0: M(3.9), y1: M(4.2),
}));

const overhead: CivicVolume[] = [
  // 急診雨棚。救護車 3.7 × 1.5 × 1.6 m —— 遮不住一台車的話它只是裝飾。
  {
    tag: 'erCanopy',
    x: M(6 * ER), z: M(6.4), w: M(8.0), d: M(3.8), y0: M(4.2), y1: M(4.6),
  },
  // 門診大門的雨棚。比急診的小 —— 那是走路進來的入口。
  {
    tag: 'canopy',
    x: M(-6.0), z: M(6.0), w: M(6.0), d: M(3.0), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // ── 綠化。醫院的庭院是它的一部分，不是裝飾。 ──
  { kind: 'tree', x: M(6.4), z: M(14.0), heightM: 6.5, crownRadius: M(1.5) },
  { kind: 'tree', x: M(10.0), z: M(13.2), heightM: 5.4, crownRadius: M(1.2) },
  { kind: 'tree', x: M(8.4), z: M(16.4), heightM: 6.0, crownRadius: M(1.3) },
  // 兩翼之間的中庭（x ∈ [−1, 1]、z ∈ [−3, 4.5]）—— 從連廊看出去的那一塊。
  { kind: 'tree', x: 0, z: M(2.4), heightM: 5.0, crownRadius: M(0.9) },
  // 大門前庭兩側的行道樹。
  { kind: 'tree', x: M(-11.0), z: M(6.4), heightM: 5.2, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(10.4), heightM: 5.2, crownRadius: M(0.7) },

  { kind: 'shrub', x: M(4.6), z: M(12.8), radius: M(0.7) },
  { kind: 'shrub', x: M(4.6), z: M(15.0), radius: M(0.7) },
  { kind: 'shrub', x: M(4.6), z: M(17.0), radius: M(0.7) },
  { kind: 'shrub', x: 0, z: M(-1.0), radius: M(0.8) },

  // 大門兩側的花圃。
  { kind: 'flowerBed', x: M(-9.4), z: M(5.4), radius: M(0.7) },
  { kind: 'flowerBed', x: M(-2.6), z: M(5.4), radius: M(0.7) },
  { kind: 'topiary', x: M(-6.0), z: M(11.0), radius: M(0.8) },

  // ── 街道家具 ──
  { kind: 'lamp', x: M(-1.4), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(-9.6), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(11.0), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(-8.0), z: M(16.6), heightM: 4.5 },
  { kind: 'lamp', x: M(1.6), z: M(16.6), heightM: 4.5 },

  { kind: 'flagpole', x: M(-11.2), z: M(6.4), axis: 'z' },
  { kind: 'signPost', x: M(1.2), z: M(6.2), axis: 'z' },
  { kind: 'hydrant', x: M(11.4), z: M(5.2) },
  { kind: 'bin', x: M(-3.6), z: M(6.0), radius: M(0.28) },
  { kind: 'bikeRack', x: M(-8.0), z: M(6.4), axis: 'z' },
  { kind: 'mailbox', x: M(-1.2), z: M(5.6) },
  ...([-9.6, -6.0, -2.4] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(11.6), radius: M(0.11),
  })),
];

/**
 * 救護車停在急診那一側，公務車停在員工停車場。
 *
 * 救護車停到大門那一側去的話，那道紅帶與發光十字就白做了 —— 玩家會照著
 * 車找急診，而不是照著顏色。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'ambulance', x: M(6 * ER - 2.1), z: M(7.4), rotationY: Math.PI / 2 },
  { kind: 'ambulance', x: M(6 * ER + 2.1), z: M(7.4), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(-9.6), z: M(15.0), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(-6.8), z: M(15.0), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(-4.0), z: M(15.0), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`。
 *
 * `.x` = 0.34 給出 0.2472 格 = 2.97 m 的樓高 —— 醫院的層高比住宅大。
 * 24 m 的主樓在 4.0 m 的門廳之上還有 6.7 層的窗格。
 */
const SEED = [0.34, 0.12, 0.72] as const;

export const hospitalPlan: CivicPlan = {
  footprint: { w: 2, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('hospital'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
