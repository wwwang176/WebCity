import { describe, it, expect } from 'vitest';
import { universityPlan } from '../schoolUniv';
import { FACADE_CIVIC, PART_LAMP, PART_ROOF } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicVolume } from '../../types';

const plan = universityPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;

const x0 = (v: CivicVolume) => v.x - v.w / 2;
const x1 = (v: CivicVolume) => v.x + v.w / 2;
const z0 = (v: CivicVolume) => v.z - v.d / 2;
const z1 = (v: CivicVolume) => v.z + v.d / 2;

/**
 * The shared acceptance checks live in the table in `CivicPlans.test.ts`. This file holds only the
 * shape constraints specific to a university.
 *
 * Recognition features: a **quadrangle enclosed on all four sides**, a domed range, and a clock
 * tower. The quadrangle is the strongest — it is the city's only building that is hollow in the
 * middle.
 */
describe('大學', () => {
  const ranges = tagged('range');

  it('should occupy 3x3', () => {
    expect(plan.footprint).toEqual({ w: 3, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
    expect(plan.color).toEqual(civicColorOf('school_univ'));
  });

  /**
   * The quadrangle is **enclosed on all four sides**.
   *
   * Enclosed on three it is a U, reading as a building with a courtyard rather than a university.
   * Checked by rays: walking out from the quadrangle's centre in each of the four directions has
   * to hit a range first. Counting four ranges alone would pass four in a row.
   */
  it('should enclose the quadrangle on all four sides', () => {
    expect(ranges.length, '不是四棟').toBe(4);
    const spansX = (v: CivicVolume) => x0(v) < 0 && x1(v) > 0;
    const spansZ = (v: CivicVolume) => z0(v) < 0 && z1(v) > 0;
    const sides: Array<[string, (v: CivicVolume) => boolean]> = [
      ['+x（東）', v => x0(v) > 0 && spansZ(v)],
      ['−x（西）', v => x1(v) < 0 && spansZ(v)],
      ['+z（南）', v => z0(v) > 0 && spansX(v)],
      ['−z（北）', v => z1(v) < 0 && spansX(v)],
    ];
    for (const [name, blocks] of sides) {
      expect(ranges.some(blocks), `方庭的 ${name} 面沒有圍起來`).toBe(true);
    }
  });

  it('should leave the quadrangle open to the sky', () => {
    // Built up in the middle too, it is one large building rather than a quadrangle.
    for (const v of plan.massing) {
      const covers = x0(v) < 0 && x1(v) > 0 && z0(v) < 0 && z1(v) > 0;
      expect(covers, `${v.tag} 蓋在方庭上`).toBe(false);
    }
  });

  it('should join the ranges at the corners', () => {
    // With gaps between the four ranges the quadrangle leaks out at a corner and the enclosure is
    // wasted.
    //
    // The north and south ranges are identified by **position** rather than by sorting on z and
    // taking the ends: the east and west ranges both sit at a middle z, so the second after
    // sorting is the west range rather than the south one. That misidentification reports "the
    // side range does not meet the north range", pointing at something entirely innocent.
    const north = ranges.find(v => z1(v) < 0)!;
    const south = ranges.find(v => z0(v) > 0)!;
    expect(north, '沒有北棟').toBeTruthy();
    expect(south, '沒有南棟').toBeTruthy();
    const sides = ranges.filter(v => v !== north && v !== south);
    expect(sides.length, '東西兩棟不是兩棟').toBe(2);
    for (const s of sides) {
      expect(z0(s), '側棟沒有接到北棟').toBeCloseTo(z1(north), 9);
      expect(z1(s), '側棟沒有接到南棟').toBeCloseTo(z0(south), 9);
    }
  });

  // ── The dome ──────────────────────────────────────────────

  /**
   * The dome is a **hemisphere** on a drum.
   *
   * A stack of octagonal prisms narrowing upward reads as a dome at range and as four steps up
   * close.
   *
   * A hemisphere's height is necessarily half its diameter, so the drum is not decoration:
   * without it the dome is too flat to read as a dome at all.
   */
  it('should cap the dome with a hemisphere on a drum', () => {
    const dome = one('dome');
    const drum = one('domeDrum');
    expect(dome.shape, '圓頂不是半球').toBe('dome');
    expect(drum.shape, '鼓座不是圓的').toBe('cylinder');
    for (const v of [dome, drum]) {
      expect(v.part, '圓頂會長出窗戶 —— 它要走屋頂分支').toBe(PART_ROOF);
    }
    expect(dome.y0, '半球浮在鼓座上方').toBeCloseTo(drum.y1, 9);
    expect(dome.w, '半球與鼓座不同寬 —— 接縫會露出來').toBeCloseTo(drum.w, 9);
    expect(dome.w, '半球不是正圓').toBeCloseTo(dome.d, 9);
    // A hemisphere's height equals its radius. Squashed or stretched it is no longer one.
    expect(dome.y1 - dome.y0, '半球被壓扁或拉長了').toBeCloseTo(dome.w / 2, 6);
    // And the drum needs real height; a 0.2 m rim is not a drum.
    expect(m(drum.y1 - drum.y0), '鼓座太矮，圓頂會扁得讀不出來').toBeGreaterThan(2);
  });

  it('should centre the dome on the block it sits on', () => {
    // An off-centre dome reads as a later addition.
    const host = ranges.find(r => z1(r) < 0)!;
    for (const d of [one('dome'), one('domeDrum')]) {
      expect(d.x, '圓頂沒有置中').toBeCloseTo(host.x, 9);
      expect(d.z, '圓頂沒有置中').toBeCloseTo(host.z, 9);
    }
    // And it lands entirely on that range; overhanging, it hangs in the air.
    expect(one('dome').w / 2, '圓頂比它坐的那一棟還寬')
      .toBeLessThanOrEqual(host.d / 2 + 1e-9);
  });

  it('should light the lantern at the top', () => {
    // At night the dome is only a glowing apex, the one part of it still visible.
    const finial = one('finial');
    expect(finial.part, '頂尖不會亮').toBe(PART_LAMP);
    expect(finial.y0, '頂尖沒有站在圓頂上')
      .toBeGreaterThanOrEqual(Math.max(...tagged('dome').map(d => d.y1)) - 1e-9);
  });

  /**
   * There is exactly **one** high point on the plot.
   *
   * With a dome on the north range and a clock tower on the south, two objects at 24 m and 27 m
   * face each other across the quadrangle, and at range that reads as two different buildings
   * rather than one university.
   */
  it('should raise the dome and nothing else', () => {
    const lantern = one('finial');
    expect(lantern.y1, '圓頂的頂尖不是全場最高的')
      .toBeCloseTo(topOf(plan.massing), 9);
    for (const v of plan.massing) {
      if (v.tag === 'finial' || v.tag === 'dome' || v.tag === 'domeDrum') continue;
      // Compared against the drum's **top**: the rooftop air handling units sit on the same roof
      // as the dome, and compared against the drum's base they would be judged a second tower.
      expect(v.y1, `${v.tag} 高過圓頂 —— 場上不該有第二座塔`)
        .toBeLessThan(one('domeDrum').y1 + 1e-9);
    }
  });

  it('should stay at a believable height for a university', () => {
    // The highest point is the dome's apex. The lower bound is 20 m: any lower and at range it
    // stops separating from the high school next door, which is kept under 20 m.
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(20);
    expect(top).toBeLessThan(36);
  });

  // ── The quadrangle's ground ───────────────────────────────

  it('should lay grass and paths in the quadrangle', () => {
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const inQuad = base.filter(d =>
      Math.abs(d.x) < 1 && Math.abs(d.z) < 1.2);
    expect(inQuad.some(d => d.lawn), '方庭沒有草地').toBe(true);
    expect(inQuad.some(d => !d.lawn), '方庭沒有路 —— 走過去要踩草坪').toBe(true);
  });

  it('should cross the paths at the centre', () => {
    // Paths that do not meet are not a quadrangle's cross but two separate runs.
    const paths = plan.decals.filter(d =>
      (d.layer ?? 'base') === 'base' && !d.lawn && Math.abs(d.z) < 1.2);
    expect(paths.some(d => Math.abs(d.x) < 1e-9 && d.d > d.w),
      '沒有一條南北向的路穿過中心').toBe(true);
  });

  it('should put a fountain where the paths meet', () => {
    // The pool at the quadrangle's centre is this building's cheapest "this is a university"
    // signal.
    const basin = plan.props.filter(v => v.tag === 'fountain');
    expect(basin.length, '方庭沒有水池').toBeGreaterThan(0);
    for (const v of basin) {
      expect(Math.hypot(v.x, v.z), '水池不在方庭中央').toBeLessThan(0.1);
      expect(v.shape, '水池不是圓的').toBe('cylinder');
    }
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'hedge', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
  });
});
