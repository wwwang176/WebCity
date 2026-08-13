import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_WATER, PART_SHELL,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 抽水廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**四個白色的大水桶**（2×2，中間留出十字通道）、橫在南緣的抽水
 * 機房。白圓桶是最強的那一個 —— 電廠是煙囪、汙水廠是方池，只有這裡是一片
 * 白的圓的。
 *
 * 桶的三件事缺一不可：白的桶身（`PART_SHELL`）、藍的水、**低於桶緣的水位**。
 * 前一版的水面貼在桶壁的頂上，所以四座讀起來是四個蓋著藍蓋子的圓筒 ——
 * 沒有那一圈內壁就沒有深度。桶壁因此是開口容器（`shape: 'tub'`）而不是
 * 實心圓柱：實心的話水面壓到頂面之下就整個埋進量體裡了。
 *
 * **這一格裡沒有水。** 中間試過一版把河畫進基地（北端一條水面貼片加護岸、
 * 取水口、攔汙柵），但抽水廠蓋在陸地上，不必在基地裡畫河 —— 這與火車站
 * 畫假鐵軌是同一個錯：真的水是**地形**
 * 畫的（`TERRAIN_COLORS[WATER]`），這一格自己畫一條，就是兩份各說各話的水。
 *
 * 河還是留在它的顏色裡：廠區的主色取自地形水面的色相（見 `colors.ts`）。
 *
 * 河拿掉之後北端整條空了出來，所以布局重排過。原本三座池全擠在西北、
 * 機房縮在東南，是水岸那一版的殘留 —— 東北角一大片沒有東西。現在是正交的
 * 配置：
 *
 * ```
 *   z−  ○ ○      四個桶，2×2，中間十字通道
 *       ○ ○
 *       ────────
 *       機房          南緣一整條
 *   z+  ─── 前庭 ───
 * ```
 */

const TANK_TOP = M(4.6);
/** 水面。低於桶緣 0.98 m —— 那一圈內壁就是「這裡面裝著水」。 */
const WATER_TOP = M(3.62);
const HOUSE_TOP = M(7.0);
const HOUSE_ROOF = M(7.4);

/**
 * 池水的明度（`PART_WATER` 的 B 通道：0 = 最深、1 = 最淺）。
 *
 * 走水的分支而不是地面的。地面的色譜是柏油到磚鋪 —— **全是灰的** ——
 * 所以原本 `PART_GROUND` + 0.1 的四座池在截圖裡是四個黑洞，而這一棟的
 * 辨識剪影就是那四個圓。
 *
 * 一槽水不是「自己畫一條河」（BUG-244）：河是地形的，槽裡的水是這座廠
 * 自己的東西。壓在 `WATER_MURK_MAX` **之上** —— 低於它是泥漿，而那是
 * 汙水廠的顏色。這裡出去的是自來水。
 */
const WATER_SHADE = 0.72;
/**
 * 桶身的白。乾淨的水 —— 它是這一格唯一不吃廠區色的量體。
 *
 * 走 `PART_SHELL`，而且顏色是**純白**。白色一度掛在一支立式儲水塔上，
 * 兩版都畫成灰的：塔身是牆，被 `FACADE_UTILITY` 壓成 0.70～0.90 倍再加一條
 * 高窗帶；塔頂走 `PART_GROUND`，而那條的色譜上限只到磚鋪的
 * `vec3(0.60, 0.58, 0.55)`，`shade: 0.95` 也只是中灰。兩條路都畫不出白色，
 * 而且都不會報錯 —— `PART_SHELL` 是唯一照著量體自己的顏色畫的分支。
 */
const TANK_WHITE = [1.0, 1.0, 1.0] as const;

/** 池的直徑（公尺）與四個圓心。2×2，中間讓出一條十字通道。 */
const TANK_DIA = 6.6;
const TANKS = [
  [-4.0, -8.0], [4.0, -8.0],
  [-4.0, -0.8], [4.0, -0.8],
] as const;

const massing: CivicVolume[] = [
  ...TANKS.flatMap(([x, z]): CivicVolume[] => [
    {
      // 桶身。白的、開口的 —— 見 `TANK_WHITE` 與 `shape: 'tub'`。
      tag: 'tankWall', part: PART_SHELL, color: TANK_WHITE, shape: 'tub',
      x: M(x), z: M(z), w: M(TANK_DIA), d: M(TANK_DIA), y0: 0, y1: TANK_TOP,
    },
    {
      // 水面比桶的內壁再寬一點，側面才埋進桶壁裡 —— 窄了就是沿著水面
      // 一圈看得穿到地面的縫。
      tag: 'tankWater', part: PART_WATER, shade: WATER_SHADE, shape: 'cylinder',
      x: M(x), z: M(z), w: M(5.8), d: M(5.8), y0: M(3.5), y1: WATER_TOP,
    },
  ]),

  // ── 抽水機房。南緣一整條，x [−10.6, 3.8]、z [3.4, 8.0] ────────
  // 儲水塔拿掉之後南緣的東半空了出來，機房因此從 11.2 m 拉長到 14.4 m：
  // 一條短房子加一片空地讀起來是「還沒蓋完」。
  {
    tag: 'pumpHouse',
    x: M(-3.4), z: M(5.7), w: M(14.4), d: M(4.6), y0: 0, y1: HOUSE_TOP,
  },
  {
    tag: 'pumpRoof', part: PART_ROOF,
    x: M(-3.4), z: M(5.7), w: M(15.0), d: M(5.2), y0: HOUSE_TOP, y1: HOUSE_ROOF,
  },
  // 機房屋頂的障礙燈。廠區夜裡唯一的一點自己的光 —— 高塔連同它頂上那顆
  // 航警燈一起拿掉之後，這一格會整片暗掉。
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(2.0), z: M(5.7), w: M(0.5), d: M(0.5), y0: HOUSE_ROOF, y1: M(8.6),
  },
];

const decals: CivicDecal[] = [
  // 廠區混凝土：z [−12, 8.4]
  { tag: 'yard', x: 0, z: M(-1.8), w: M(24.0), d: M(20.4), shade: 0.55 },
  // 大門前的柏油：z [8.4, 12]
  { x: 0, z: M(10.2), w: M(24.0), d: M(3.6), shade: 0.0 },
  // 十字通道。池與池之間那兩條縫要看得出是**通道**而不是縫。
  //
  // 走標線層而不是底層：底層彼此不得重疊（它們同高，會 z-fighting），
  // 而這兩條本來就是畫在廠區混凝土**上**的動線 —— 真實廠區的走道就是漆的。
  { x: 0, z: M(-4.0), w: M(1.4), d: M(15.6), shade: 0.3, layer: 'mark' },
  { x: 0, z: M(-4.4), w: M(22.0), d: M(1.4), shade: 0.3, layer: 'mark' },
];

// 大門的車道標線。
for (let i = 0; i < 3; i++) {
  decals.push({
    x: M(-8.0 + i * 8.0), z: M(10.2), w: M(0.15), d: M(2.6),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * 池與池之間的管線走道。`geometry/props` 的 `pipeRack` 太矮，這是架高的。
 *
 * 四座池排成 2×2 之後這件事才成立：走道要**跨過通道落在對面的池緣上**，
 * 而三座品字形的時候沒有兩座是正對的。
 */
const props: CivicVolume[] = [
  ...([-8.0, -0.8] as const).map((z): CivicVolume => ({
    tag: 'walkway', part: PART_DETAIL,
    x: 0, z: M(z), w: M(2.0), d: M(0.5), y0: M(4.4), y1: M(4.7),
  })),
  ...([-4.0, 4.0] as const).map((x): CivicVolume => ({
    tag: 'walkway', part: PART_DETAIL,
    x: M(x), z: M(-4.4), w: M(0.5), d: M(2.0), y0: M(4.4), y1: M(4.7),
  })),
];

const overhead: CivicVolume[] = [
  // 機房大門的雨庇。
  {
    tag: 'canopy',
    x: M(-3.4), z: M(8.6), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.5), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.5), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.5), z: 0, axis: 'x', length: M(22.0) },

  // 工業雜項全部排在池群之外那三條帶上：中央通道、東側、西側。
  // 硬塞進池與池之間的下場前一版示範過 —— 管架會從池壁裡長出來。
  // `axis: 'x'` 才是沿 z 展開的那一個（見 `props.ts` 的約定）—— 寫成
  // `'z'` 的話管架會沿 x 攤開四公尺，直接長進西邊那座池的池壁裡。
  { kind: 'pipeRack', x: 0, z: M(-8.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(10.2), z: M(-2.0), axis: 'x', span: M(4.0) },
  { kind: 'drum', x: M(10.2), z: M(1.4), radius: M(0.42) },
  { kind: 'drum', x: M(10.2), z: M(2.6), radius: M(0.42) },
  // 高塔原本站的位置。機房拉長之後這裡還剩一小塊，堆料比空著好。
  { kind: 'palletStack', x: M(7.2), z: M(5.6), axis: 'z', depth: M(1.0) },
  { kind: 'gasBottles', x: M(-9.6), z: M(-1.0), axis: 'z', radius: M(0.24) },

  { kind: 'lamp', x: M(-9.6), z: M(-8.0), heightM: 5.5 },
  { kind: 'lamp', x: M(9.8), z: M(-8.0), heightM: 5.5 },
  { kind: 'lamp', x: M(11.0), z: M(6.0), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.5), axis: 'z', length: M(9.0), depth: M(0.5), heightM: 1.2 },
  { kind: 'tree', x: M(-10.6), z: M(10.2), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(9.4), z: M(10.2), heightM: 5.4, crownRadius: M(0.9) },
  { kind: 'shrub', x: M(-1.0), z: M(10.6), radius: M(0.8) },

  { kind: 'signPost', x: M(2.6), z: M(11.2), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(2.0) },
  { kind: 'bollard', x: M(1.0), z: M(11.4), radius: M(0.12) },
  { kind: 'bollard', x: M(4.4), z: M(11.4), radius: M(0.12) },
];

/**
 * 大門前的兩台廠車。
 *
 * 停在前庭那一條柏油上 —— 廠區其餘的地全被四座池、機房與塔佔滿了，
 * 而原本停在「機房那一側的車道」上的版本，卡車有一半在牆裡面
 * （`CivicPlans` 那條「不准卡進任何東西」抓到的）。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.4), z: M(9.9) },
  { kind: 'van', x: M(6.0), z: M(9.9) },
];

const SEED = [0.55, 0.72, 0.3] as const;

export const waterPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('water'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
