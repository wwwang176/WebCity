import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 抽水廠 —— 2×2 格 = 24 × 24 m。
 *
 * 辨識特徵：三座圓形沉澱池（品字形）、一支**白色**的立式儲水塔、抽水機房。
 * 圓槽是最強的那一個 —— 電廠是冷卻塔、汙水廠是方池，只有這裡是一排圓的。
 *
 * **這一格裡沒有水。** 中間試過一版把河畫進基地（北端一條水面貼片加護岸、
 * 取水口、攔汙柵），使用者：「抽水站是建立在陸地上的，所以不需要再抽水站
 * 裡面畫河」—— 對，而且這與火車站畫假鐵軌是同一個錯：真的水是**地形**
 * 畫的（`TERRAIN_COLORS[WATER]`），這一格自己畫一條，就是兩份各說各話的水。
 *
 * 河還是留在它的顏色裡：廠區的主色取自地形水面的色相（見 `colors.ts`）。
 */

const TANK_TOP = M(4.6);
const HOUSE_TOP = M(7.0);
const HOUSE_ROOF = M(7.4);
const TOWER_TOP = M(15.0);

/** 池水的明度。深色 —— 池壁（`PART_DETAIL`）才有東西可以對比。 */
const WATER_SHADE = 0.1;
/** 儲水塔的白。乾淨的水 —— 它是這一格唯一不吃廠區色的量體。 */
const TOWER_WHITE = [0.94, 0.95, 0.96] as const;

/** 三座池的圓心。品字形，不是排成一列 —— 一列讀起來是三個一樣的東西。 */
const TANKS = [[-7.8, -5.4], [0.1, -5.4], [-7.8, 2.2]] as const;

const massing: CivicVolume[] = [
  ...TANKS.flatMap(([x, z]): CivicVolume[] => [
    {
      // 池壁。金屬灰的環 —— 它與水面的明度差就是「這是一個池子」。
      tag: 'tankWall', part: PART_DETAIL, shape: 'cylinder',
      x: M(x), z: M(z), w: M(7.4), d: M(7.4), y0: 0, y1: TANK_TOP,
    },
    {
      tag: 'tankWater', part: PART_GROUND, shade: WATER_SHADE, shape: 'cylinder',
      x: M(x), z: M(z), w: M(6.6), d: M(6.6), y0: TANK_TOP, y1: M(4.72),
    },
  ]),

  // ── 抽水機房。x [4, 11]、z [−1, 8] ──────────────────────────
  {
    tag: 'pumpHouse',
    x: M(7.5), z: M(3.5), w: M(7.0), d: M(9.0), y0: 0, y1: HOUSE_TOP,
  },
  {
    tag: 'pumpRoof', part: PART_ROOF,
    x: M(7.5), z: M(3.5), w: M(7.6), d: M(9.6), y0: HOUSE_TOP, y1: HOUSE_ROOF,
  },

  // ── 立式儲水塔。廠區裡唯一有高度的東西。 ────────────────────
  // 站在三座池與機房之間僅存的那塊空地上 —— 塔的圓與池的圓不得互相插入，
  // 那會是看不見的內部面。
  // 塔身與塔頂都是**白的**。使用者：「水塔應該是白色系，看起來比較乾淨」。
  // 塔身用逐量體的顏色覆寫（牆的分支讀 `aBldgColor`）；塔頂不能走
  // `PART_ROOF` —— 那條吃的是公用設施共用的屋頂色票（鍍鋅、舊鍍鋅、鏽紅），
  // 一頂鏽紅的蓋子扣在白塔上會變成整座廠區最顯眼的東西。
  {
    tag: 'tower', shape: 'cylinder', color: TOWER_WHITE,
    x: M(1.0), z: M(6.4), w: M(4.6), d: M(4.6), y0: 0, y1: TOWER_TOP,
  },
  {
    tag: 'towerCap', part: PART_GROUND, shade: 0.95, shape: 'cylinder',
    x: M(1.0), z: M(6.4), w: M(5.0), d: M(5.0), y0: TOWER_TOP, y1: M(15.6),
  },
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(1.0), z: M(6.4), w: M(0.8), d: M(0.8), y0: M(15.6), y1: M(16.2),
  },
];

const decals: CivicDecal[] = [
  // 廠區混凝土：z [−12, 9]
  { tag: 'yard', x: 0, z: M(-1.5), w: M(24.0), d: M(21.0), shade: 0.55 },
  // 大門前的柏油：z [9, 12]
  { x: 0, z: M(10.5), w: M(24.0), d: M(3.0), shade: 0.0 },
];

// 大門的車道標線。
for (let i = 0; i < 3; i++) {
  decals.push({
    x: M(-8.0 + i * 8.0), z: M(10.5), w: M(0.15), d: M(2.6),
    shade: 1.0, layer: 'mark',
  });
}

/** 池與池之間的管線走道。`geometry/props` 的 `pipeRack` 太矮，這是架高的。 */
const props: CivicVolume[] = [
  {
    tag: 'walkway', part: PART_DETAIL,
    x: M(-3.85), z: M(-5.4), w: M(0.7), d: M(0.5), y0: M(4.4), y1: M(4.7),
  },
  {
    tag: 'walkway', part: PART_DETAIL,
    x: M(-7.8), z: M(-1.6), w: M(0.5), d: M(0.6), y0: M(4.4), y1: M(4.7),
  },
];

const overhead: CivicVolume[] = [
  {
    tag: 'canopy',
    x: M(3.8), z: M(3.5), w: M(1.6), d: M(4.0), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  // 沿著三座池之間那條縫（x ∈ [−4.1, −3.6] 之外）—— 原本從 −4.6 起算，
  // 而那已經在西側那座池的池壁裡。
  { kind: 'pipeRack', x: M(-1.8), z: M(1.4), axis: 'z', span: M(3.6) },
  // 只有一道管架。改成水岸配置之後，三座池 + 機房 + 塔 + 取水口把地填滿了，
  // 第二道無論擺在哪裡都會插進某個量體 —— 硬塞的下場就是它從池壁裡長出來。
  { kind: 'drum', x: M(-2.0), z: M(7.6), radius: M(0.4) },
  { kind: 'drum', x: M(-1.0), z: M(7.6), radius: M(0.4) },
  { kind: 'gasBottles', x: M(-2.0), z: M(9.4), axis: 'z', radius: M(0.24) },

  { kind: 'lamp', x: M(-10.6), z: M(-5.4), heightM: 5.5 },
  { kind: 'lamp', x: M(10.6), z: M(-6.2), heightM: 5.5 },
  { kind: 'lamp', x: M(10.6), z: M(7.4), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.4), axis: 'z', length: M(9.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-10.4), z: M(9.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(8.4), z: M(9.4), heightM: 5.4, crownRadius: M(0.9) },
  { kind: 'shrub', x: M(-2.6), z: M(9.4), radius: M(0.8) },

  { kind: 'signPost', x: M(8.4), z: M(11.0), axis: 'z' },
  { kind: 'hydrant', x: M(10.8), z: M(4.0) },
  { kind: 'bollard', x: M(-2.0), z: M(11.2), radius: M(0.12) },
  { kind: 'bollard', x: M(7.0), z: M(11.2), radius: M(0.12) },
];

/**
 * 大門前的兩台廠車。
 *
 * 原本停在機房那一側的「柏油車道」上 —— 而那條車道與機房是同一塊地，
 * 卡車有一半在牆裡面（`CivicPlans` 那條「不准卡進任何東西」抓到的）。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.6), z: M(10.0) },
  { kind: 'van', x: M(2.4), z: M(10.0) },
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
