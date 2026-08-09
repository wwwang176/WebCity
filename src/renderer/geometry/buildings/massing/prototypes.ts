import { ZoneType } from '../../../../core/grid/types';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  type Composer,
} from './composers';

/**
 * 一個量體原型 = 組合器 + 參數 + 最低等級。
 *
 * `minLevel` 是等級外型差異的全部機制：L1 只拿得到簡單的，L3 全開。不必另外
 * 為每個等級寫一套形狀。
 */
export interface Prototype {
  name: string;
  minLevel: number;
  compose: Composer;
}

const p = (name: string, minLevel: number, compose: Composer): Prototype =>
  ({ name, minLevel, compose });

/** 塔身置中的裙樓塔（對稱）。 */
const PODIUM = podiumTower(2, 0.66, 0);
/**
 * 塔身推到裙樓邊緣（不對稱）。
 *
 * 高密度分區在 L1 只有裙樓塔與板樓可用，兩個都是對稱的 —— 旋轉那四倍的變化
 * 就全白給了。所以這一個必須在 L1 就開放，它是那一格唯一的不對稱來源。
 */
const OFFSET_TOWER = podiumTower(2, 0.6, 0.9);

const TABLE: Record<number, Prototype[]> = {
  [ZoneType.RESIDENTIAL_LOW]: [
    p('gable', 1, d => single(d)),
    p('house+garage', 1, mainPlusWing(0.4, 0.5)),
    p('L-house', 2, lShape(0.55)),
    p('porch', 2, mainPlusWing(0.28, 0.32)),
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    p('slab', 1, d => single(d)),
    p('podium', 1, PODIUM),
    p('offsetTower', 1, OFFSET_TOWER),
    p('L-tower', 1, lShape(0.6)),
    p('setback', 2, setback(3)),
    p('twin', 2, twin(0.24)),
  ],
  [ZoneType.COMMERCIAL_LOW]: [
    p('box', 1, d => single(d)),
    p('shopfront', 1, splitSpan(0.55)),
    p('L-shop', 2, lShape(0.58)),
    p('shop+annex', 2, mainPlusWing(0.35, 0.6)),
    p('courtyard', 3, notch(0.34)),
  ],
  [ZoneType.COMMERCIAL_HIGH]: [
    p('podium', 1, PODIUM),
    p('offsetTower', 1, OFFSET_TOWER),
    p('setback', 2, setback(3)),
    p('L-tower', 2, lShape(0.6)),
    p('twin', 3, twin(0.22)),
  ],
  [ZoneType.INDUSTRIAL]: [
    p('shed', 1, d => single(d)),
    p('shed+office', 1, mainPlusWing(0.32, 0.75)),
    p('twoSpan', 2, splitSpan(0.6)),
    p('L-shed', 3, lShape(0.6)),
  ],
  [ZoneType.OFFICE]: [
    p('slab', 1, d => single(d)),
    p('offsetTower', 1, OFFSET_TOWER),
    p('podium', 2, PODIUM),
    p('L-tower', 2, lShape(0.6)),
    p('twin', 3, twin(0.24)),
    p('courtyard', 3, notch(0.3)),
  ],
};

const FALLBACK: Prototype = p('single', 1, d => single(d));

/** 這個 (分區, 等級) 可用的原型。 */
export function prototypesFor(zoneType: number, level: number): Prototype[] {
  const lv = Math.max(1, Math.min(3, level));
  return (TABLE[zoneType] ?? []).filter(x => x.minLevel <= lv);
}

/**
 * 這個變體用哪一個原型。依序輪流取，所以每個可用原型至少出現一次 ——
 * 隨機取會讓某些原型在某些桶裡從來不出現。
 */
export function prototypeFor(
  zoneType: number, level: number, variantIndex: number,
): Prototype {
  const ps = prototypesFor(zoneType, level);
  return ps.length === 0 ? FALLBACK : ps[variantIndex % ps.length]!;
}
