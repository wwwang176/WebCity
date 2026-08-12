import { describe, it, expect } from 'vitest';
import { CIVIC_COLORS, civicColorOf } from '../colors';
import { getCivicPlan, civicTypesDone } from '../registry';
import { assembleCivic } from '../assemble';
import { INFRA_CONFIGS, type InfraType } from '../../../../core/building/InfraConfig';
import type { CivicVolume } from '../types';

const FOOT = { w: 2, h: 2 };
const GREY = [0.7, 0.7, 0.7] as const;

const box = (o: Partial<CivicVolume> = {}): CivicVolume =>
  ({ x: 0, z: 0, w: 0.5, d: 0.5, y0: 0, y1: 0.5, ...o });

/** 讀第 i 個頂點的 aBldgColor。 */
function colorAt(geo: ReturnType<typeof assembleCivic>, i: number): [number, number, number] {
  const a = geo.getAttribute('aBldgColor');
  return [a.getX(i), a.getY(i), a.getZ(i)];
}

/**
 * 公共建築的代表色。
 *
 * 舊版的手寫模型每一種都有自己的顏色（警局靛藍 0x3f51b5、消防局紅
 * 0xd32f2f……），而那是玩家辨認它們的主要訊號 —— 等角視角下，剪影要縮到
 * 很小才分得出 L 形與雙翼，顏色卻一眼就看得出來。
 */
describe('每一種公共建築都有代表色', () => {
  it('should define a colour for every infra type', () => {
    // 少一種的話它會拿到預設灰，而「灰色的消防局」看起來像沒做完。
    for (const cfg of INFRA_CONFIGS) {
      expect(CIVIC_COLORS[cfg.type], `${cfg.type} 沒有代表色`).toBeDefined();
    }
  });

  it('should keep every channel in [0, 1]', () => {
    // shader 直接拿去乘光照，超出範圍會過曝或變成負值（黑）。
    for (const [type, c] of Object.entries(CIVIC_COLORS)) {
      for (const [i, v] of c.entries()) {
        expect(v, `${type} 的第 ${i} 個通道是 ${v}`).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  /** 警局藍、消防局紅 —— 這兩個是整組色票的錨點。 */
  it('should make the police station blue and the fire station red', () => {
    const [pr, pg, pb] = CIVIC_COLORS.police!;
    expect(pb, '警局不是藍的').toBeGreaterThan(pr);
    expect(pb, '警局不是藍的').toBeGreaterThan(pg);

    const [fr, fg, fb] = CIVIC_COLORS.fire!;
    expect(fr, '消防局不是紅的').toBeGreaterThan(fg);
    expect(fr, '消防局不是紅的').toBeGreaterThan(fb);
  });

  it('should keep the other signature colours the old models established', () => {
    // 玩家已經認得這些顏色，換掉等於把辨識度歸零。
    const hue = (t: InfraType) => CIVIC_COLORS[t]!;
    const [, hg, hb] = hue('hospital');
    expect(Math.min(hg, hb), '醫院不是白的').toBeGreaterThan(0.8);
    const [gr, gg, gb] = hue('park');
    expect(gg, '公園不是綠的').toBeGreaterThan(gr);
    expect(gg, '公園不是綠的').toBeGreaterThan(gb);
    const [sr, sg, sb] = hue('school');
    expect(sr, '小學不是褐的').toBeGreaterThan(sg);
    expect(sg, '小學不是褐的').toBeGreaterThan(sb);
  });

  it('should not give two civic services the same colour', () => {
    // 同色的話玩家分不出警局與消防局 —— 那正是代表色存在的理由。
    // 只比較民生服務那一組：公用設施本來就該是一片工業灰。
    const group: InfraType[] = ['police', 'fire', 'hospital', 'school', 'park', 'cemetery'];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = CIVIC_COLORS[group[i]!]!;
        const b = CIVIC_COLORS[group[j]!]!;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(dist, `${group[i]} 與 ${group[j]} 的顏色太接近（${dist.toFixed(3)}）`)
          .toBeGreaterThan(0.2);
      }
    }
  });

  it('should fall back to grey for an unknown type', () => {
    expect(civicColorOf('nope' as InfraType)).toEqual(GREY);
  });
});

describe('顏色要真的寫進幾何', () => {
  it('should stamp the base colour on every vertex', () => {
    const geo = assembleCivic([box()], FOOT, [0.2, 0.3, 0.8]);
    const a = geo.getAttribute('aBldgColor');
    expect(a, '沒有 aBldgColor —— shader 會拿到 0，整棟是黑的').toBeTruthy();
    expect(a.count).toBe(geo.getAttribute('position').count);
    for (let i = 0; i < a.count; i++) {
      expect(colorAt(geo, i)[2]).toBeCloseTo(0.8, 6);
    }
  });

  /**
   * 逐量體的顏色覆寫 —— 醫院的紅十字、大學的金頂。
   *
   * 一棟建築只有一個顏色的話，這些重點只能跟牆同色，而它們正是「一眼認出
   * 這是醫院」的東西。覆寫寫在量體上而不是另外一層：它就是量體的一部分。
   */
  it('should let a single volume override the colour', () => {
    const geo = assembleCivic(
      [box({ x: -0.3 }), box({ x: 0.3, color: [1, 0, 0] })],
      FOOT, [0.2, 0.3, 0.8],
    );
    const seen = new Set<string>();
    const a = geo.getAttribute('aBldgColor');
    for (let i = 0; i < a.count; i++) seen.add(colorAt(geo, i).map(v => v.toFixed(3)).join(','));
    expect(seen.size, '覆寫沒有生效，或蓋掉了整棟').toBe(2);
    expect(seen.has('1.000,0.000,0.000'), '找不到被覆寫的那一塊').toBe(true);
  });

  it('should give every registered plan a colour', () => {
    for (const type of civicTypesDone()) {
      const plan = getCivicPlan(type)!;
      expect(plan.color, `${type} 的 plan 沒有顏色`).toBeDefined();
      expect(plan.color).toEqual(CIVIC_COLORS[type]);
    }
  });
});
