import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../core/grid/constants';
import {
  TARGET_WIDTHS_M, TRIANGLE_BUDGET, heightKey, widthJitterFor,
  type Density, type GeoBuilder,
} from './registry';
import { tagPart, PART_FOLIAGE, PART_DETAIL } from './parts';

/**
 * 地面物件圖層 —— 庭院裡不屬於建築的東西。
 *
 * 它存在的理由是 BUG-219：等級以 `makeScale(w, h, d)` 乘在整份合併幾何上，
 * 所以住宅低密度 L1 升到 L3 時，庭院的樹跟著被拉高 1.75 倍（1.44 -> 2.52 m）。
 * 樹不會因為房子加蓋而長高。搬出來之後這一層只吃旋轉與位置，高度與基地
 * 縮放都不套用 —— 樹在每個等級都是同一個真實尺寸。
 *
 * 幾何一律以**真實尺寸**撰寫（1 格 = 12 m），不再是「會被縮放的相對比例」。
 */

/** 建築（含所有外掛零件）離格心的最大距離。行人的門節點就在它外側。 */
const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 庭院帶窄於這個寬度就不放東西 —— 塞不下看得見的物件。 */
const MIN_RING_UNITS = 0.05;

export const PROP_TRIANGLE_BUDGET = TRIANGLE_BUDGET.PROP;

/** 公尺換算成格。 */
const M = (metres: number) => metres / METRES_PER_CELL;

export interface YardRing {
  /** 建築抖到最寬時的半寬。庭院物件必須在這之外。 */
  inner: number;
  /** 行人包絡線。庭院物件必須在這之內。 */
  outer: number;
}

/**
 * 建築讓出來的環帶。沒讓出空間的分區回傳 null。
 *
 * 內緣用「目標寬度 × 最大向上抖動」而不是某個變體的實際寬度：庭院物件是整個
 * (分區, 等級) 桶共用的，不能依賴這一格配到哪一個量體變體。
 *
 * 現況只有住宅低密度過得了這一關（1.45 m）；商業低與辦公低各只剩 0.07 m，
 * 高密度與工業是 0。這不是遺漏而是幾何事實 —— 鋪滿基地的建築沒有院子，
 * 它們的等級階梯要靠量體與屋頂物件表現。日後把商業低調窄，它會自動長出庭院。
 */
export function yardRing(zoneType: number, density: Density): YardRing | null {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return null;
  const inner = (target / METRES_PER_CELL / 2) * (1 + widthJitterFor(zoneType, density).up);
  if (HALF_ENVELOPE - inner < MIN_RING_UNITS) return null;
  return { inner, outer: HALF_ENVELOPE };
}

export function hasGroundProps(zoneType: number, density: Density, level: number): boolean {
  return getGroundPropVariants(zoneType, density, level).length > 0;
}

// ===== 零件 =====

/**
 * 沿著某一邊的連續帶狀物（樹籬、花台、矮牆）。
 *
 * `axis` 是這一段貼著哪一軸的邊，`sign` 是哪一側，`lengthFrac` 是佔那一邊
 * 多長。深度取環帶的 80%，兩側各留一點縫，免得抖動時貼死在牆上。
 */
function strip(
  ring: YardRing, axis: 'x' | 'z', sign: 1 | -1,
  lengthFrac: number, heightM: number, part: number,
): THREE.BufferGeometry {
  const mid = (ring.inner + ring.outer) / 2;
  const depth = (ring.outer - ring.inner) * 0.8;
  const len = ring.outer * 2 * lengthFrac;
  const h = M(heightM);
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(len, h, depth)
    : new THREE.BoxGeometry(depth, h, len);
  geo.translate(
    axis === 'x' ? sign * mid : 0,
    h / 2,
    axis === 'z' ? sign * mid : 0,
  );
  tagPart(geo, part);
  return geo;
}

/** 樹籬。 */
function hedge(ring: YardRing, axis: 'x' | 'z', sign: 1 | -1, lengthFrac: number, heightM: number) {
  return strip(ring, axis, sign, lengthFrac, heightM, PART_FOLIAGE);
}

/** 石砌花台／矮牆。標 PART_DETAIL 走金屬灰分支，不長窗戶也不變綠。 */
function planter(ring: YardRing, axis: 'x' | 'z', sign: 1 | -1, lengthFrac: number) {
  return strip(ring, axis, sign, lengthFrac, 0.4, PART_DETAIL);
}

/**
 * 柱狀樹（絲柏型）。
 *
 * 庭院帶只有 1.45 m 寬，球狀樹冠塞不下；柱狀的樹冠窄、可以往上長，是這個
 * 尺寸下唯一還像樹的選擇。樹冠半徑取環帶半寬的 90%，放在環帶中線上時
 * 內外都不越界。
 */
function columnarTree(
  ring: YardRing, sx: 1 | -1, sz: 1 | -1, heightM: number,
): THREE.BufferGeometry[] {
  const mid = (ring.inner + ring.outer) / 2;
  const r = ((ring.outer - ring.inner) / 2) * 0.9;
  const trunkH = M(heightM * 0.25);
  const crownH = M(heightM * 0.75);

  const trunk = new THREE.CylinderGeometry(M(0.09), M(0.12), trunkH, 5);
  trunk.translate(sx * mid, trunkH / 2, sz * mid);
  tagPart(trunk, PART_DETAIL); // 樹幹不是牆 —— 標 PART_WALL 會長出窗戶

  const crown = new THREE.ConeGeometry(r, crownH, 6);
  crown.translate(sx * mid, trunkH + crownH / 2, sz * mid);
  tagPart(crown, PART_FOLIAGE);
  return [trunk, crown];
}

/** 矮灌木叢。半徑上限同樣是環帶半寬。 */
function shrub(ring: YardRing, sx: 1 | -1, sz: 1 | -1, radiusM: number): THREE.BufferGeometry {
  const mid = (ring.inner + ring.outer) / 2;
  const r = Math.min(M(radiusM), ((ring.outer - ring.inner) / 2) * 0.95);
  const geo = new THREE.SphereGeometry(r, 5, 4);
  geo.translate(sx * mid, r, sz * mid);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}

// ===== 住宅低密度的庭院階梯 =====

/**
 * 規格修訂 4 的「周邊」欄：
 *
 *   L1 素土院子：兩段矮木柵 + 一叢灌木
 *   L2 樹籬與一棵樹：兩段樹籬 + 一棵柱狀樹 + 一叢灌木
 *   L3 修剪庭園：三面樹籬 + 兩棵柱狀樹 + 石砌花台 + 一叢灌木
 *
 * 每個等級兩個變體 —— 只有一種庭院的話，整條街的院子會一模一樣，
 * 等於把重複感從房子搬到院子。兩個變體之間換邊、換棵數，不換等級語彙。
 */
const RES_LOW = { zone: ZoneType.RESIDENTIAL_LOW, density: 'LOW' as Density };

function resLowRing(): YardRing {
  return yardRing(RES_LOW.zone, RES_LOW.density)!;
}

const RES_LOW_YARDS: Record<number, GeoBuilder[]> = {
  1: [
    () => {
      const r = resLowRing();
      return mergeGeometries([
        planter(r, 'z', 1, 0.55), planter(r, 'z', -1, 0.35), shrub(r, 1, -1, 0.55),
      ])!;
    },
    () => {
      const r = resLowRing();
      return mergeGeometries([
        planter(r, 'x', -1, 0.5), shrub(r, 1, 1, 0.6), shrub(r, -1, -1, 0.45),
      ])!;
    },
  ],
  2: [
    () => {
      const r = resLowRing();
      return mergeGeometries([
        hedge(r, 'z', 1, 0.9, 0.9), hedge(r, 'x', 1, 0.7, 0.8),
        ...columnarTree(r, -1, -1, 4.0), shrub(r, 1, -1, 0.5),
      ])!;
    },
    () => {
      const r = resLowRing();
      return mergeGeometries([
        hedge(r, 'z', -1, 0.9, 0.8), hedge(r, 'x', -1, 0.6, 0.9),
        ...columnarTree(r, 1, 1, 3.6), shrub(r, -1, 1, 0.55),
      ])!;
    },
  ],
  3: [
    () => {
      const r = resLowRing();
      return mergeGeometries([
        hedge(r, 'z', 1, 0.95, 1.0), hedge(r, 'x', 1, 0.9, 1.0), hedge(r, 'x', -1, 0.9, 1.0),
        ...columnarTree(r, -1, -1, 4.8), ...columnarTree(r, 1, -1, 4.2),
        planter(r, 'z', -1, 0.7), shrub(r, -1, 1, 0.6),
      ])!;
    },
    () => {
      const r = resLowRing();
      return mergeGeometries([
        hedge(r, 'z', -1, 0.95, 1.0), hedge(r, 'z', 1, 0.95, 0.9), hedge(r, 'x', 1, 0.85, 1.0),
        ...columnarTree(r, -1, 1, 5.0), ...columnarTree(r, -1, -1, 4.4),
        planter(r, 'x', -1, 0.6), shrub(r, 1, -1, 0.5),
      ])!;
    },
  ],
};

/**
 * 這個 (分區, 密度, 等級) 的庭院組合。沒有庭院帶就沒有庭院。
 */
export function getGroundPropVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  if (!yardRing(zoneType, density)) return [];
  if (zoneType === RES_LOW.zone && density === RES_LOW.density) {
    return RES_LOW_YARDS[Math.max(1, Math.min(3, level))] ?? [];
  }
  return [];
}
