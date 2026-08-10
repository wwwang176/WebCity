import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP, PART_FOLIAGE,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * 警局 —— 2×2 格 = 24 × 24 m。
 *
 * 座標單位是格，原點是佔地中心，可用範圍 ±0.98 格（±11.76 m，扣掉
 * `CIVIC_INSET`）。所有尺寸用 `M(公尺)` 宣告 —— 直接寫格值的話，
 * 「這道牆多寬」要心算 ×12，而心算過的數字沒有人會回頭檢查。
 *
 * 配置：建築壓在基地後半（z 為負的那一側），前半留給前庭與停車場。
 * 這是真實警局的樣子 —— 巡邏車要能直接開進開出，所以停車場面向道路。
 *
 * ```
 *   z-  ┌──────────────┬─────┐   長翼（值勤大廳、辦公）
 *       │    長翼      │短翼 │   短翼上面疊瞭望塔
 *       └──────┬───────┴─────┘
 *          ▔▔雨棚▔▔         前庭（混凝土）
 *       ┌──────────────┬─────┐
 *       │   停車場     │草地 │
 *   z+  └──────────────┴─────┘
 * ```
 */

/** 翼樓高度。三層樓加上挑高的門廳 —— 見下面 `SEED` 的說明。 */
const WING_TOP = M(11.0);
/** 屋頂板厚。 */
const ROOF_TOP = M(11.4);

const massing: CivicVolume[] = [
  // ── L 形主體 ──────────────────────────────────────────────
  // 長翼：x [−9, 5]、z [−9.5, −2.5]
  {
    tag: 'wing',
    x: M(-2.0), z: M(-6.0), w: M(14.0), d: M(7.0), y0: 0, y1: WING_TOP,
  },
  {
    tag: 'wingRoof', part: PART_ROOF,
    x: M(-2.0), z: M(-6.0), w: M(14.6), d: M(7.6), y0: WING_TOP, y1: ROOF_TOP,
  },
  // 短翼：x [5, 11]、z [−9.5, −0.5]。與長翼**共邊不重疊** —— 重疊會產生
  // 看不見的內部面，白吃三角形而且畫面上完全看不出來。
  {
    tag: 'wing',
    x: M(8.0), z: M(-5.0), w: M(6.0), d: M(9.0), y0: 0, y1: WING_TOP,
  },
  {
    // 短翼屋頂往右挪，讓兩片屋頂也只共邊：長翼屋頂的右緣在 5.3。
    tag: 'wingRoof', part: PART_ROOF,
    x: M(8.3), z: M(-5.0), w: M(6.0), d: M(9.6), y0: WING_TOP, y1: ROOF_TOP,
  },

  // ── 瞭望塔 ────────────────────────────────────────────────
  // 疊在短翼的屋頂上而不是站在旁邊：站旁邊的話它要自己佔一塊地，而 24 m
  // 的基地已經被 L 形吃滿了。
  {
    tag: 'tower',
    x: M(8.0), z: M(-5.0), w: M(4.0), d: M(4.0), y0: ROOF_TOP, y1: M(17.0),
  },
  {
    // 塔冠比塔身寬一圈才看得出是「冠」。
    tag: 'cap', part: PART_ROOF,
    x: M(8.0), z: M(-5.0), w: M(4.6), d: M(4.6), y0: M(17.0), y1: M(17.5),
  },

  // ── 屋頂設備 ──────────────────────────────────────────────
  // PART_DETAIL：冷的金屬，不畫窗、夜裡不亮。標成 PART_WALL 的話，屋頂上
  // 的冷氣機會長出一格一格的窗。
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-5.5), z: M(-6.0), w: M(2.0), d: M(1.5), y0: ROOF_TOP, y1: M(12.2),
  },
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(0.5), z: M(-6.0), w: M(2.0), d: M(1.5), y0: ROOF_TOP, y1: M(12.2),
  },
];

/**
 * 地面。三塊**不重疊**的鋪面 —— 前庭、停車場、草地，共邊即可。
 *
 * 重疊的底層貼片會 z-fighting：靜止時看不出來，一移動鏡頭就整片閃爍。
 * `assembleDecals` 會擋，但配置本身就該是分區的。
 */
const decals: CivicDecal[] = [
  // 前庭：建築正前方，z [−0.2, 3.5]
  { x: 0, z: M(1.65), w: M(23.0), d: M(3.7), shade: 0.58 },
  // 停車場柏油：x [−11.5, 5]、z [3.5, 11.5]
  { x: M(-3.25), z: M(7.5), w: M(16.5), d: M(8.0), shade: 0.0 },
  // 草地：x [5, 11.5]、z [3.5, 11.5]
  { x: M(8.25), z: M(7.5), w: M(6.5), d: M(8.0), shade: 0.0, lawn: true },

  // 入口踏板。標線層，疊在前庭上。
  { x: M(-2.0), z: M(0.8), w: M(6.0), d: M(2.0), shade: 0.75, layer: 'mark' },
];

/**
 * 停車格分隔線。
 *
 * 畫**分隔線**而不是把整格塗白：一格一塊白色矩形不是停車格，是白色地磚。
 *
 * 間距 2.8 m、深度 5.0 m 是真實的停車格尺寸。TODO.md 記著工業區的「停車格」
 * 在尺度上不成立（1.6 × 1.67 m，那個深度現實中畫的是卸貨區分隔線），
 * 這裡不要重演。
 */
for (let i = 0; i < 6; i++) {
  decals.push({
    x: M(-11.0 + i * 2.8), z: M(6.5), w: M(0.15), d: M(5.0),
    shade: 1.0, layer: 'mark',
  });
}

/** 一支路燈：燈桿（不發光）加燈頭（發光）。 */
function streetLamp(xm: number, zm: number): CivicVolume[] {
  return [
    // 整支標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
    {
      tag: 'post', part: PART_DETAIL,
      x: M(xm), z: M(zm), w: M(0.25), d: M(0.25), y0: 0, y1: M(4.5),
    },
    {
      tag: 'lampHead', part: PART_LAMP,
      x: M(xm), z: M(zm), w: M(0.7), d: M(0.5), y0: M(4.5), y1: M(5.0),
    },
  ];
}

/**
 * 一棵樹：樹幹（深色細節）加樹冠（樹葉分支的綠）。
 *
 * `PART_FOLIAGE` 走 shader 的樹葉分支 —— 它自己有綠色與位置雜訊，不吃
 * `aBldgColor`，所以一棵樹不會變成靛藍色的。
 */
function tree(xm: number, zm: number, hm = 6.0): CivicVolume[] {
  const crown = hm * 0.45;
  return [
    {
      tag: 'trunk', part: PART_DETAIL,
      x: M(xm), z: M(zm), w: M(0.45), d: M(0.45), y0: 0, y1: M(hm - crown),
    },
    {
      tag: 'crown', part: PART_FOLIAGE, shape: 'hip',
      x: M(xm), z: M(zm), w: M(3.4), d: M(3.4), y0: M(hm - crown), y1: M(hm),
    },
  ];
}

/** 一叢矮灌木。比樹便宜得多，用來填草地與鋪面之間的邊界。 */
const shrub = (xm: number, zm: number): CivicVolume => ({
  tag: 'shrub', part: PART_FOLIAGE, shape: 'hip',
  x: M(xm), z: M(zm), w: M(1.6), d: M(1.6), y0: 0, y1: M(1.1),
});

const props: CivicVolume[] = [
  // 停車場的路燈。只照門口的話，夜裡整片停車場是黑的 —— 而它佔了基地一半。
  ...streetLamp(-7.0, 5.0),
  ...streetLamp(1.0, 5.0),
  ...streetLamp(-7.0, 10.5),

  // 門廊燈：掛在雨棚兩端下方。
  {
    tag: 'porchLamp', part: PART_LAMP,
    x: M(-5.6), z: M(-1.5), w: M(0.4), d: M(0.4), y0: M(3.4), y1: M(3.75),
  },
  {
    tag: 'porchLamp', part: PART_LAMP,
    x: M(1.6), z: M(-1.5), w: M(0.4), d: M(0.4), y0: M(3.4), y1: M(3.75),
  },

  // 旗桿。公家建築門口的旗桿是它最便宜的辨識訊號。
  {
    tag: 'flagpole', part: PART_DETAIL,
    x: M(-10.0), z: M(-0.5), w: M(0.2), d: M(0.2), y0: 0, y1: M(8.0),
  },

  // 停在格子裡的兩台巡邏車。PART_DETAIL —— 標成 PART_WALL 的話車身會長出窗格。
  {
    tag: 'car', part: PART_DETAIL,
    x: M(-9.6), z: M(6.5), w: M(1.9), d: M(4.6), y0: 0, y1: M(1.5),
  },
  {
    tag: 'car', part: PART_DETAIL,
    x: M(-4.0), z: M(6.5), w: M(1.9), d: M(4.6), y0: 0, y1: M(1.5),
  },

  // ── 綠化 ──────────────────────────────────────────────────
  // 公共建築在一座城市裡也就幾十棟，所以單棟多花的三角形幾乎量不到 ——
  // 同樣的想法在住宅區會直接打爆預算（那裡是幾千棟）。這是兩者取捨不同
  // 的地方，見 `CIVIC_TRIANGLE_BUDGET` 的註解。
  //
  // 樹種在草地那一側，不種在停車場上 —— 車位上長一棵樹是最容易被看出來的
  // 那種錯。
  ...tree(7.0, 5.5, 6.5),
  ...tree(9.6, 8.5, 5.5),
  ...tree(7.0, 9.8, 6.0),
  // 前庭兩側的行道樹。它們框住入口，讓門廊看起來是「主入口」而不是側門。
  // ±9.8 而不是 ±10.5：樹冠有 3.4 m 寬，10.5 的話它的外緣在 12.2 m，
  // 而可用範圍只到 11.76 m（護欄會擋下來）。
  ...tree(-9.8, 1.6, 5.0),
  ...tree(9.8, 1.6, 5.0),

  // 草地與停車場交界的灌木叢，擋住兩塊鋪面的硬邊。
  shrub(5.8, 4.4),
  shrub(5.8, 7.2),
  shrub(5.8, 10.0),

  // 入口兩側的花台。矮、貼著牆，是「有人在維護」的訊號。
  {
    tag: 'planter', part: PART_FOLIAGE, shape: 'hip',
    x: M(-6.6), z: M(-0.4), w: M(1.4), d: M(1.4), y0: 0, y1: M(0.8),
  },
  {
    tag: 'planter', part: PART_FOLIAGE, shape: 'hip',
    x: M(2.6), z: M(-0.4), w: M(1.4), d: M(1.4), y0: 0, y1: M(0.8),
  },

  // 前庭的兩張長椅。
  {
    tag: 'bench', part: PART_DETAIL,
    x: M(-8.6), z: M(2.4), w: M(1.8), d: M(0.6), y0: M(0.35), y1: M(0.5),
  },
  {
    tag: 'bench', part: PART_DETAIL,
    x: M(4.6), z: M(2.4), w: M(1.8), d: M(0.6), y0: M(0.35), y1: M(0.5),
  },
];

const overhead: CivicVolume[] = [
  // 門廊雨棚。y0 要高過 2.2 m 的行人淨空，否則它會打到人。
  // z [−2.6, −0.4]：往建築裡插 0.1 m，看起來才是「接上去的」而不是浮著的。
  {
    tag: 'canopy',
    x: M(-2.0), z: M(-1.5), w: M(8.0), d: M(2.2), y0: M(3.75), y1: M(4.1),
  },
];

/**
 * `aSeed`。
 *
 * `.x` 是樓層節奏，shader 端是 `mix(0.22, 0.30, aSeed.x)` —— 0.25 給出
 * 0.24 格 = 2.88 m 的樓高。CIVIC 立面的門廳高度是 `floorHeight * 1.35`
 * = 3.89 m，所以 11 m 的翼樓在門廳之上還有 2.5 層的窗格。
 *
 * 翼樓再矮一點的話，整棟就只剩門廳、一扇窗都看不到 —— 這是兩個數字之間的
 * 真實耦合，不是巧合，所以測試釘住了它。
 *
 * `.y` 是窗戶相位、`.z` 是材質微調。固定值 —— 公共建築不做變體，三間警局
 * 必須長得一樣。
 */
const SEED = [0.25, 0.37, 0.6] as const;

export const policePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  // 靛藍。實體在 `colors.ts` —— 這裡寫死一個數字的話，改了顏色表而警局
  // 沒跟著改，只表現為「警局的顏色怪怪的」。
  color: civicColorOf('police'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
};
