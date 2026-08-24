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

/** Reads vertex i's aBldgColor. */
function colorAt(geo: ReturnType<typeof assembleCivic>, i: number): [number, number, number] {
  const a = geo.getAttribute('aBldgColor');
  return [a.getX(i), a.getY(i), a.getZ(i)];
}

/**
 * Civic buildings' representative colours.
 *
 * Each type carries its own colour — indigo 0x3f51b5 for police, red 0xd32f2f for fire, and so on
 * — and that is the primary signal a player identifies them by. In an isometric view, telling an
 * L from two wings takes zooming a long way in, while the colour is clear at a glance.
 */
describe('每一種公共建築都有代表色', () => {
  it('should define a colour for every infra type', () => {
    // A missing type falls back to the default grey, and a grey fire station looks unfinished.
    for (const cfg of INFRA_CONFIGS) {
      expect(CIVIC_COLORS[cfg.type], `${cfg.type} 沒有代表色`).toBeDefined();
    }
  });

  it('should keep every channel in [0, 1]', () => {
    // The shader multiplies it straight into the lighting; out of range it overexposes or goes
    // negative and turns black.
    for (const [type, c] of Object.entries(CIVIC_COLORS)) {
      for (const [i, v] of c.entries()) {
        expect(v, `${type} 的第 ${i} 個通道是 ${v}`).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  /** Police blue and fire red: the two anchors of the whole palette. */
  it('should make the police station blue and the fire station red', () => {
    const [pr, pg, pb] = CIVIC_COLORS.police!;
    expect(pb, '警局不是藍的').toBeGreaterThan(pr);
    expect(pb, '警局不是藍的').toBeGreaterThan(pg);

    const [fr, fg, fb] = CIVIC_COLORS.fire!;
    expect(fr, '消防局不是紅的').toBeGreaterThan(fg);
    expect(fr, '消防局不是紅的').toBeGreaterThan(fb);
  });

  it('should keep the other signature colours the old models established', () => {
    // Players recognise these colours already, and replacing them resets recognition to zero.
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
    // At the same colour a player cannot tell a police station from a fire station, which is the
    // whole reason representative colours exist. Only the everyday-services group is compared:
    // utilities are meant to be a field of industrial grey.
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
   * Per-mass colour overrides: a hospital's red cross, a university's gold dome.
   *
   * With one colour per building these accents could only match the walls, and they are exactly
   * what makes a hospital recognisable at a glance. The override lives on the mass rather than in
   * a separate layer, because it is part of the mass.
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
