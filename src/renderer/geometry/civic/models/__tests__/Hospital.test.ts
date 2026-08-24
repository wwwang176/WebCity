import { describe, it, expect } from 'vitest';
import { hospitalPlan } from '../hospital';
import {
  FACADE_CIVIC, PART_GROUND, PART_LAMP, PART_ROOF,
} from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicVolume } from '../../types';

const plan = hospitalPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;

/** A mass's front and back edges; the larger z is the front. */
const front = (v: CivicVolume) => v.z + v.d / 2;
const back = (v: CivicVolume) => v.z - v.d / 2;

/**
 * The shared acceptance checks live in the table in `CivicPlans.test.ts`. This file holds only the
 * shape constraints specific to a hospital.
 *
 * Recognition features: a main block with two wings and a link, a **rooftop helipad** with its H
 * marking and perimeter lights, and the emergency canopy. The helipad is the strongest — no other
 * building in the city has one on its roof.
 */
describe('醫院', () => {
  it('should occupy 2x3', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
  });

  it('should be medical white', () => {
    expect(plan.color).toEqual(civicColorOf('hospital'));
    const [r, g, b] = plan.color;
    expect(Math.min(r, g, b), '主體不夠亮').toBeGreaterThan(0.8);
    expect(Math.max(r, g, b) - Math.min(r, g, b), '醫療白要中性，不能偏色')
      .toBeLessThan(0.06);
  });

  it('should stand the main block over the wings', () => {
    // The main block has to be clearly taller than the wings, or the whole thing reads as one
    // slab at a single height.
    const main = one('main');
    const wings = tagged('wing');
    expect(wings.length, '側翼不是兩支').toBe(2);
    for (const w of wings) {
      expect(main.y1 / w.y1, '主樓沒有明顯高過側翼').toBeGreaterThan(1.5);
    }
  });

  it('should mirror the two wings about the centre line', () => {
    // Asymmetric wings read as an extension. A hospital is symmetric.
    const [a, b] = tagged('wing').sort((p, q) => p.x - q.x);
    expect(a!.x, '兩翼沒有對稱').toBeCloseTo(-b!.x, 9);
    expect(a!.w).toBeCloseTo(b!.w, 9);
    expect(a!.y1).toBeCloseTo(b!.y1, 9);
  });

  /**
   * The link has to **actually meet** both ends.
   *
   * A few centimetres short and it is a corridor floating with neither end attached, which is
   * entirely legal in the data table: no overrun, no overlap, no budget exceeded.
   */
  it('should bridge the main block to the wings', () => {
    const link = one('corridor');
    const main = one('main');
    const wings = tagged('wing');
    expect(back(link), '連廊沒有接上主樓').toBeCloseTo(front(main), 9);
    for (const w of wings) {
      expect(front(link), '連廊沒有接上側翼').toBeCloseTo(back(w), 9);
    }
    // And it has to land in the gap between the two wings.
    const [a, b] = wings.sort((p, q) => p.x - q.x);
    expect(link.x - link.w / 2).toBeGreaterThanOrEqual(a!.x - a!.w / 2 - 1e-9);
    expect(link.x + link.w / 2).toBeLessThanOrEqual(b!.x + b!.w / 2 + 1e-9);
  });

  it('should keep the corridor low so the wings still read as separate', () => {
    // Level with the wings, the three masses merge into one large box.
    const link = one('corridor');
    for (const w of tagged('wing')) {
      expect(link.y1, '連廊太高，兩翼併成一塊了').toBeLessThan(w.y1 * 0.65);
    }
  });

  // ── The helipad ───────────────────────────────────────────

  it('should put a helipad on the main roof', () => {
    const pad = one('helipad');
    const roof = one('mainRoof');
    expect(pad, '沒有直升機坪').toBeTruthy();
    expect(pad.part, '停機坪不是鋪面 —— 它會長出窗戶或吃到屋頂色票')
      .toBe(PART_GROUND);
    expect(pad.y0, '停機坪沒有站在屋頂上').toBeGreaterThanOrEqual(roof.y1 - 1e-9);
    // The pad may not overhang the roof's boundary.
    expect(pad.x - pad.w / 2).toBeGreaterThanOrEqual(roof.x - roof.w / 2 - 1e-9);
    expect(pad.x + pad.w / 2).toBeLessThanOrEqual(roof.x + roof.w / 2 + 1e-9);
  });

  it('should size the helipad for an actual helicopter', () => {
    // A helipad's minimum edge is roughly the rotor diameter, about 11 m for a medium air
    // ambulance.
    const pad = one('helipad');
    expect(m(Math.min(pad.w, pad.d)), '停機坪小到停不了直升機')
      .toBeGreaterThan(9);
  });

  it('should paint an H on the pad', () => {
    // The H is a helipad's only identification. Without it the pad is a dark square on a roof.
    const bars = tagged('helipadH');
    expect(bars.length, 'H 不是三劃').toBe(3);
    const pad = one('helipad');
    for (const bar of bars) {
      expect(bar.part, 'H 不是鋪面').toBe(PART_GROUND);
      expect(bar.shade ?? 0, 'H 沒有比甲板亮 —— 看不出來')
        .toBeGreaterThan((pad.shade ?? 0) + 0.4);
      expect(bar.y0, 'H 沒有畫在甲板上').toBeGreaterThanOrEqual(pad.y1 - 1e-9);
    }
  });

  it('should ring the pad with lights, not dot the middle of it', () => {
    // The pad's lights run along its edges; in the middle, a helicopter would land on them.
    const lights = tagged('padLight');
    const pad = one('helipad');
    expect(lights.length, '停機坪周邊燈太少').toBeGreaterThanOrEqual(4);
    for (const l of lights) {
      expect(l.part, '停機坪的燈不會亮').toBe(PART_LAMP);
      const nx = Math.abs(l.x - pad.x) / (pad.w / 2);
      const nz = Math.abs(l.z - pad.z) / (pad.d / 2);
      expect(Math.max(nx, nz), '有一盞燈站在停機坪中間').toBeGreaterThan(0.6);
      expect(Math.max(nx, nz), '有一盞燈掉出停機坪外').toBeLessThanOrEqual(1);
    }
  });

  // ── Emergency ─────────────────────────────────────────────

  it('should shelter the ambulance bay', () => {
    const canopy = plan.overhead.find(v => v.tag === 'erCanopy')!;
    expect(canopy, '急診沒有雨棚').toBeTruthy();
    // An ambulance is 3.7 x 1.5 x 1.6 m. Unable to cover one, the canopy is only decoration.
    expect(m(canopy.d), '急診雨棚太淺').toBeGreaterThan(3.5);
    expect(m(canopy.w), '急診雨棚太窄').toBeGreaterThan(6);
  });

  it('should mark the emergency entrance with its own colour', () => {
    // An emergency entrance cannot be found on a medical-white box. The red band says "this
    // way".
    const band = one('erBand');
    expect(band.color, '急診帶沒有自己的顏色').toBeTruthy();
    const [r, g, b] = band.color!;
    expect(r, '急診帶不夠紅').toBeGreaterThan(0.5);
    expect(r).toBeGreaterThan(Math.max(g, b) * 1.5);
    expect(band.color).not.toEqual(plan.color);
  });

  it('should light a cross over the emergency entrance', () => {
    // At night it is the one thing on a hospital recognisable at a glance.
    const bars = tagged('cross');
    expect(bars.length, '十字不成形').toBeGreaterThanOrEqual(3);
    for (const bar of bars) expect(bar.part, '十字不會亮').toBe(PART_LAMP);
    // The cross belongs on the emergency band's side, not at the other end.
    const band = one('erBand');
    for (const bar of bars) {
      expect(Math.sign(bar.x), '十字掛在急診的另一邊').toBe(Math.sign(band.x));
    }
  });

  it('should park real ambulances at the bay', () => {
    const ambulances = plan.vehicles.filter(v => v.kind === 'ambulance');
    expect(ambulances.length, '急診門口沒有救護車').toBeGreaterThanOrEqual(2);
    // The ambulance parks on the emergency side rather than in the staff bays.
    const band = one('erBand');
    for (const a of ambulances) {
      expect(Math.sign(a.x), '救護車停到大門那一側去了').toBe(Math.sign(band.x));
    }
  });

  /**
   * Every mass is capped with a roof, and a **white** one.
   *
   * Without a roof piece, a mass falls to the automatic `n.y > 0.85` test: it gets the roof
   * palette but has no eaves, and its edges are cut square.
   *
   * And getting the roof palette is exactly why a hospital does not read as white: the civic
   * group's palette is dark asphalt, with even its brightest entry at 0.38, so a white-walled
   * hospital seen from an isometric view is dark grey. A hospital's roofs take `PART_GROUND` with
   * a high brightness so the colour is decided by the building itself, and this case guards that
   * nobody has switched them back to the shared palette.
   */
  it('should cap every block with a white roof', () => {
    for (const tag of ['main', 'wing', 'corridor']) {
      expect(tagged(`${tag}Roof`).length, `${tag} 沒有屋頂`)
        .toBe(tagged(tag).length);
      for (const r of tagged(`${tag}Roof`)) {
        expect(r.part, `${tag}Roof 走回共用屋頂色票 —— 那組是深瀝青`)
          .toBe(PART_GROUND);
        expect(r.shade, `${tag}Roof 不夠白`).toBeGreaterThan(0.8);
      }
    }
    // And no genuine `PART_ROOF` piece may slip in: one dark grey canopy on a white hospital
    // becomes the most conspicuous thing on it.
    for (const v of [...plan.massing, ...plan.props, ...plan.overhead]) {
      expect(v.part, `${v.tag} 是深色屋頂`).not.toBe(PART_ROOF);
    }
  });

  it('should stay at a believable height for a hospital', () => {
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(22);
    expect(top).toBeLessThan(34);
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    expect(new Set(plan.props.map(v => v.tag)), '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['bayLamp']));
  });
});
