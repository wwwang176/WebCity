import {
  FACADE_TRANSIT, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { CivicPlan, CivicVolume } from '../types';

/**
 * 四座交通站點 —— 全部 1×1 格 = 12 × 12 m。
 *
 * 一個檔案四棟，與其他批次一棟一檔不同：它們小到每一棟只有 30 行，各自一檔的
 * 話讀者要開四個檔案才看得出「這四個是一組」，而它們**必須**被一起看 ——
 * 共用 `FACADE_TRANSIT`、共用同一塊 12 m 的地、共用「發光識別柱」這個語彙。
 *
 * 1×1 的可用範圍只有 ±5.76 m（扣掉 `CIVIC_INSET`），貼片是 ±6.0 m。這是全
 * 專案最緊的尺度，所以每一棟都只有一個量體加一根識別柱 —— 再多就塞不下。
 *
 * 夜間語彙：**發光的識別柱**（`PART_LAMP`）。車站是城市夜景裡最亮的東西，
 * 而在 12 m 的基地上唯一放得下的「亮」就是那根柱子。
 */

/** 識別柱的燈箱高度（公尺）。1.5 m 以下 —— 再高就變成「一根從地上亮到頂的柱子」。 */
const TOTEM_PANEL = 1.0;

/**
 * 一根發光識別柱：柱身（金屬）+ 燈箱（發光）。
 *
 * 整根標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
 * 燈箱進 `massing`（遠景不關 —— 它是這一棟唯一的辨識物），柱身進 `props`。
 */
function totem(x: number, z: number, postTop: number) {
  return {
    panel: {
      tag: 'totem', part: PART_LAMP,
      x, z, w: M(0.6), d: M(0.2),
      y0: M(postTop), y1: M(postTop + TOTEM_PANEL),
    } satisfies CivicVolume,
    post: {
      tag: 'totemPost', part: PART_DETAIL,
      x, z, w: M(0.16), d: M(0.16), y0: 0, y1: M(postTop),
    } satisfies CivicVolume,
  };
}

// ===== 公車站 =====

const busTotem = totem(M(2.9), M(0.4), 2.0);

/**
 * 公車站 —— 一座候車亭。
 *
 * 背板是**牆**（走 `FACADE_TRANSIT` 的玻璃立面），不是金屬細節：候車亭的
 * 背板本來就是玻璃的，而那條分支畫的正是它。
 */
export const busStopPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('bus_stop'),
  seed: [0.3, 0.44, 0.6],
  massing: [
    {
      tag: 'backPanel',
      x: 0, z: M(-2.2), w: M(5.0), d: M(0.25), y0: 0, y1: M(2.6),
    },
    busTotem.panel,
  ],
  decals: [
    // 人行道：z [−6, 3]
    { x: 0, z: M(-1.5), w: M(12.0), d: M(9.0), shade: 0.62 },
    // 停靠彎：z [3, 6]
    { x: 0, z: M(4.5), w: M(12.0), d: M(3.0), shade: 0.0 },
    // 停靠格的黃線。
    { x: 0, z: M(3.3), w: M(11.0), d: M(0.2), shade: 0.9, layer: 'mark' },
  ],
  props: [
    busTotem.post,
    // 候車亭的兩根前柱。
    ...([-2.3, 2.3] as const).map((x): CivicVolume => ({
      tag: 'post', part: PART_DETAIL,
      x: M(x), z: M(-0.1), w: M(0.16), d: M(0.16), y0: 0, y1: M(2.6),
    })),
    {
      tag: 'bench', part: PART_DETAIL,
      x: 0, z: M(-1.9), w: M(3.6), d: M(0.45), y0: M(0.4), y1: M(0.5),
    },
  ],
  overhead: [
    {
      tag: 'shelterRoof',
      x: 0, z: M(-1.15), w: M(5.4), d: M(2.5), y0: M(2.6), y1: M(2.85),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-4.6), z: M(1.4), heightM: 4.5 },
    { kind: 'bin', x: M(-3.4), z: M(-0.4), radius: M(0.26) },
    { kind: 'tree', x: M(-4.4), z: M(-4.4), heightM: 5.5, crownRadius: M(1.0) },
    { kind: 'shrub', x: M(-1.0), z: M(-5.0), radius: M(0.7) },
    { kind: 'shrub', x: M(1.4), z: M(-5.0), radius: M(0.7) },
    { kind: 'bollard', x: M(-4.0), z: M(2.6), radius: M(0.11) },
    { kind: 'bollard', x: M(4.0), z: M(2.6), radius: M(0.11) },
  ],
  // **不停公車。** 使用者：「公車站本來就會有公車在路上跑，所以公車站內不
  // 需要放公車」。城市裡的公車是 `VehicleRenderer` 開著的真車 —— 站牌前再擺
  // 一台靜態的，就變成一台永遠停在那裡不走的公車擋住真的那台。
  vehicles: [],
};

// ===== 捷運站 =====

const metroTotem = totem(M(4.6), M(4.6), 2.2);

/**
 * 捷運站 —— 一座**四面都能下樓**的地面通道建築。
 *
 * 使用者：「地鐵站的形象也要改一下，要看起來像可以從四面下樓的通道建築」。
 * 原本是「一座階梯出入口 + 一支電梯井」擠在基地的左半 —— 那是一個路邊的
 * 小盒子，讀起來與變電箱差不多，而且只有一個方向進得去。
 *
 * 現在是一座站在格子正中央的玻璃通道，四個方向各伸出一道階梯口通到人行道：
 *
 * ```
 *            ▓ 階梯口
 *        ┌───────────┐
 *      ▓ │   通道     │ ▓
 *        └───────────┘
 *            ▓          ● 識別柱（角落）
 * ```
 *
 * 階梯口走 `PART_GROUND` + 極低的 `shade`：深色的洞是「這裡可以下去」的唯一
 * 訊號。四個都朝著格子的邊 —— 圍在中間的話「四面下樓」是假的，人走到通道
 * 旁邊會發現沒有入口。
 */

/** 通道量體的半寬（公尺）。四道階梯口從這裡往外接。 */
const CONCOURSE_HALF = 2.7;
/** 階梯口的長度（公尺）。從通道的牆一路伸到人行道。 */
const MOUTH_LEN = 2.4;
/** 階梯口的寬度（公尺）。 */
const MOUTH_W = 3.0;
/** 階梯口中心離原點的距離。 */
const MOUTH_C = CONCOURSE_HALF + MOUTH_LEN / 2;

/** 四個方向的單位向量。順序就是 N / S / E / W。 */
const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0]] as const;

const metroMouths: CivicVolume[] = DIRS.map(([dx, dz]): CivicVolume => ({
  tag: 'stairMouth', part: PART_GROUND, shade: 0.04,
  x: M(dx * MOUTH_C), z: M(dz * MOUTH_C),
  w: M(dx === 0 ? MOUTH_W : MOUTH_LEN),
  d: M(dx === 0 ? MOUTH_LEN : MOUTH_W),
  y0: 0, y1: M(0.1),
}));

/** 每道階梯口兩側的欄杆。少了它，那四塊深色只是地上的四塊污漬。 */
const metroRails: CivicVolume[] = DIRS.flatMap(([dx, dz]) =>
  ([-1, 1] as const).map((side): CivicVolume => ({
    tag: 'rail', part: PART_DETAIL,
    x: M(dx * MOUTH_C + (dx === 0 ? side * MOUTH_W / 2 : 0)),
    z: M(dz * MOUTH_C + (dx === 0 ? 0 : side * MOUTH_W / 2)),
    w: M(dx === 0 ? 0.12 : MOUTH_LEN),
    d: M(dx === 0 ? MOUTH_LEN : 0.12),
    y0: 0, y1: M(1.0),
  })));

export const metroStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('metro_station'),
  seed: [0.36, 0.68, 0.5],
  massing: [
    {
      // 玻璃通道。`FACADE_TRANSIT` 的立面就是整片玻璃 —— 夜裡它自己會亮，
      // 而那正是「地下有東西」該有的樣子。
      tag: 'concourse',
      x: 0, z: 0, w: M(CONCOURSE_HALF * 2), d: M(CONCOURSE_HALF * 2),
      y0: 0, y1: M(3.4),
    },
    {
      tag: 'concourseRoof', part: PART_ROOF,
      x: 0, z: 0, w: M(6.0), d: M(6.0), y0: M(3.4), y1: M(3.8),
    },
    ...metroMouths,
    metroTotem.panel,
  ],
  decals: [
    // 整格的人行道鋪面。四個方向都要走得到，所以不分前後。
    { x: 0, z: 0, w: M(12.0), d: M(12.0), shade: 0.62 },
    // 四道階梯口外緣的導盲磚帶。
    ...DIRS.map(([dx, dz]) => ({
      x: M(dx * (MOUTH_C + MOUTH_LEN / 2 + 0.3)),
      z: M(dz * (MOUTH_C + MOUTH_LEN / 2 + 0.3)),
      w: M(dx === 0 ? MOUTH_W : 0.4),
      d: M(dx === 0 ? 0.4 : MOUTH_W),
      shade: 0.9, layer: 'mark' as const,
    })),
  ],
  props: [
    metroTotem.post,
    ...metroRails,
  ],
  overhead: [],
  fixtures: [
    // 全部站在**四個角**：四條軸線上是階梯口，站上去就擋住了。
    { kind: 'lamp', x: M(4.6), z: M(-4.6), heightM: 4.5 },
    { kind: 'lamp', x: M(-4.6), z: M(4.6), heightM: 4.5 },
    { kind: 'tree', x: M(-4.6), z: M(-4.6), heightM: 5.5, crownRadius: M(1.0) },
    { kind: 'bin', x: M(-3.2), z: M(-4.8), radius: M(0.26) },
    { kind: 'bikeRack', x: M(4.8), z: M(3.2), axis: 'z' },
    { kind: 'shrub', x: M(3.2), z: M(4.9), radius: M(0.6) },
    { kind: 'bollard', x: M(-4.9), z: M(3.2), radius: M(0.11) },
    { kind: 'bollard', x: M(-4.9), z: M(-3.2), radius: M(0.11) },
  ],
  vehicles: [],
};

// ===== 火車站 =====

const trainTotem = totem(M(-4.9), M(-2.6), 2.2);

/**
 * 火車站 —— 站房與月台，**中間讓出一條真正的軌道走廊**。
 *
 * 查證過的事實（`canPlaceTransportStop` + `placeTransportStopOnGrid` +
 * `TrackRenderer`）：火車站不是蓋在鐵軌**旁邊**，是蓋在鐵軌**上** ——
 * 放置規則要求那一格 `railType ≠ 0`，而寫入時只改 buildingId／reserved／
 * zoneType，軌道原封不動留在格子裡。`TrackRenderer` 於是照樣在同一格畫出
 * 碴床、枕木與兩條鋼軌，貼著**格心**、寬 `TRACK_WIDTH`。
 *
 * 所以這一棟原本錯了兩次：
 *
 * 1. 它自己在 z = 4.4 / 5.2 畫了兩條鋼軌加一條道碴帶 —— 與真的那條各畫各的，
 *    位置還不一樣。使用者：「所以不用畫出鐵軌吧?」對，不用。
 * 2. 更嚴重的是，站房（z ∈ [−5.4, 0.6]）**蓋在格心上** —— 真的鋼軌會從
 *    站房的地板穿出來，而列車會從大廳裡開過去。
 *
 * 現在的配置是「站房在軌道的一側、月台在另一側」，中間 ±TRACK_WIDTH 那條帶
 * 一件東西都沒有：
 *
 * ```
 *   z−  ┌──────────────┐
 *       │   站房（大鐘）  │
 *       ├──────────────┤
 *       │ ← 真的軌道 →   │  ← 這條帶由 TrackRenderer 畫
 *       ├──────────────┤
 *   z+  │  月台（雨棚）   │
 *       └──────────────┘
 * ```
 *
 * 走廊只讓一個方向 —— 12 m 的格子上讓出十字的話，四個角各剩 4 m，站房就
 * 蓋不起來了。玩家要把站轉到與軌道同向，這與其他有方向性的建築一樣。
 */

/** 軌道走廊的半寬（公尺）。`TrackRenderer.TRACK_WIDTH` 是 0.15 格 = 1.8 m。 */
const CORRIDOR_HALF = 1.8;

export const trainStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('train_station'),
  seed: [0.44, 0.15, 0.66],
  massing: [
    {
      // 使用者：「火車站建築應該可以低一點」。原本站房 7.6 m、屋脊 9.6 m
      // —— 在一塊 12 m 的地上那是三層樓，而它旁邊的公車站只有 2.9 m。
      // 現在是 5.6 m + 屋脊 7.2 m：仍然是四座交通站點裡最高的，但讀起來是
      // 一棟平房車站而不是一座塔。
      tag: 'hall',
      x: 0, z: M(-3.8), w: M(9.0), d: M(3.4), y0: 0, y1: M(5.6),
    },
    {
      tag: 'hallRoof', part: PART_ROOF, shape: 'gable',
      x: 0, z: M(-3.75), w: M(9.6), d: M(3.9), y0: M(5.6), y1: M(7.2),
    },
    // 站房正面（朝月台那一側）的大鐘。火車站的辨識訊號，而且夜裡它會亮。
    {
      tag: 'clock', part: PART_LAMP,
      x: 0, z: M(-2.0), w: M(1.4), d: M(0.2), y0: M(3.9), y1: M(5.1),
    },
    // 月台。走廊的另一側，整條沿著軌道。
    {
      tag: 'platform', part: PART_GROUND, shade: 0.52,
      x: 0, z: M(3.3), w: M(11.0), d: M(2.6), y0: 0, y1: M(0.9),
    },
    trainTotem.panel,
  ],
  decals: [
    // 站前廣場：z [−6, −1.8]
    { x: 0, z: M(-3.9), w: M(12.0), d: M(4.2), shade: 0.62 },
    // 軌道走廊：z [−1.8, 1.8]。碴色 —— 真的碴床只有 1.8 m 寬，兩側這一圈
    // 是它的路權範圍。
    { tag: 'corridor', x: 0, z: 0, w: M(12.0), d: M(CORRIDOR_HALF * 2), shade: 0.24 },
    // 月台側：z [1.8, 6]
    { x: 0, z: M(3.9), w: M(12.0), d: M(4.2), shade: 0.5 },
    // 月台邊緣的黃線。
    { x: 0, z: M(2.2), w: M(11.0), d: M(0.2), shade: 0.95, layer: 'mark' },
  ],
  props: [
    trainTotem.post,
    // 月台雨棚的四根柱。**沒有鋼軌** —— 那是 `TrackRenderer` 的事。
    ...([-4.2, -1.4, 1.4, 4.2] as const).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x: M(x), z: M(3.3), w: M(0.18), d: M(0.18), y0: M(0.9), y1: M(3.0),
    })),
  ],
  overhead: [
    {
      tag: 'platformCanopy',
      x: 0, z: M(3.3), w: M(10.6), d: M(2.8), y0: M(3.0), y1: M(3.3),
    },
  ],
  fixtures: [
    // 站房兩側那兩條 1.5 m 的帶，而且全部避開走廊（|z| > 1.8）。
    { kind: 'lamp', x: M(5.0), z: M(-2.0), heightM: 4.5 },
    { kind: 'lamp', x: M(-5.0), z: M(-4.0), heightM: 4.5 },
    { kind: 'bikeRack', x: M(4.9), z: M(-3.4), axis: 'x' },
    { kind: 'signPost', x: M(4.9), z: M(-4.4), axis: 'x' },
    { kind: 'bin', x: M(-5.0), z: M(-2.2), radius: M(0.26) },
    { kind: 'tree', x: M(-4.9), z: M(-5.0), heightM: 5.0, crownRadius: M(0.7) },
    { kind: 'shrub', x: M(-5.0), z: M(5.2), radius: M(0.5) },
  ],
  vehicles: [],
};

// ===== 渡輪碼頭 =====

const ferryTotem = totem(M(-4.9), M(-5.0), 2.2);

/**
 * 渡輪碼頭 —— 候船室、碼頭平台、**一艘靠在旁邊的渡輪**。
 *
 * 使用者：「渡船口的形象要改一下，看不出來是渡船」。原本它是一間小房子加
 * 一條伸進深灰色地面的棧橋 —— 而那片「水」是 `PART_GROUND` 的最暗端，
 * 也就是柏油。從上面看，它與一間蓋在停車場邊的小屋沒有差別。
 *
 * 三件事一起補：
 *
 * 1. **水是水。** 港池走 `PART_WATER`（新的零件類別）—— 會動的藍，不是
 *    灰階鋪面的最暗端。這一格有一半是水，所以這是最大的一件。
 * 2. **船。** 停一艘渡輪在碼頭邊，用的是航線上跑的同一份幾何
 *    （`geometry/ferry`）。消防局停消防車、機場停飛機，碼頭當然停船。
 * 3. **跳板。** 從碼頭平台接到船舷。少了它，船只是停在旁邊的一個物件；
 *    有了它，這一格在講一件事：人從這裡上船。
 *
 * ```
 *   z−  ┌──────────────┐
 *       │   候船室       │
 *       ├──────────────┤
 *       │  碼頭平台 ┃跳板 │
 *       │ ~~~~~~~~~~~~~ │
 *   z+  │ ~~~ 🚢 渡輪 ~~ │
 *       └──────────────┘
 * ```
 */

/** 碼頭平台的面高（公尺）。船舷與跳板都接在這個高度。 */
const QUAY_TOP = 0.7;

export const ferryDockPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('ferry_dock'),
  seed: [0.4, 0.55, 0.72],
  massing: [
    {
      tag: 'terminal',
      x: 0, z: M(-3.9), w: M(8.4), d: M(3.2), y0: 0, y1: M(4.4),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: 0, z: M(-3.9), w: M(9.0), d: M(3.5), y0: M(4.4), y1: M(4.8),
    },
    // 碼頭平台。架高的鋪面 —— 標成牆的話這 0.7 m 高的台子會長出窗戶。
    {
      tag: 'quay', part: PART_GROUND, shade: 0.48,
      x: 0, z: M(-1.5), w: M(11.0), d: M(1.6), y0: 0, y1: M(QUAY_TOP),
    },
    // 航道標誌燈。碼頭夜裡唯一的一點光，站在平台的右端。
    {
      tag: 'navLight', part: PART_LAMP,
      x: M(4.6), z: M(-1.5), w: M(0.5), d: M(0.5), y0: M(3.4), y1: M(3.9),
    },
    ferryTotem.panel,
  ],
  decals: [
    // 陸側鋪面：z [−6, −0.7]
    { x: 0, z: M(-3.35), w: M(12.0), d: M(5.3), shade: 0.62 },
    // 港池：z [−0.7, 6]。`water` 讓它走 PART_WATER —— 這一格有一半是水，
    // 而水是不是藍的，決定了這一格看不看得出是碼頭。
    { tag: 'harbour', water: true, x: 0, z: M(2.65), w: M(12.0), d: M(6.7), shade: 0.42 },
  ],
  props: [
    ferryTotem.post,
    // 標誌燈的桿。
    {
      tag: 'mast', part: PART_DETAIL,
      x: M(4.6), z: M(-1.5), w: M(0.2), d: M(0.2), y0: M(QUAY_TOP), y1: M(3.4),
    },
    // 跳板。從平台的前緣接到船舷 —— 這一塊是「從這裡上船」的全部。
    {
      tag: 'gangway', part: PART_DETAIL,
      x: M(-1.6), z: M(-0.15), w: M(1.6), d: M(1.1),
      y0: M(QUAY_TOP - 0.2), y1: M(QUAY_TOP - 0.05),
    },
    // 繫纜樁。渡輪要綁在什麼東西上。
    ...([-4.0, 1.2] as const).map((x): CivicVolume => ({
      tag: 'mooring', part: PART_DETAIL, shape: 'cylinder',
      x: M(x), z: M(-0.95), w: M(0.44), d: M(0.44),
      y0: M(QUAY_TOP), y1: M(QUAY_TOP + 0.6),
    })),
  ],
  overhead: [
    // 候船室到碼頭平台的有蓋通道。
    {
      tag: 'canopy',
      x: 0, z: M(-2.6), w: M(3.6), d: M(1.4), y0: M(2.6), y1: M(2.9),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-4.6), z: M(-1.4), heightM: 4.0 },
    { kind: 'bin', x: M(3.4), z: M(-2.4), radius: M(0.26) },
    { kind: 'signPost', x: M(-3.0), z: M(-1.9), axis: 'z' },
    { kind: 'tree', x: M(-4.8), z: M(-4.7), heightM: 5.0, crownRadius: M(0.8) },
    { kind: 'tree', x: M(4.8), z: M(-4.7), heightM: 5.0, crownRadius: M(0.8) },
    { kind: 'bollard', x: M(-1.2), z: M(-2.5), radius: M(0.11) },
    { kind: 'bollard', x: M(1.2), z: M(-2.5), radius: M(0.11) },
  ],
  /**
   * 靠在碼頭邊的渡輪。
   *
   * 沿 x 停（不轉向）：船身 9 m，橫著停在 12 m 的格子裡剩不到 1.5 m 的
   * 餘裕，而 `assembleVehicles` 的佔地護欄會當場擋下來。
   */
  vehicles: [
    { kind: 'ferry', x: 0, z: M(1.8) },
  ],
};
