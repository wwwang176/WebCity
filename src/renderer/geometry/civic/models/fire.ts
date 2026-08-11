import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 消防局 —— 2×2 格 = 24 × 24 m。
 *
 * 座標單位是格，原點是佔地中心，可用範圍 ±0.98 格（±11.76 m，扣掉
 * `CIVIC_INSET`）。所有尺寸用 `M(公尺)` 宣告。
 *
 * 三個辨識特徵，缺一個就會被誤認成別的公共建築：
 * **一整排捲門**、**落地的訓練塔**、**紅色主體**。
 *
 * 落地那件事是刻意的：警局的瞭望塔疊在翼樓屋頂上，兩座塔都架在屋頂上的話
 * 剪影就分不出來了。訓練塔本來也就該落地 —— 它要從一樓爬上去。
 *
 * ```
 *   z-  ┌────────────────┬────────┐
 *       │  機房（挑高）    │  宿舍   │
 *       └──┬──┬──┬────────┴────────┘
 *          捲門 ×3        ┌────┐
 *       ══════════════════│訓練│═══   前庭（混凝土）
 *        消防車停在門前     │ 塔 │
 *       ┌────────────────┴────┬───┐
 *       │      柏油停車        │草地│
 *   z+  └────────────────────┴───┘
 * ```
 */

/** 機房淨高。消防車 1.9 m 高，但車庫要放得下雲梯 —— 7.4 m 是真實的尺度。 */
const BAY_TOP = M(7.4);
const BAY_ROOF = M(7.8);
/** 宿舍樓比機房高，讓量體有高低差；兩者齊高的話整棟是一個方盒子。 */
const DORM_TOP = M(9.4);
const DORM_ROOF = M(9.8);
const TOWER_TOP = M(19.6);

/** 捲門面向的那一面 —— 機房前緣。門整片站在它之外，不埋進牆裡。 */
const BAY_FRONT = M(-2.0);
/** 三扇捲門的中心。間距 5.2 m，等距是「一排」的實體。 */
const DOOR_X = [M(-8.6), M(-3.4), M(1.8)];

const massing: CivicVolume[] = [
  // ── 機房 ──────────────────────────────────────────────────
  // x [−11, 4]、z [−11, −2]
  {
    tag: 'bay',
    x: M(-3.5), z: M(-6.5), w: M(15.0), d: M(9.0), y0: 0, y1: BAY_TOP,
  },
  {
    // 屋簷往左、前、後各外伸 0.5 m，**右側不伸** —— 右邊是宿舍樓的牆，
    // 伸過去就是埋進牆裡的內部面。
    tag: 'bayRoof', part: PART_ROOF,
    x: M(-3.75), z: M(-6.5), w: M(15.5), d: M(9.6), y0: BAY_TOP, y1: BAY_ROOF,
  },

  // ── 宿舍樓 ────────────────────────────────────────────────
  // x [4, 11.6]，與機房**共邊不重疊**。
  {
    tag: 'dorm',
    x: M(7.8), z: M(-6.5), w: M(7.6), d: M(9.0), y0: 0, y1: DORM_TOP,
  },
  {
    // 前緣**不出簷** —— 訓練塔就站在那條線外，伸出去就插進塔裡。
    tag: 'dormRoof', part: PART_ROOF,
    x: M(7.85), z: M(-6.65), w: M(7.7), d: M(9.3), y0: DORM_TOP, y1: DORM_ROOF,
  },

  // ── 訓練塔 ────────────────────────────────────────────────
  // 站在宿舍樓前緣（z = −2）之外的地面上。
  {
    tag: 'tower',
    x: M(8.0), z: M(-0.2), w: M(4.4), d: M(3.6), y0: 0, y1: TOWER_TOP,
  },
  {
    tag: 'towerCap', part: PART_ROOF,
    x: M(8.0), z: M(-0.2), w: M(5.0), d: M(4.2), y0: TOWER_TOP, y1: M(20.2),
  },

  // ── 捲門 ──────────────────────────────────────────────────
  // 放在量體層而不是矮物件層：它是這一棟最強的辨識訊號，遠景關掉就認不出來
  // 了。`PART_DETAIL` 讓它走金屬灰的分支 —— 標成 PART_WALL 的話，門上會長出
  // 一格一格的窗。
  ...DOOR_X.map((x): CivicVolume => ({
    tag: 'door', part: PART_DETAIL,
    x, z: BAY_FRONT + M(0.15), w: M(4.0), d: M(0.3), y0: 0, y1: M(4.6),
  })),

  // ── 屋頂設備 ──────────────────────────────────────────────
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-8.0), z: M(-8.5), w: M(2.0), d: M(1.5), y0: BAY_ROOF, y1: M(8.6),
  },
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-1.0), z: M(-8.5), w: M(2.0), d: M(1.5), y0: BAY_ROOF, y1: M(8.6),
  },
];

/**
 * 地面。
 *
 * **前庭一路鋪到基地邊界。** 第一版把員工停車場放在 z ∈ [6, 12]，也就是
 * 正對著捲門的位置 —— 消防車要出勤得先請人把車開走。測試（「出車道淨空」）
 * 抓到的是站在那裡的一支路燈，但真正的問題是配置：出車道從門一路到路邊都
 * 不能有東西，所以員工停車與綠地只能挪到側邊。
 *
 * 底層四塊不重疊：前庭、塔前小廣場、側邊柏油、草地。
 */
const decals: CivicDecal[] = [
  // 前庭：門前一路到路邊，x [−12, 4]、z [−2, 12]。
  { x: M(-4.0), z: M(5.0), w: M(16.0), d: M(14.0), shade: 0.6 },
  // 訓練塔前的小廣場，x [4, 12]、z [−2, 2]。
  { x: M(8.0), z: 0, w: M(8.0), d: M(4.0), shade: 0.6 },
  // 側邊的員工停車，x [4, 12]、z [2, 7]。
  { x: M(8.0), z: M(4.5), w: M(8.0), d: M(5.0), shade: 0.0 },
  // 草地，x [4, 12]、z [7, 12]。
  { x: M(8.0), z: M(9.5), w: M(8.0), d: M(5.0), shade: 0.0, lawn: true },
];

/**
 * 車道標線 —— 每扇門前兩條邊線，一路畫到路邊。
 *
 * 畫**邊線**而不是把整條車道塗白：塗白的話那不是車道，是白色地磚
 * （警局的停車格也是同一個道理）。
 */
for (const x of DOOR_X) {
  for (const side of [-1, 1]) {
    decals.push({
      x: x + side * M(2.1), z: M(5.0), w: M(0.15), d: M(14.0),
      shade: 1.0, layer: 'mark',
    });
  }
}
// 路緣線。標出「基地到這裡為止」，也讓三條車道在視覺上收在同一條線上。
decals.push({ x: M(-4.0), z: M(11.6), w: M(16.0), d: M(0.15), shade: 0.85, layer: 'mark' });

/**
 * 這一棟自己的方塊量體 —— 只放共用圖元裡沒有的東西。
 *
 * 捲門雖然也是自訂的，但它在 `massing`：遠景不關。
 */
const props: CivicVolume[] = DOOR_X.map((x): CivicVolume => ({
  // 門楣上的警示燈。夜裡它是消防局最好認的訊號 —— 一排等距的紅點。
  tag: 'beacon', part: PART_LAMP,
  x, z: BAY_FRONT + M(0.2), w: M(0.5), d: M(0.3), y0: M(4.8), y1: M(5.1),
}));

const overhead: CivicVolume[] = [
  // 隊員出入口的小雨棚。開在宿舍樓前緣左端 —— 右邊被訓練塔佔住了。
  {
    tag: 'canopy',
    x: M(4.9), z: M(-1.3), w: M(1.7), d: M(1.4), y0: M(2.9), y1: M(3.2),
  },
];

/**
 * 共用矮物件。**門前的車道一律淨空** —— 一棵種在捲門口的樹是所有人第一眼
 * 就會看到的笑話，而它在資料表裡完全合法（沒有越界、沒有超支）。
 *
 * 車道是 x ∈ 門寬、z ∈ [門前, 基地邊界]。可站人的 x 帶因此只剩門與門之間的
 * 縫、最左端，以及 x > 3.8（宿舍與訓練塔那一側）。
 */
const fixtures: PropSpec[] = [
  // ── 綠化。全部在側邊草地上（x > 4、z > 7）。 ──
  { kind: 'tree', x: M(6.0), z: M(8.6), heightM: 6.0, crownRadius: M(1.3) },
  { kind: 'tree', x: M(10.0), z: M(8.2), heightM: 5.2, crownRadius: M(1.2) },
  { kind: 'tree', x: M(7.6), z: M(10.6), heightM: 6.5, crownRadius: M(1.1) },

  // 草地與停車柏油交界的灌木，擋住兩塊鋪面的硬邊。
  { kind: 'shrub', x: M(4.8), z: M(7.0), radius: M(0.7) },
  { kind: 'shrub', x: M(7.2), z: M(7.0), radius: M(0.7) },
  { kind: 'shrub', x: M(9.6), z: M(7.0), radius: M(0.7) },

  // 隊員出入口與旗桿旁的花圃。
  { kind: 'flowerBed', x: M(4.8), z: M(0.4), radius: M(0.7) },
  { kind: 'flowerBed', x: M(11.0), z: M(0.4), radius: M(0.7) },

  // ── 街道家具 ──
  // 前庭的路燈只能站在門與門之間的縫裡（x ∈ [−6.6, −5.4] 與 [−1.4, −0.2]）
  // —— 那是出車道之外僅存的兩條帶。
  { kind: 'lamp', x: M(-6.0), z: M(4.4), heightM: 4.5 },
  { kind: 'lamp', x: M(-0.8), z: M(4.4), heightM: 4.5 },
  { kind: 'lamp', x: M(-6.0), z: M(9.6), heightM: 4.5 },
  // 職務停車格**之間**（x ∈ [6.7, 8.5] 是兩格中間的縫）。原本站在 6.0，
  // 也就是站在左邊那一格裡。
  { kind: 'lamp', x: M(7.6), z: M(4.5), heightM: 4.5 },

  { kind: 'flagpole', x: M(11.2), z: M(4.0), axis: 'z' },
  { kind: 'signPost', x: M(4.6), z: M(5.0), axis: 'z' },

  // 消防隊自己的門口沒有消防栓是最沒有說服力的一件事。兩支各站一邊，
  // 都在出車道之外。
  { kind: 'hydrant', x: M(-11.4), z: M(5.0) },
  { kind: 'hydrant', x: M(11.4), z: M(8.0) },

  { kind: 'bin', x: M(4.4), z: M(2.6), radius: M(0.28) },
  // 停車格之前（車格從 z = 3.8 起）—— 原本擺在 3.6，被職務車壓在下面。
  { kind: 'bikeRack', x: M(5.4), z: M(2.2), axis: 'z' },
  { kind: 'bollard', x: M(-11.4), z: M(1.0), radius: M(0.11) },
  { kind: 'bollard', x: M(4.2), z: M(6.6), radius: M(0.11) },
  { kind: 'bollard', x: M(11.4), z: M(1.0), radius: M(0.11) },
];

/**
 * 停在前庭上的消防車 —— 對著自己那扇門，車頭朝外（+z）。
 *
 * 停在車道**上**是刻意的：那是「車剛開出來」，正是想要的畫面。門前不准放的
 * 是樹與路燈那些長在地上的東西。
 */
const vehicles: CivicVehicle[] = [
  // z = 1.9：車尾要**整個**在捲門之外（門面在 z = −1.7）。原本停在 1.6，
  // 車尾插進門板 7 cm —— 畫面上那是一台卡在門裡的消防車。
  { kind: 'firetruck', x: DOOR_X[0]!, z: M(1.9), rotationY: Math.PI / 2 },
  { kind: 'firetruck', x: DOOR_X[1]!, z: M(1.9), rotationY: Math.PI / 2 },
  // 隊長的公務車與勤務廂型車停在**側邊**的員工停車格 —— 三台一模一樣的
  // 消防車看起來像複製貼上，而把它們停在出車道上就變成擋路的東西。
  { kind: 'car', x: M(6.0), z: M(4.5), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(9.2), z: M(4.5), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`。
 *
 * `.x` = 0.28 給出 0.2424 格 = 2.91 m 的樓高。宿舍樓 9.4 m 在 3.93 m 的門廳
 * 之上還有 1.9 層的窗格；機房是挑高車庫，本來就只有高處一排採光窗。
 *
 * 固定值 —— 公共建築不做變體，三間消防局必須長得一樣。
 */
const SEED = [0.28, 0.61, 0.35] as const;

export const firePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  color: civicColorOf('fire'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
