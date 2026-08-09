import { ZoneType } from '../../../../core/grid/types';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  shedWithStack, siloRow,
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

/**
 * 各分區的原型。**不對稱的排前面** —— 這不是風格，是算術：
 *
 * `prototypeFor` 用 `variantIndex % 可用原型數` 輪流取，而變體數 8 通常不是
 * 原型數的倍數。繞回來的那幾個一定落在清單**開頭**，所以開頭放什麼決定了
 * 不對稱變體的實際比例。對稱的排前面時，住宅高 L2（六個原型）只湊得出 3/8，
 * 低於 4/8 的驗收線。
 */
const TABLE: Record<number, Prototype[]> = {
  [ZoneType.RESIDENTIAL_LOW]: [
    p('house+garage', 1, mainPlusWing(0.4, 0.5)),
    p('gable', 1, d => single(d)),
    p('L-house', 2, lShape(0.55)),
    p('porch', 2, mainPlusWing(0.28, 0.32)),
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('L-tower', 1, lShape(0.6)),
    p('slab', 1, d => single(d)),
    p('podium', 1, PODIUM),
    p('twin', 2, twin(0.24)),
    p('setback', 2, setback(3)),
  ],
  [ZoneType.COMMERCIAL_LOW]: [
    p('shopfront', 1, splitSpan(0.55)),
    p('box', 1, d => single(d)),
    p('L-shop', 2, lShape(0.58)),
    p('shop+annex', 2, mainPlusWing(0.35, 0.6)),
    p('courtyard', 3, notch(0.34)),
  ],
  [ZoneType.COMMERCIAL_HIGH]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('podium', 1, PODIUM),
    p('L-tower', 2, lShape(0.6)),
    p('setback', 2, setback(3)),
    p('twin', 3, twin(0.22)),
  ],
  /**
   * 工業的等級階梯不表現在高度上（現代廠房都是單層挑高、鋪滿基地，見
   * `TARGET_HEIGHTS_M`），所以少了設備，工業就只是一個比較矮的商業盒子。
   *
   * 帶設備的三個排最前面 —— 理由與「不對稱排前面」相同，但這裡的門檻更緊：
   * 驗收要 4/8 個變體看得見煙囪或筒倉，而 8 除以原型數的餘數一律落在
   * 清單開頭。L3 有七個原型，只有第一個拿得到兩個變體，所以帶設備的
   * 三個必須是前三個。
   */
  [ZoneType.INDUSTRIAL]: [
    p('stack', 1, shedWithStack(0.18, 0.62, 'cylinder')),
    p('silos', 1, siloRow(3, 0.24, 0.5)),
    p('tank', 2, shedWithStack(0.34, 0.5, 'cylinder')),
    p('shed+office', 1, mainPlusWing(0.32, 0.75)),
    p('twoSpan', 2, splitSpan(0.6)),
    p('L-shed', 3, lShape(0.6)),
    p('shed', 1, d => single(d)),
  ],
  [ZoneType.OFFICE]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('slab', 1, d => single(d)),
    p('L-tower', 2, lShape(0.6)),
    p('podium', 2, PODIUM),
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
