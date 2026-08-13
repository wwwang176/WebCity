import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_SHELL,
} from '../../buildings/parts';
import { M, COOL } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 電廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：**一座粗的、有腰的塔**、鋸齒屋頂的汽機廠房，以及一整片用黑色
 * 導線串起來的開關場。
 *
 * 這個剪影換過三輪。兩支圓柱煙囪與旁邊的水廠幾乎是同一個剪影（一根柱子加
 * 一棟房子），而柱子到處都是；兩座冷卻塔的底徑接近 10 m，在 24 m 的地上
 * 佔掉整個北半，等角視角下是兩坨蓋住廠房的圓桶。
 *
 * 一座才成立：城市裡沒有第二種建築是**有腰的旋轉體**（`shape: 'cooling'`），
 * 所以那個形狀本身就是「這是電廠」，而只放一座就留得下整個開關場。
 *
 * 開關場是這一棟的另一半內容。前一版只有三台變壓器加兩座門型構架 —— 那是
 * 地上的幾個方塊，沒有任何東西在說它們彼此相連。導線補的正是這件事，而且
 * 它是等角視角下唯一橫跨整個廠區的元素。
 *
 * 四座公用設施共用 `FACADE_UTILITY`（鍍鋅浪板色票 + 高窗帶），所以它們讀起來
 * 是同一家族。彼此的差別在**剪影**：有腰的塔／白圓桶／土丘／方池。
 */

/**
 * 廠房的高度。全廠一律 ×0.7 那一輪降下來的。
 *
 * 動的是廠房、塔與出線構架 —— 也就是剪影。變壓器與雨庇留著：它們是人的
 * 尺度的東西，跟著縮只會讓開關場看起來像模型。
 */
const HALL_TOP = M(7.7);
const HALL_ROOF = M(8.8);

/** 塔（公尺）。高徑比 1.7 —— 超過 2.2 就讀成一根柱子了。 */
const STACK_DIA = 11.0;
const STACK_TOP = 19.0;
const STACK_X = -4.0;
const STACK_Z = -5.9;

/** 電桿線：東緣一整排，從北端一路到開關場。 */
const PYLON_X = 9.6;
const PYLON_Z = [-10.0, -3.5, 3.0, 9.8] as const;
const PYLON_TOP = 9.0;
/** 兩層橫擔的下緣高度（公尺）。導線壓在橫擔的頂上。 */
const ARM_Y = [7.4, 8.5] as const;
/** 橫擔的長度與導線的掛點（離桿心的距離）。 */
const ARM_HALF = 1.7;
const HANG = [-1.4, 0, 1.4] as const;
/** 開關場那一層的高度（公尺）。從門型構架接到電桿線。 */
const YARD_Y = 5.0;

/**
 * 清水混凝土。塔的殼。
 *
 * 它原本走 `PART_DETAIL` —— 窗戶是沒了，但那條分支寫死一片偏藍的金屬灰
 * （m ≈ 0.42–0.58），`vBldgColor` 連讀都沒讀。而混凝土在現實裡是很亮的，
 * 遠遠就看得到靠的正是那個亮度。`PART_SHELL` 是照著這個顏色畫的那一條路。
 */
const CONCRETE = [0.80, 0.79, 0.76] as const;

/**
 * 塔口內側的煤黑。
 *
 * 凹槽本身由幾何負責（輪廓在頂端折回去往下，內壁的法線朝軸心），而深度也
 * 真的夠。但光挖深沒有用：內壁跟著塔身走混凝土色，而內壁的法線是水平的
 * —— 它拿到的光與塔身外側幾乎一樣，所以俯視看進去是一圈**亮的**米色，
 * 那個口讀起來仍然是塔頂的一圈紋路。
 *
 * 這個引擎沒有環境光遮蔽，塔口內側不會自己變暗。所以口裡塞一支深色的內襯，
 * 它比塔口窄一點、從凹槽的底一路到塔口 —— 俯視時最近的那個面就是它。
 */
const SOOT = [0.09, 0.09, 0.10] as const;

/** 導線的黑，以及它的粗細（公尺）。 */
const WIRE = [0.05, 0.05, 0.06] as const;
const WIRE_T = 0.09;

/** 沿 x 的一條導線。兩端要落在桿或橫擔上，不然它是憑空開始的一根棒子。 */
const wireX = (x0: number, x1: number, z: number, y: number): CivicVolume => ({
  tag: 'wire', part: PART_SHELL, color: WIRE,
  x: M((x0 + x1) / 2), z: M(z), w: M(x1 - x0), d: M(WIRE_T),
  y0: M(y), y1: M(y + WIRE_T),
});

/** 沿 z 的一條導線。 */
const wireZ = (x: number, z0: number, z1: number, y: number): CivicVolume => ({
  tag: 'wire', part: PART_SHELL, color: WIRE,
  x: M(x), z: M((z0 + z1) / 2), w: M(WIRE_T), d: M(z1 - z0),
  y0: M(y), y1: M(y + WIRE_T),
});

const massing: CivicVolume[] = [
  // ── 塔。這一棟的剪影就是它。 ────────────────────────────────
  {
    tag: 'stack', part: PART_SHELL, color: CONCRETE, shape: 'cooling',
    x: M(STACK_X), z: M(STACK_Z),
    w: M(STACK_DIA), d: M(STACK_DIA), y0: 0, y1: M(STACK_TOP),
  },
  {
    // 內襯自己也是開口的（`tub`）：實心圓柱的頂是一片圓盤，那會變成
    // 「塔口下面蓋著一塊深色的板子」，口就只有那麼深。
    tag: 'throatLining', part: PART_SHELL, color: SOOT, shape: 'tub',
    x: M(STACK_X), z: M(STACK_Z),
    w: M(STACK_DIA * COOL.THROAT * 0.94), d: M(STACK_DIA * COOL.THROAT * 0.94),
    y0: M(STACK_TOP * (1 - COOL.DEPTH)), y1: M(STACK_TOP),
  },
  {
    // 航警燈。夜裡的電廠就是天上那顆紅點。站在塔口的**環**上：內緣是
    // `COOL.THROAT`（掉進去），外緣是 `COOL.RIM`（掛到塔外面）。塔頂比
    // 宣告的寬度窄，所以兩者都得從輪廓算 —— 抄一個數字的話，腰的參數一動
    // 燈就會掉進塔口，而那不會有任何東西報錯。
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(STACK_X + STACK_DIA * (COOL.THROAT + COOL.RIM) / 4), z: M(STACK_Z),
    w: M(0.6), d: M(0.6), y0: M(STACK_TOP), y1: M(STACK_TOP + 0.7),
  },

  // ── 汽機廠房。塔前面那一排。 ────────────────────────────────
  {
    tag: 'hall',
    x: M(-2.0), z: M(2.8), w: M(18.0), d: M(6.0), y0: 0, y1: HALL_TOP,
  },
  {
    // 鋸齒屋頂 —— 廠房最好認的頂。平頂的話它與倉庫分不出來。
    // z 向不出簷：塔的南緣只差 0.1 m，出簷的話兩者的包圍盒會疊在一起。
    tag: 'hallRoof', part: PART_ROOF, shape: 'sawtooth', facing: 0,
    x: M(-2.0), z: M(2.8), w: M(18.6), d: M(6.0), y0: HALL_TOP, y1: HALL_ROOF,
  },

  // ── 電桿。東緣一整排，導線架在廠房之上。 ──────────────────────
  // 進 `massing` 而不是 `props`：9 m 的桿子是剪影的一部分，而矮物件在遠景
  // 會被關掉。橫擔與導線留在 `props`，那些細節近看才成立。
  ...PYLON_Z.map((z): CivicVolume => ({
    tag: 'pylon', part: PART_DETAIL,
    x: M(PYLON_X), z: M(z), w: M(0.5), d: M(0.5), y0: 0, y1: M(PYLON_TOP),
  })),
];

const decals: CivicDecal[] = [
  // 塔那一帶的混凝土：z [−12, −0.4]
  { x: 0, z: M(-6.2), w: M(24.0), d: M(11.6), shade: 0.55 },
  // 廠房與開關場的柏油：z [−0.4, 12]
  { x: 0, z: M(5.8), w: M(24.0), d: M(12.4), shade: 0.0 },
];

// 出入口的斑馬線與車道邊線。
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-9.0 + i * 2.2), z: M(10.6), w: M(0.5), d: M(2.0),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * 開關場：四台變壓器、兩座出線構架、一排電桿的橫擔，以及把它們串起來的
 * 黑色導線。
 *
 * 構架（門型的兩柱一樑）是「電從這裡出去」的訊號 —— 少了它，那幾個方塊
 * 只是地上的幾個方塊。而導線是唯一在說「它們彼此相連」的東西。
 */
const props: CivicVolume[] = [
  ...([-10.0, -6.6, -3.2, 0.2] as const).map((x): CivicVolume => ({
    tag: 'transformer', part: PART_DETAIL,
    x: M(x), z: M(9.8), w: M(2.6), d: M(2.2), y0: 0, y1: M(2.4),
  })),
  ...([3.6, 6.6] as const).flatMap((x): CivicVolume[] => [
    ...([-1.6, 1.6] as const).map((dz): CivicVolume => ({
      tag: 'gantryPost', part: PART_DETAIL,
      x: M(x), z: M(9.8 + dz), w: M(0.4), d: M(0.4), y0: 0, y1: M(YARD_Y),
    })),
    {
      tag: 'gantryBeam', part: PART_DETAIL,
      x: M(x), z: M(9.8), w: M(0.4), d: M(3.6), y0: M(YARD_Y), y1: M(YARD_Y + 0.3),
    },
  ]),

  // 每根電桿兩層橫擔，掛三條線。
  ...PYLON_Z.flatMap((z): CivicVolume[] => ARM_Y.map((y): CivicVolume => ({
    tag: 'crossarm', part: PART_DETAIL,
    x: M(PYLON_X), z: M(z), w: M(ARM_HALF * 2), d: M(0.25),
    y0: M(y), y1: M(y + 0.3),
  }))),
  // 開關場那一端多一道橫向的橫擔 —— 從構架拉過來的三條線要有地方落腳。
  {
    tag: 'crossarm', part: PART_DETAIL,
    x: M(PYLON_X), z: M(9.8), w: M(0.25), d: M(3.4),
    y0: M(YARD_Y), y1: M(YARD_Y + 0.3),
  },

  // 六條沿著東緣的高壓線，兩層各三條。
  ...ARM_Y.flatMap((y): CivicVolume[] => HANG.map((dx): CivicVolume =>
    wireZ(PYLON_X + dx, PYLON_Z[0]!, PYLON_Z[PYLON_Z.length - 1]!, y + 0.3))),
  // 三條把構架接上電桿線的引下線。
  ...([-1.2, 0, 1.2] as const).map((dz): CivicVolume =>
    wireX(3.6, PYLON_X, 9.8 + dz, YARD_Y + 0.3)),
];

const overhead: CivicVolume[] = [
  // 廠房側門的雨庇。
  {
    tag: 'canopy',
    x: M(-8.0), z: M(6.4), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // 廠區圍籬 —— 三面。第四面（z 正向）是大門，留空。
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  // 工業雜項。這些是「這裡有製程」的訊號 —— 排在塔、廠房與開關場之間的
  // 通道上，並且避開東緣那一排電桿（x = 9.6）。
  //
  // 這一批比別的廠區少：導線與橫擔吃掉了矮物件的額度，而它們比第五個油桶
  // 值得 —— 一整片沒有東西連著的設備讀起來是倉庫，不是開關場。
  { kind: 'pipeRack', x: M(5.6), z: M(-4.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(6.0), z: M(-10.6), axis: 'z', span: M(5.0) },
  { kind: 'drum', x: M(6.4), z: M(-8.6), radius: M(0.42) },
  { kind: 'palletStack', x: M(-10.6), z: M(-2.0), axis: 'z', depth: M(1.0) },

  // 廠區的高桿燈。夜裡沒有它，整片柏油是一塊黑。
  { kind: 'lamp', x: M(-10.4), z: M(0.0), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(11.0), heightM: 6.0 },
  { kind: 'lamp', x: M(6.0), z: M(11.0), heightM: 6.0 },

  // 沿著街廓那一側的綠籬與樹 —— 廠區對外總得有一點遮蔽。
  { kind: 'hedge', x: M(-7.0), z: M(11.4), axis: 'z', length: M(6.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-10.6), z: M(10.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-10.6), z: M(-8.0), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(-1.0), z: M(-1.4), radius: M(0.8) },

  { kind: 'signPost', x: M(7.8), z: M(6.6), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(7.0) },
  { kind: 'bollard', x: M(-0.6), z: M(11.4), radius: M(0.12) },
  { kind: 'bollard', x: M(0.6), z: M(11.4), radius: M(0.12) },
];

/**
 * 廠區的兩台車，停在廠房與開關場之間那條通道上。
 *
 * 廠房橫在基地中間，開關場（變壓器 + 出線構架）佔了南緣，兩者之間這一條
 * 是南半唯一容得下車身的空地。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.0), z: M(7.0) },
  { kind: 'van', x: M(1.0), z: M(7.0) },
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
