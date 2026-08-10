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
  // 停靠中的公車。7.2 m 沿著路邊停 —— 橫著停的話它有一半在人行道上。
  vehicles: [{ kind: 'bus', x: 0, z: M(4.4) }],
};

// ===== 捷運站 =====

const metroTotem = totem(M(-4.8), M(2.8), 2.2);

/**
 * 捷運站 —— 出入口與電梯井。
 *
 * 站體在地下，所以地面上只有「進去的地方」：一座階梯出入口、一支玻璃電梯井、
 * 一根識別柱。深色的階梯口（`PART_GROUND` + 極低的 `shade`）是「這裡有洞」
 * 的唯一訊號 —— 少了它，出入口就只是一個小盒子。
 */
export const metroStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('metro_station'),
  seed: [0.36, 0.68, 0.5],
  massing: [
    {
      tag: 'entrance',
      x: M(-1.4), z: M(-1.6), w: M(6.4), d: M(5.2), y0: 0, y1: M(3.6),
    },
    {
      tag: 'entranceRoof', part: PART_ROOF,
      x: M(-1.4), z: M(-1.6), w: M(7.0), d: M(5.8), y0: M(3.6), y1: M(4.0),
    },
    // 玻璃電梯井。比出入口高 —— 一樣高的話兩者併成一個方盒。
    {
      tag: 'lift',
      x: M(3.4), z: M(-1.6), w: M(2.6), d: M(2.6), y0: 0, y1: M(5.4),
    },
    {
      tag: 'liftCap', part: PART_ROOF,
      x: M(3.4), z: M(-1.6), w: M(3.0), d: M(3.0), y0: M(5.4), y1: M(5.7),
    },
    // 階梯口。
    {
      tag: 'stairMouth', part: PART_GROUND, shade: 0.04,
      x: M(-1.4), z: M(1.8), w: M(4.0), d: M(1.2), y0: 0, y1: M(0.1),
    },
    metroTotem.panel,
  ],
  decals: [
    { x: 0, z: M(-2.0), w: M(12.0), d: M(8.0), shade: 0.62 },
    { x: 0, z: M(4.0), w: M(12.0), d: M(4.0), shade: 0.5 },
    // 出入口前的導盲磚帶。
    { x: M(-1.4), z: M(3.0), w: M(4.0), d: M(0.4), shade: 0.9, layer: 'mark' },
  ],
  props: [
    metroTotem.post,
    // 階梯口的欄杆。
    ...([-3.5, 0.7] as const).map((x): CivicVolume => ({
      tag: 'rail', part: PART_DETAIL,
      x: M(x), z: M(1.8), w: M(0.12), d: M(1.2), y0: 0, y1: M(1.0),
    })),
  ],
  overhead: [
    {
      tag: 'canopy',
      x: M(-1.4), z: M(2.4), w: M(4.6), d: M(1.4), y0: M(3.0), y1: M(3.3),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(4.8), z: M(3.4), heightM: 4.5 },
    { kind: 'bin', x: M(1.6), z: M(3.2), radius: M(0.26) },
    { kind: 'bikeRack', x: M(3.0), z: M(-5.0), axis: 'z' },
    { kind: 'bikeRack', x: M(3.0), z: M(-4.3), axis: 'z' },
    { kind: 'tree', x: M(-4.6), z: M(-4.6), heightM: 5.5, crownRadius: M(1.0) },
    { kind: 'shrub', x: M(-2.6), z: M(4.8), radius: M(0.7) },
    { kind: 'bollard', x: M(-4.4), z: M(5.0), radius: M(0.11) },
    { kind: 'bollard', x: M(0.6), z: M(5.0), radius: M(0.11) },
  ],
  vehicles: [],
};

// ===== 火車站 =====

// 站房收窄到 8 m，兩側各讓出 1.7 m —— 識別柱、垃圾桶、單車架、樹全部
// 站在那兩條帶上。第一版的站房 10.4 m 寬、6 m 深，幾乎吃滿整塊 1×1，
// 於是識別柱與所有街道家具都埋在站房**內部**（看不見的內部面）。
// 1×1 的教訓：先留出可以站人的地方，再決定房子多大。
const trainTotem = totem(M(-4.9), M(-2.4), 2.2);

/**
 * 火車站 —— 站房、月台與一段軌道。
 *
 * 四座裡唯一有「站體」的一座，所以它是最高的。月台走 `PART_GROUND` +
 * `shade`：它是**架高的鋪面**，標成牆的話那 0.9 m 高的台子會長出窗戶。
 *
 * 軌道只畫兩條鋼軌加碎石帶。1×1 的地放不下一列車，但兩條平行的亮線已經
 * 足夠讓人讀出「這裡是鐵路」。
 */
export const trainStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('train_station'),
  seed: [0.44, 0.15, 0.66],
  massing: [
    {
      tag: 'hall',
      x: 0, z: M(-2.4), w: M(8.0), d: M(6.0), y0: 0, y1: M(7.6),
    },
    {
      tag: 'hallRoof', part: PART_ROOF, shape: 'gable',
      x: 0, z: M(-2.4), w: M(8.6), d: M(6.5), y0: M(7.6), y1: M(9.6),
    },
    // 站房正面的大鐘。火車站的辨識訊號，而且夜裡它會亮。
    {
      tag: 'clock', part: PART_LAMP,
      x: 0, z: M(0.75), w: M(1.4), d: M(0.2), y0: M(5.4), y1: M(6.6),
    },
    // 月台。
    {
      tag: 'platform', part: PART_GROUND, shade: 0.52,
      x: 0, z: M(2.4), w: M(11.0), d: M(2.6), y0: 0, y1: M(0.9),
    },
    trainTotem.panel,
  ],
  decals: [
    // 站前廣場：z [−6, 1.1]
    { x: 0, z: M(-2.45), w: M(12.0), d: M(7.1), shade: 0.62 },
    // 道碴：z [3.7, 6]
    { x: 0, z: M(4.85), w: M(12.0), d: M(2.3), shade: 0.24 },
    // 月台邊緣的黃線。
    { x: 0, z: M(3.5), w: M(11.0), d: M(0.2), shade: 0.95, layer: 'mark' },
  ],
  props: [
    trainTotem.post,
    // 兩條鋼軌。
    ...([4.4, 5.2] as const).map((z): CivicVolume => ({
      tag: 'rail', part: PART_DETAIL,
      x: 0, z: M(z), w: M(11.0), d: M(0.16), y0: 0, y1: M(0.16),
    })),
    // 月台雨棚的四根柱。
    ...([-4.2, -1.4, 1.4, 4.2] as const).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x: M(x), z: M(2.4), w: M(0.18), d: M(0.18), y0: M(0.9), y1: M(3.0),
    })),
  ],
  overhead: [
    {
      tag: 'platformCanopy',
      x: 0, z: M(2.4), w: M(10.6), d: M(2.8), y0: M(3.0), y1: M(3.3),
    },
  ],
  fixtures: [
    // 全部站在站房兩側那兩條 1.7 m 的帶上（|x| > 4）。
    { kind: 'lamp', x: M(-5.0), z: M(0.6), heightM: 4.5 },
    { kind: 'lamp', x: M(5.0), z: M(0.6), heightM: 4.5 },
    { kind: 'bin', x: M(4.9), z: M(-5.0), radius: M(0.26) },
    { kind: 'bikeRack', x: M(4.9), z: M(-3.2), axis: 'x' },
    { kind: 'signPost', x: M(4.9), z: M(-1.2), axis: 'x' },
    { kind: 'tree', x: M(-4.9), z: M(-5.0), heightM: 5.0, crownRadius: M(0.7) },
    { kind: 'shrub', x: M(-4.9), z: M(-0.6), radius: M(0.6) },
  ],
  vehicles: [],
};

// ===== 渡輪碼頭 =====

const ferryTotem = totem(M(-4.9), M(-0.6), 2.2);

/**
 * 渡輪碼頭 —— 候船室、伸進水裡的棧橋、航道標誌燈。
 *
 * 它是四座裡唯一**地是水**的一座：基地的一半鋪的是深色水面貼片，棧橋架在
 * 上面。那個對比是它的全部 —— 少了水，候船室就只是一間小房子。
 */
export const ferryDockPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('ferry_dock'),
  seed: [0.4, 0.55, 0.72],
  massing: [
    {
      tag: 'terminal',
      x: 0, z: M(-3.4), w: M(8.0), d: M(4.4), y0: 0, y1: M(5.0),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: 0, z: M(-3.3), w: M(8.6), d: M(4.6), y0: M(5.0), y1: M(5.4),
    },
    // 棧橋。架在水上的鋪面 —— 標成牆的話這 0.7 m 高的甲板會長出窗戶。
    {
      tag: 'jetty', part: PART_GROUND, shade: 0.48,
      x: 0, z: M(2.3), w: M(5.0), d: M(6.6), y0: 0, y1: M(0.7),
    },
    // 航道標誌燈。棧橋盡頭那一點光是碼頭夜裡唯一的東西。
    {
      tag: 'navLight', part: PART_LAMP,
      x: M(2.0), z: M(5.0), w: M(0.5), d: M(0.5), y0: M(3.4), y1: M(3.9),
    },
    ferryTotem.panel,
  ],
  decals: [
    // 陸側鋪面：z [−6, −1]
    { x: 0, z: M(-3.5), w: M(12.0), d: M(5.0), shade: 0.62 },
    // 水面：z [−1, 6]。深色 —— 它與棧橋的明度差就是「這裡是水」。
    { x: 0, z: M(2.5), w: M(12.0), d: M(7.0), shade: 0.02 },
  ],
  props: [
    ferryTotem.post,
    // 標誌燈的桿。
    {
      tag: 'mast', part: PART_DETAIL,
      x: M(2.0), z: M(5.0), w: M(0.2), d: M(0.2), y0: M(0.7), y1: M(3.4),
    },
    // 繫纜樁。渡輪要綁在什麼東西上。
    ...([[-2.0, 1.4], [-2.0, 4.4], [2.0, 1.4]] as const)
      .map(([x, z]): CivicVolume => ({
        tag: 'mooring', part: PART_DETAIL, shape: 'cylinder',
        x: M(x), z: M(z), w: M(0.44), d: M(0.44), y0: M(0.7), y1: M(1.3),
      })),
  ],
  overhead: [
    // 候船室到棧橋的有蓋通道。
    {
      tag: 'gangway',
      x: 0, z: M(-0.6), w: M(3.0), d: M(1.6), y0: M(2.6), y1: M(2.9),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-4.6), z: M(3.0), heightM: 4.0 },
    { kind: 'lamp', x: M(4.6), z: M(3.0), heightM: 4.0 },
    { kind: 'bin', x: M(3.6), z: M(-1.8), radius: M(0.26) },
    { kind: 'signPost', x: M(-3.4), z: M(-0.8), axis: 'z' },
    { kind: 'tree', x: M(-4.8), z: M(-4.6), heightM: 5.0, crownRadius: M(0.8) },
    { kind: 'tree', x: M(4.8), z: M(-4.6), heightM: 5.0, crownRadius: M(0.8) },
    { kind: 'bollard', x: M(-1.2), z: M(-1.4), radius: M(0.11) },
    { kind: 'bollard', x: M(1.2), z: M(-1.4), radius: M(0.11) },
  ],
  vehicles: [],
};
