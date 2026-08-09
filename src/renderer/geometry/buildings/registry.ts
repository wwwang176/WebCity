import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { tagPart, PART_WALL, PART_ROOF } from './parts';
import { METRES_PER_CELL, MAX_BUILDING_WIDTH_M } from '../../../core/grid/constants';

// ===== Geometry Builders =====

// -- Residential Low: houses with garages/porches --
//
// 樹、樹籬、灌木、圍籬已搬到 groundProps.ts —— 它們吃不得建築的 Y 縮放
// （BUG-219）。車庫、門廊、工具間留在這裡：它們是建築，跟著等級變大是對的。

function makeResLowV1(): THREE.BufferGeometry {
  // House with pitched roof + detached garage
  const body = new THREE.BoxGeometry(0.36, 0.32, 0.34);
  body.translate(-0.08, 0.16, -0.06);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.32, 0.18, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(-0.08, 0.41, -0.06);
  tagPart(roof, PART_ROOF);
  // Garage
  const garage = new THREE.BoxGeometry(0.2, 0.18, 0.22);
  garage.translate(0.22, 0.09, 0.18);
  tagPart(garage, PART_WALL);
  const gRoof = new THREE.BoxGeometry(0.22, 0.03, 0.24);
  gRoof.translate(0.22, 0.195, 0.18);
  tagPart(gRoof, PART_ROOF);
  return mergeGeometries([body, roof, garage, gRoof])!;
}

function makeResLowV2(): THREE.BufferGeometry {
  // Wide bungalow + garden shed
  const body = new THREE.BoxGeometry(0.5, 0.26, 0.36);
  body.translate(0, 0.13, -0.06);
  tagPart(body, PART_WALL);
  const porch = new THREE.BoxGeometry(0.18, 0.14, 0.1);
  porch.translate(0.18, 0.07, 0.15);
  tagPart(porch, PART_WALL);
  const shed = new THREE.BoxGeometry(0.14, 0.16, 0.14);
  shed.translate(-0.22, 0.08, 0.22);
  tagPart(shed, PART_WALL);
  const shedRoof = new THREE.BoxGeometry(0.16, 0.02, 0.16);
  shedRoof.translate(-0.22, 0.17, 0.22);
  tagPart(shedRoof, PART_ROOF);
  return mergeGeometries([body, porch, shed, shedRoof])!;
}

function makeResLowV3(): THREE.BufferGeometry {
  // Narrow townhouse with steep roof
  const body = new THREE.BoxGeometry(0.32, 0.4, 0.4);
  body.translate(0, 0.2, -0.04);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.3, 0.22, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.51, -0.04);
  tagPart(roof, PART_ROOF);
  return mergeGeometries([body, roof])!;
}

// -- Residential High --

function makeResHighV1(): THREE.BufferGeometry {
  const main = new THREE.BoxGeometry(0.6, 0.8, 0.55);
  main.translate(0, 0.4, 0);
  tagPart(main, PART_WALL);
  const top = new THREE.BoxGeometry(0.4, 0.25, 0.35);
  top.translate(0, 0.925, 0);
  tagPart(top, PART_ROOF);
  return mergeGeometries([main, top])!;
}

function makeResHighV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.45, 1.0, 0.45);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  cap.translate(0, 1.03, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

function makeResHighV3(): THREE.BufferGeometry {
  const wing1 = new THREE.BoxGeometry(0.6, 0.7, 0.3);
  wing1.translate(0, 0.35, -0.1);
  tagPart(wing1, PART_WALL);
  const wing2 = new THREE.BoxGeometry(0.3, 0.7, 0.6);
  // z 收到 0.13：原本的 0.15 讓這一翼伸到 z = 0.45，乘上最大深度縮放 1.15
  // 之後是 0.5175，會越過格子邊界吃進鄰居（BUG-218）。
  wing2.translate(-0.15, 0.35, 0.13);
  tagPart(wing2, PART_WALL);
  return mergeGeometries([wing1, wing2])!;
}

// -- Commercial Low --

function makeComLowV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.6, 0.4, 0.55);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const awning = new THREE.BoxGeometry(0.65, 0.03, 0.15);
  awning.translate(0, 0.35, 0.32);
  tagPart(awning, PART_ROOF);
  return mergeGeometries([body, awning])!;
}

function makeComLowV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.7, 0.35, 0.5);
  body.translate(0, 0.175, 0);
  tagPart(body, PART_WALL);
  const sign = new THREE.BoxGeometry(0.55, 0.06, 0.02);
  sign.translate(0, 0.38, 0.26);
  tagPart(sign, PART_ROOF);
  return mergeGeometries([body, sign])!;
}

function makeComLowV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const entry = new THREE.BoxGeometry(0.15, 0.3, 0.08);
  entry.translate(0, 0.15, 0.29);
  tagPart(entry, PART_WALL);
  return mergeGeometries([body, entry])!;
}

// -- Commercial High --

function makeComHighV1(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.6, 0.4, 0.6);
  base.translate(0, 0.2, 0);
  tagPart(base, PART_WALL);
  const tower = new THREE.BoxGeometry(0.45, 0.8, 0.45);
  tower.translate(0, 0.8, 0);
  tagPart(tower, PART_WALL);
  return mergeGeometries([base, tower])!;
}

function makeComHighV2(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.28, 0.3, 1.0, 8);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 8);
  cap.translate(0, 1.025, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

// -- Industrial: factories with yards --

function makeIndV1(): THREE.BufferGeometry {
  // Factory + small utility shed
  const body = new THREE.BoxGeometry(0.5, 0.38, 0.45);
  body.translate(-0.04, 0.19, -0.04);
  tagPart(body, PART_WALL);
  const chimney = new THREE.CylinderGeometry(0.06, 0.08, 0.4, 6);
  chimney.translate(0.15, 0.58, -0.15);
  tagPart(chimney, PART_WALL);
  // Utility shed
  const shed = new THREE.BoxGeometry(0.18, 0.16, 0.2);
  shed.translate(0.26, 0.08, 0.2);
  tagPart(shed, PART_WALL);
  return mergeGeometries([body, chimney, shed])!;
}

function makeIndV2(): THREE.BufferGeometry {
  // Warehouse + loading dock area
  const body = new THREE.BoxGeometry(0.55, 0.28, 0.5);
  body.translate(0, 0.14, -0.05);
  tagPart(body, PART_WALL);
  const dock = new THREE.BoxGeometry(0.3, 0.06, 0.15);
  dock.translate(0, 0.03, 0.28);
  tagPart(dock, PART_WALL);
  return mergeGeometries([body, dock])!;
}

function makeIndV3(): THREE.BufferGeometry {
  // Double chimney factory + yard wall
  const body = new THREE.BoxGeometry(0.48, 0.32, 0.42);
  body.translate(0, 0.16, 0);
  tagPart(body, PART_WALL);
  const ch1 = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6);
  ch1.translate(-0.12, 0.495, -0.12);
  tagPart(ch1, PART_WALL);
  const ch2 = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
  ch2.translate(0.12, 0.47, -0.12);
  tagPart(ch2, PART_WALL);
  // Compound wall
  const wall = new THREE.BoxGeometry(0.5, 0.1, 0.03);
  wall.translate(0, 0.05, 0.26);
  tagPart(wall, PART_WALL);
  return mergeGeometries([body, ch1, ch2, wall])!;
}

// -- Office --

function makeOfficeV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 1.0, 0.5);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const antenna = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4);
  antenna.translate(0, 1.1, 0);
  tagPart(antenna, PART_ROOF);
  return mergeGeometries([body, antenna])!;
}

function makeOfficeV2(): THREE.BufferGeometry {
  const b1 = new THREE.BoxGeometry(0.6, 0.5, 0.6);
  b1.translate(0, 0.25, 0);
  tagPart(b1, PART_WALL);
  const b2 = new THREE.BoxGeometry(0.45, 0.4, 0.45);
  b2.translate(0, 0.7, 0);
  tagPart(b2, PART_WALL);
  const b3 = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  b3.translate(0, 1.05, 0);
  tagPart(b3, PART_ROOF);
  return mergeGeometries([b1, b2, b3])!;
}

function makeOfficeV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.65, 0.8, 0.5);
  body.translate(0, 0.4, 0);
  tagPart(body, PART_WALL);
  const equip = new THREE.BoxGeometry(0.2, 0.1, 0.15);
  equip.translate(0.15, 0.85, 0.1);
  tagPart(equip, PART_ROOF);
  return mergeGeometries([body, equip])!;
}

// ===== Variant Registry =====
type GeoBuilder = () => THREE.BufferGeometry;

/**
 * 就地把幾何的 x/z 包圍盒置中。y 不動 —— 建築要站在地面上。
 *
 * 單邊外凸的幾何會浪費另一側的餘裕：makeResHighV3 的 z 是 −0.25 ~ +0.43，
 * 寬度 0.68 但最大半距 0.43，等比縮放到「寬度 0.68 格」之後那一側仍在
 * 0.43，再乘抖動就是 0.594 —— 越過格子邊界吃進鄰居（BUG-222）。
 */
export function centreFootprint(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  geo.translate(-(b.max.x + b.min.x) / 2, 0, -(b.max.z + b.min.z) / 2);
  geo.computeBoundingBox();
}

/**
 * 所有變體都經過置中。包在註冊表這一層而不是每個 builder 各自呼叫，
 * 新增變體時才不會漏掉。
 */
function centred(build: GeoBuilder): GeoBuilder {
  return () => {
    const geo = build();
    centreFootprint(geo);
    return geo;
  };
}

const VARIANTS: Record<number, GeoBuilder[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [makeResLowV1, makeResLowV2, makeResLowV3],
  [ZoneType.RESIDENTIAL_HIGH]: [makeResHighV1, makeResHighV2, makeResHighV3],
  [ZoneType.COMMERCIAL_LOW]:   [makeComLowV1, makeComLowV2, makeComLowV3],
  [ZoneType.COMMERCIAL_HIGH]:  [makeComHighV1, makeComHighV2],
  [ZoneType.INDUSTRIAL]:       [makeIndV1, makeIndV2, makeIndV3],
  [ZoneType.OFFICE]:           [makeOfficeV1, makeOfficeV2, makeOfficeV3],
};
for (const key of Object.keys(VARIANTS)) {
  VARIANTS[Number(key)] = VARIANTS[Number(key)]!.map(centred);
}

export type { GeoBuilder };

/** 有建築的分區。ZoneType.NONE 不在內。 */
export const ZONE_TYPES: number[] = Object.keys(VARIANTS).map(Number);

export const LEVELS = [1, 2, 3] as const;

/** 三角形上限。展示區的計數器照這兩條線標示。 */
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
  /** 地面物件另外計算：它是獨立圖層，不佔量體的預算。 */
  PROP: 240,
} as const;

/**
 * 這個 (分區, 等級) 桶的變體清單。
 *
 * `level` 目前收下但不使用 —— 每個等級回傳同一份清單。第二階段會讓
 * (分區, 等級) 各有自己的一組變體；先把參數開出來，呼叫端就不必再改一次。
 */
export function getVariants(zoneType: number, level: number): GeoBuilder[] {
  void level;
  return VARIANTS[zoneType] ?? [];
}

// ===== Height ranges per zone =====

export type Density = 'LOW' | 'HIGH';

/** 高度表的 key：分區加密度。辦公區兩種密度差 11 倍人口（BUG-220）。 */
export function heightKey(zoneType: number, density: Density): string {
  return `${zoneType}:${density}`;
}

/**
 * 每個 (分區, 密度) 三個等級的目標高度，單位是**公尺**。
 *
 * 由容納人口推導（樓層 3 m、工業 6 m；佔地率 低密度 60% / 高密度 85% /
 * 工業 70%；每人樓地板 住宅低 35、住宅高 28、商業 30、工業 40、辦公 15 m2）。
 *
 * 低密度照實算。高密度壓縮：320 人塞進 144 m2 的一格是現實的三倍密度，
 * 照實算 L3 高層住宅要 220 m、比基地寬 18 倍，一整區會像針床。
 * 壓縮之後高密度建築的視覺密度低於它實際容納的人口 —— 這是刻意接受的取捨，
 * 要讓兩者一致該改的是遊戲的人口數值，不是渲染（規格修訂 1）。
 *
 * 高密度下修過兩輪：30/51/75 -> 22/36/52 -> 22/32/42（住宅高，其餘同步）。
 * 第二輪只壓 L2 與 L3，L1 維持不動，因為過高的觀感集中在頂端等級。
 * 住宅低與商業低三輪都不動 —— 它們本來就是照實算的。
 *
 * 低密度辦公上修 9/15/24 -> 12/18/24：9 m 的辦公樓在高密度旁邊顯得發育不良。
 * L3 停在 24 m 是有意的 —— 辦公低 L3 是 50 人、辦公高 L1 是 160 人，
 * 讓前者更高會把階梯倒過來。
 *
 * 工業三個等級一起下修（8/12/16 -> 7/10/13 -> 6/7.5/9）並把基地拉到上限。
 * 現代廠房幾乎都是單層挑高、鋪滿基地，多層工廠很少見，所以工業的等級階梯
 * 不該表現在高度上 —— 它應該表現在煙囪、筒倉、管架、貨櫃這些設備上，
 * 那是階段 2C 屋頂與地面物件的工作。
 */
export const TARGET_HEIGHTS_M: Record<string, [number, number, number]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   [5, 7, 10],
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [22, 32, 42],
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    [5, 8, 12],
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  [18, 27, 36],
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        [6, 7.5, 9],
  [heightKey(ZoneType.OFFICE, 'LOW')]:            [12, 18, 24],
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           [24, 36, 48],
};

interface Measured {
  height: number;
  width: number;
  /** 離格心的最大距離。置中的幾何等於 width/2，沒置中的會更大。 */
  maxAbs: number;
}

/** 未縮放幾何的量測快取，避免每次放建築都重算包圍盒。 */
const measureCache = new Map<string, Measured>();

function measure(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Measured {
  const key = `${zoneType}:${density}:${level}:${variantIndex}`;
  const cached = measureCache.get(key);
  if (cached) return cached;

  const variants = getVariants(zoneType, level);
  if (variants.length === 0) {
    const zero = { height: 0, width: 0, maxAbs: 0 };
    measureCache.set(key, zero);
    return zero;
  }
  const geo = variants[variantIndex % variants.length]!();
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  // 用兩軸中較大的一個：等比縮放才不會把長方形壓成別的比例，
  // 而且較大的那一軸才是會不會撞出格子的那一軸。
  //
  // maxAbs 與 width/2 分開量：兩者只有在幾何置中時才相等，而「假設已置中」
  // 正是 BUG-222 的第二個根因。量真的距離，上限就不會依賴另一個檔案的行為。
  const out = {
    height: b.max.y,
    width: Math.max(b.max.x - b.min.x, b.max.z - b.min.z),
    maxAbs: Math.max(
      Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
    ),
  };
  geo.dispose();
  measureCache.set(key, out);
  return out;
}

/** 這個變體未經縮放時，離格心的最大距離（world unit）。 */
export function variantMaxAbsUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return measure(zoneType, density, level, variantIndex).maxAbs;
}

/** 這個變體未經縮放時有多高（world unit）。 */
export function variantHeightUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return measure(zoneType, density, level, variantIndex).height;
}

/** 這個變體未經縮放時最寬的那一軸有多寬（world unit）。 */
export function variantWidthUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return measure(zoneType, density, level, variantIndex).width;
}

/**
 * 每個 (分區, 密度) 的目標基地寬度，單位是**公尺**（格子寬 12 m）。
 *
 * 上限是 `MAX_BUILDING_WIDTH_M` —— 行人的門與走道節點放在建築牆面外側，
 * 超過就會讓行人走進建築裡面。那個常數與 SidewalkGraph 共用。
 *
 * 建築原本一律 7-8 m 寬、只佔格子 60%，所以 42 m 的高層住宅是 5.5:1 的
 * 細針 —— 看起來「太高」有一半是因為太瘦。真實的高層幾乎鋪滿基地。
 *
 * 低密度維持 60%：那些留白是院子、車道與樹的位置，填滿反而失真。
 *
 * 住宅低 7.2 -> 6.0：7.2 量的是「房子 + 車庫 + 樹」的包圍盒，房子本體只佔
 * 4.3 m。庭院物件搬進獨立圖層之後若仍以 7.2 為目標，房子本體會被放大到
 * 7.2 m、庭院只剩 0.76 m —— 觀感會反過來變成房子變大院子變小。6.0 讓房子
 * 維持接近原本的視覺量體，庭院帶則有 1.45 m（見 groundProps.yardRing）。
 */
export const TARGET_WIDTHS_M: Record<string, number> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   6.0,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: MAX_BUILDING_WIDTH_M,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    8.4,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  MAX_BUILDING_WIDTH_M,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        MAX_BUILDING_WIDTH_M,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            8.4,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           MAX_BUILDING_WIDTH_M,
};

/** 建築（含所有外掛零件）離格心的最大距離。行人的門節點就在它外側。 */
const HALF_ENVELOPE_UNITS = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/**
 * 逐實例寬深抖動的範圍，分「向下」與「向上」。
 *
 * 向上抖動會把建築推出行人包絡線，所以**目標寬度已經等於上限的分區向上為 0**。
 * 這不是把變化拿掉：向下保留 15%，鋪滿基地的分區仍會有偏瘦的個體，只是沒有
 * 偏胖的。真正的變化來源是量體變體，不是隨機拉寬。
 *
 * 另一種寫法是保留 ±15% 並讓上限去咬，但那會把高密度的平均寬度從 9.8 壓到
 * 9.33 m —— 等於偷偷改掉已經確認過的比例。取消向上抖動之後，`wanted` 與
 * `ceiling` 剛好相等，上限退化成安全網，每個尺寸都原封不動。
 */
export const WIDTH_JITTER: Record<string, { down: number; up: number }> = {};
for (const [key, target] of Object.entries(TARGET_WIDTHS_M)) {
  WIDTH_JITTER[key] = target >= MAX_BUILDING_WIDTH_M
    ? { down: 0.15, up: 0 }
    : { down: 0.15, up: 0.15 };
}

export function widthJitterFor(
  zoneType: number, density: Density,
): { down: number; up: number } {
  return WIDTH_JITTER[heightKey(zoneType, density)] ?? { down: 0, up: 0 };
}

/**
 * 基地縮放的全部算術，與尺寸表和幾何量測解耦。
 *
 * 抽成純函式是為了讓上限本身能被測到：現行的尺寸表裡 `wanted` 永遠先咬，
 * 上限退化成護欄 —— 護欄只有在有人日後把目標寬度調過頭時才作用，
 * 而那正是 BUG-222 發生的方式。沒有這個入口，就沒有辦法測它。
 *
 * @param targetM     目標寬度（公尺）
 * @param unitsWide   未縮放幾何的包圍盒寬度（格）
 * @param maxAbsUnits 未縮放幾何離格心的最大距離（格）。置中者等於寬度的一半
 * @param jitter01    [0, 1) 的原始亂數
 */
export function footprintScaleFrom(
  targetM: number, unitsWide: number, maxAbsUnits: number,
  jitter: { down: number; up: number }, jitter01: number,
): number {
  if (unitsWide <= 0) return 1;
  const wanted = targetM / (unitsWide * METRES_PER_CELL);
  // 上限用「離格心的最大距離」而不是包圍盒寬度 —— 用寬度只保證「不超過
  // 一格」（半寬 0.5），而行人的門節點在 0.4083 外側；非置中的幾何還會
  // 單邊外凸。兩者合起來就是 BUG-222。
  const ceiling = maxAbsUnits > 0
    ? HALF_ENVELOPE_UNITS / (maxAbsUnits * (1 + jitter.up))
    : Infinity;
  const base = Math.min(wanted, ceiling);
  return base * (1 - jitter.down + jitter01 * (jitter.down + jitter.up));
}

/**
 * 要把這個變體的基地縮放到目標寬度該乘多少。`jitter01` 是 [0, 1) 的原始
 * 亂數，省略時取正中間。
 *
 * 抖動範圍在這裡展開而不是在 BuildingAppearance 裡：容不容得下抖動是分區
 * 與包絡線的問題，不是亂數的問題。兩件事分開放，改了一邊不會有東西報錯
 * —— BUG-222 就是這樣發生的。
 */
export function footprintScaleFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
  jitter01 = 0.5,
): number {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return 1;
  return footprintScaleFrom(
    target,
    variantWidthUnits(zoneType, density, level, variantIndex),
    variantMaxAbsUnits(zoneType, density, level, variantIndex),
    widthJitterFor(zoneType, density),
    jitter01,
  );
}

/**
 * 這個變體抖到最寬時，離格心的最大距離（格）。
 *
 * 測試與庭院帶都靠它 —— 「建築讓出了多少空間」正是這個數字的補數。
 * 用實際量到的 maxAbs 而不是 width/2：後者等於預設幾何已經置中，
 * 那樣這個函式就無法察覺「忘了置中」這個情形。
 */
export function footprintEnvelopeUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return variantMaxAbsUnits(zoneType, density, level, variantIndex)
    * footprintScaleFor(zoneType, density, level, variantIndex, 1);
}

/**
 * 要把這個變體縮放到目標高度該乘多少。
 *
 * 兩個高度不同的幾何要縮放到同一個目標，係數必須不同 —— 這正是「目標高度」
 * 與舊的「縮放係數」的差別。
 */
export function heightScaleFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  const target = TARGET_HEIGHTS_M[heightKey(zoneType, density)];
  if (!target) return 1;
  const units = variantHeightUnits(zoneType, density, level, variantIndex);
  if (units <= 0) return 1;
  const lv = Math.max(1, Math.min(3, level));
  return target[lv - 1]! / (units * METRES_PER_CELL);
}

/**
 * 變體桶的完整識別。分區、密度、等級、變體序號四個維度缺一不可：
 * 少了密度，辦公區 15 人與 160 人的建築同桶（BUG-220）；
 * 少了等級，升級只能靠縮放。
 */
export function bucketKey(
  zoneType: number, density: Density, level: number, variantIndex: number,
): string {
  return `${zoneType}_${density}_${level}_${variantIndex}`;
}
