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
  // **不停公車。** 城市裡的公車是 `VehicleRenderer` 開著的真車，會照路線
  // 停靠 —— 站牌前再擺一台靜態的，就變成一台永遠停在那裡不走的公車擋住
  // 真的那台。
  vehicles: [],
};

// ===== 捷運站 =====

const metroTotem = totem(M(4.6), M(4.6), 2.2);

/**
 * 捷運站 —— 一座**四面都能下樓**的地面通道建築。
 *
 * 它要讀成一座四面都能下樓的通道建築。原本是「一座階梯出入口 + 一支電梯井」
 * 擠在基地的左半 —— 那是一個路邊的小盒子，讀起來與變電箱差不多，而且只有
 * 一個方向進得去。
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
 *    位置還不一樣。這一格不必自己畫鐵軌。
 * 2. 更嚴重的是，站房（z ∈ [−5.4, 0.6]）**蓋在格心上** —— 真的鋼軌會從
 *    站房的地板穿出來，而列車會從大廳裡開過去。
 *
 * 所以配置是「站房在軌道的一側、月台在另一側」，中間那條帶不能蓋東西。
 *
 * 但那樣兩棟就各站各的：一棟房子旁邊有一塊月台，讀起來不是一座車站。
 *
 * 連起來的唯一辦法是**跨過去**（軌道在格心，繞不過去），而那正好就是車站
 * 最好認的形象：**跨站的天橋**加落在月台上的樓梯塔。走廊因此不是禁建區，
 * 是**淨空包絡線**（`TRACK_CLEARANCE`） —— 真實車站的天橋本來就在軌道上方。
 *
 * ```
 *   z−  ┌──────────────┐
 *       │ ▙ 站房（門廊 + 大鐘）│
 *       ├──────╫───────┤   ╫ = 天橋，橋面 5.6 m
 *       │ ← 真的軌道 → ╫  │  ← 這條帶由 TrackRenderer 畫
 *       ├──────╫───────┤
 *   z+  │  月台  ▉ 樓梯塔 │
 *       └──────────────┘
 * ```
 *
 * 走廊只讓一個方向 —— 12 m 的格子上讓出十字的話，四個角各剩 4 m，站房就
 * 蓋不起來了。玩家要把站轉到與軌道同向，這與其他有方向性的建築一樣。
 */

/** 軌道走廊的半寬（公尺）。`TrackRenderer.TRACK_WIDTH` 是 0.15 格 = 1.8 m。 */
const CORRIDOR_HALF = 1.8;
/** 站房的簷高，也是天橋的橋面高 —— 天橋從站房的二樓層直接伸出去。 */
const HALL_EAVE = 5.6;
/** 天橋的橋面厚度上緣。 */
const DECK_TOP = 6.0;
/** 天橋與樓梯塔的中心 x。偏一側 —— 壓在正中央會擋住門廊與大鐘。 */
const BRIDGE_X = 2.6;
/** 月台的中心與深度（公尺）。樓梯塔要落在它上面。 */
const PLATFORM_Z = 3.3;
const PLATFORM_D = 2.6;

export const trainStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('train_station'),
  seed: [0.44, 0.15, 0.66],
  massing: [
    {
      // 原本站房 7.6 m、屋脊 9.6 m —— 在一塊 12 m 的地上那是三層樓，而它
      // 旁邊的公車站只有 2.9 m。現在是 5.6 m + 屋脊 7.2 m：仍然是四座交通
      // 站點裡最高的，但讀起來是一棟平房車站而不是一座塔。
      tag: 'hall',
      x: 0, z: M(-3.75), w: M(9.0), d: M(3.0), y0: 0, y1: M(HALL_EAVE),
    },
    {
      // 山牆只在**兩端**出簷（w 9.6 > 9.0），z 向與站房齊平 —— 天橋從
      // 簷口的正下方伸出去，出簷的話橋會從屋簷裡穿出來。
      tag: 'hallRoof', part: PART_ROOF, shape: 'gable',
      x: 0, z: M(-3.75), w: M(9.6), d: M(3.0), y0: M(HALL_EAVE), y1: M(7.2),
    },
    // 站前的門廊。從站房的正面凸出來一截、比簷口再高一點 ——
    // 「這裡是入口」在等角視角下只有靠凸出與高度講得清楚。
    {
      tag: 'portal',
      x: 0, z: M(-5.4), w: M(3.6), d: M(0.3), y0: 0, y1: M(HALL_EAVE),
    },
    // 門廊上的大鐘。掛在**站前**那一面：大鐘是給要趕車的人看的，
    // 朝月台那一側只有已經進站的人看得到。夜裡它會亮。
    {
      tag: 'clock', part: PART_LAMP,
      x: 0, z: M(-5.62), w: M(1.4), d: M(0.14), y0: M(4.2), y1: M(5.4),
    },
    // 月台。走廊的另一側，整條沿著軌道。
    {
      tag: 'platform', part: PART_GROUND, shade: 0.52,
      x: 0, z: M(PLATFORM_Z), w: M(11.0), d: M(PLATFORM_D), y0: 0, y1: M(0.9),
    },
    // 跨站天橋。從站房的簷口高度伸出去，跨過軌道落在樓梯塔上 ——
    // 淨空 5.6 m > `TRACK_CLEARANCE`，列車從底下過。
    {
      tag: 'footbridge',
      x: M(BRIDGE_X), z: M(0.525), w: M(2.4), d: M(5.55),
      y0: M(HALL_EAVE), y1: M(DECK_TOP),
    },
    // 樓梯塔。天橋在月台這一端的落腳點 —— 少了它，橋是懸空斷掉的。
    {
      // 從**月台面**站上來，頂到橋面的底 —— 起點寫 0 的話它會埋進月台，
      // 頂寫到橋面的上緣的話它會插進橋裡（兩者都是看不見的內部面）。
      tag: 'stairTower',
      x: M(BRIDGE_X), z: M(PLATFORM_Z), w: M(2.4), d: M(2.2),
      y0: M(0.9), y1: M(HALL_EAVE),
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
    // 位置避開樓梯塔（x ∈ [1.4, 3.8]），不然柱子會從塔裡長出來。
    ...([-4.8, -3.4, -1.4, 0.6] as const).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x: M(x), z: M(PLATFORM_Z), w: M(0.18), d: M(0.18), y0: M(0.9), y1: M(3.0),
    })),
    // 天橋兩側的欄杆。少了它橋面是一塊浮在空中的板子。
    ...([-1.1, 1.1] as const).map((dx): CivicVolume => ({
      tag: 'bridgeRail', part: PART_DETAIL,
      x: M(BRIDGE_X + dx), z: M(0.525), w: M(0.16), d: M(5.55),
      y0: M(DECK_TOP), y1: M(6.9),
    })),
  ],
  overhead: [
    {
      // 只蓋到樓梯塔的西面（x = 1.4） —— 蓋過去的話雨棚會從塔裡穿出來。
      tag: 'platformCanopy',
      x: M(-2.0), z: M(PLATFORM_Z), w: M(6.8), d: M(2.8), y0: M(3.0), y1: M(3.3),
    },
  ],
  fixtures: [
    // 站房兩側那兩條 1.5 m 的帶，而且全部避開走廊（|z| > 1.8）。
    { kind: 'lamp', x: M(5.0), z: M(-2.6), heightM: 4.5 },
    { kind: 'lamp', x: M(-5.0), z: M(-4.0), heightM: 4.5 },
    { kind: 'bikeRack', x: M(4.9), z: M(-3.4), axis: 'x' },
    { kind: 'signPost', x: M(4.9), z: M(-4.6), axis: 'x' },
    { kind: 'bin', x: M(-5.0), z: M(-2.4), radius: M(0.26) },
    { kind: 'tree', x: M(-4.9), z: M(-5.0), heightM: 5.0, crownRadius: M(0.6) },
    { kind: 'shrub', x: M(-5.0), z: M(5.0), radius: M(0.5) },
  ],
  vehicles: [],
};

// ===== 渡輪碼頭 =====

const ferryTotem = totem(M(-4.9), M(-0.8), 2.2);

/**
 * 渡輪碼頭 —— 候船室在後、一整片碼頭甲板在前，泊位**空著**。
 *
 * **這一格裡沒有水。**
 * 中間試過一版把港池畫進基地，渡船口同理（承接抽水廠那一條：蓋在陸地上的東西不要自己畫水）。查證過，這裡
 * 比抽水廠更明確：`Game.placeTransportStop` 用 `isShorePosition` 檢查，而
 * 那個函式的定義就是「**這一格是陸地**，而且四鄰有一格是水」。
 *
 * **而且泊位上不停船。**渡船口不停船，而且要重排。
 * 與公車站同一條理由：城市裡的渡輪是 `FerryAnimator` 開著的真船，會照航線靠泊 ——
 * 這裡再擺一艘不會動的，就變成一艘永遠佔著泊位的船擋住真的那艘。
 * 何況水在隔壁那一格，靜態的船只能停在佔地前緣的鋪面上，讀起來是擱淺的。
 *
 * 船拿掉之後這一格最大的一塊是空甲板，所以重排的重點就是**把甲板變成主角**：
 * 它現在佔了南半整片，上面架一道候船雨棚，前緣一排繫纜樁與一道跳板。
 *
 * ```
 *   z−  ┌──────────────┐
 *       │    候船室      │
 *       ├──────────────┤
 *       │     前庭       │
 *       │ ▁▁▁▁▁▁▁▁▁▁▁▁ │
 *       │ ▏  雨棚下的甲板 ▕│  ● 標誌燈
 *   z+  │ ▔▔ ⌷ ⌷ ⌷ ▔▔▔ │  ← 繫纜樁；佔地前緣＝岸線，隔壁那一格是水
 *       └───────┴跳板┴──┘
 * ```
 */

/** 碼頭甲板的面高（公尺）。雨棚柱、繫纜樁與跳板都接在這個高度。 */
const QUAY_TOP = 0.7;
/** 甲板的中心與深度（公尺）。z [0.8, 5.2] —— 佔地前緣是 5.76。 */
const QUAY_Z = 3.0;
const QUAY_D = 4.4;
/** 雨棚的下緣。柱子從甲板面頂到這裡。 */
const CANOPY_Y = 3.0;

export const ferryDockPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('ferry_dock'),
  seed: [0.4, 0.55, 0.72],
  massing: [
    {
      tag: 'terminal',
      x: 0, z: M(-3.9), w: M(8.6), d: M(3.0), y0: 0, y1: M(4.4),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: 0, z: M(-3.9), w: M(9.2), d: M(3.3), y0: M(4.4), y1: M(4.8),
    },
    // 碼頭甲板。架高的鋪面 —— 標成牆的話這 0.7 m 高的台子會長出窗戶。
    // 船拿掉之後它是這一格的主角，所以從 1.8 m 深加寬到 4.4 m：一整片
    // 站得下人的甲板，而不是甲板形狀的一條邊。
    {
      tag: 'quay', part: PART_GROUND, shade: 0.48,
      x: 0, z: M(QUAY_Z), w: M(11.2), d: M(QUAY_D), y0: 0, y1: M(QUAY_TOP),
    },
    // 航道標誌燈。碼頭夜裡唯一的一點光，站在甲板的東端、雨棚之外。
    {
      tag: 'navLight', part: PART_LAMP,
      x: M(5.0), z: M(4.4), w: M(0.5), d: M(0.5), y0: M(3.4), y1: M(3.9),
    },
    ferryTotem.panel,
  ],
  decals: [
    // 候船室那一帶：z [−6, −2.2]
    { x: 0, z: M(-4.1), w: M(12.0), d: M(3.8), shade: 0.62 },
    // 前庭與碼頭：z [−2.2, 6]。整片硬鋪面 —— 這一格全部是陸地。
    { tag: 'apron', x: 0, z: M(1.9), w: M(12.0), d: M(8.2), shade: 0.5 },
    // 甲板前緣的黃線。岸線在這裡。
    { x: 0, z: M(4.9), w: M(11.0), d: M(0.2), shade: 0.95, layer: 'mark' },
    // 登船動線：從前庭指向跳板。空甲板上這條線就是「往這邊上船」。
    { x: M(-2.4), z: M(2.6), w: M(0.2), d: M(3.4), shade: 0.9, layer: 'mark' },
  ],
  props: [
    ferryTotem.post,
    // 標誌燈的桿。
    {
      tag: 'mast', part: PART_DETAIL,
      x: M(5.0), z: M(4.4), w: M(0.2), d: M(0.2), y0: M(QUAY_TOP), y1: M(3.4),
    },
    // 候船雨棚的四根柱。站在甲板上，頂到雨棚 —— 與火車站月台同一套做法。
    ...([-4.0, 4.0] as const).flatMap((x): CivicVolume[] =>
      ([1.8, 4.4] as const).map((z): CivicVolume => ({
        tag: 'canopyPost', part: PART_DETAIL,
        x: M(x), z: M(z), w: M(0.18), d: M(0.18),
        y0: M(QUAY_TOP), y1: M(CANOPY_Y),
      }))),
    // 跳板。從甲板的前緣往岸線外伸出去 —— 這一塊是「從這裡上船」的全部。
    {
      tag: 'gangway', part: PART_DETAIL,
      x: M(-2.4), z: M(5.1), w: M(1.8), d: M(1.2),
      y0: M(QUAY_TOP - 0.25), y1: M(QUAY_TOP - 0.05),
    },
    // 繫纜樁。船不停在這裡了，它反而更重要 —— 空甲板上唯一在說
    // 「這條邊會靠船」的東西，所以排成一列而不是兩根。
    ...([-3.6, -0.4, 2.8] as const).map((x): CivicVolume => ({
      tag: 'mooring', part: PART_DETAIL, shape: 'cylinder',
      x: M(x), z: M(4.7), w: M(0.44), d: M(0.44),
      y0: M(QUAY_TOP), y1: M(QUAY_TOP + 0.6),
    })),
  ],
  overhead: [
    // 泊位的候船雨棚。它撐起了船拿掉之後這一格最大的一塊空白。
    {
      tag: 'berthCanopy',
      x: 0, z: M(3.1), w: M(9.0), d: M(3.4), y0: M(CANOPY_Y), y1: M(3.3),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-5.0), z: M(-1.0), heightM: 4.0 },
    { kind: 'bin', x: M(3.6), z: M(-1.2), radius: M(0.26) },
    { kind: 'signPost', x: M(-2.6), z: M(-1.2), axis: 'z' },
    { kind: 'bikeRack', x: M(4.9), z: M(-3.4), axis: 'x' },
    { kind: 'tree', x: M(-5.0), z: M(-5.0), heightM: 5.0, crownRadius: M(0.6) },
    { kind: 'tree', x: M(5.0), z: M(-5.0), heightM: 5.0, crownRadius: M(0.6) },
    { kind: 'bollard', x: M(-1.2), z: M(-1.6), radius: M(0.11) },
    { kind: 'bollard', x: M(1.2), z: M(-1.6), radius: M(0.11) },
  ],
  vehicles: [],
};
