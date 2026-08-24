import { describe, it, expect } from 'vitest';
import { schoolPlan } from '../school';
import { FACADE_CIVIC, PART_ROOF } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = schoolPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;

/**
 * The shared acceptance checks live in the table in `CivicPlans.test.ts`. This file holds only the
 * shape constraints specific to a primary school.
 *
 * Recognition features: **low height**, two parallel classroom wings, a playground, and play
 * equipment. The height matters most — it is the only difference between a primary school and a
 * high school or university that separates them at range.
 */
describe('小學', () => {
  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
    expect(plan.facade).toBe(FACADE_CIVIC);
    expect(plan.color).toEqual(civicColorOf('school'));
  });

  it('should stay low', () => {
    // A primary school is low. At range that is the only thing separating it from a three-storey
    // high school or a university with a clock tower.
    const top = m(topOf(plan.massing));
    expect(top, `小學蓋到 ${top.toFixed(1)} m —— 那是高中`).toBeLessThan(12);
    expect(top).toBeGreaterThan(7);
  });

  it('should lay out two parallel classroom wings', () => {
    const wings = tagged('wing');
    expect(wings.length, '教室翼不是兩排').toBe(2);
    const [a, b] = wings.sort((p, q) => p.z - q.z);
    // Parallel means the same width and height, differing only in z. Crossing at right angles it
    // is an L rather than a school building.
    expect(a!.w).toBeCloseTo(b!.w, 9);
    expect(a!.y1).toBeCloseTo(b!.y1, 9);
    expect(a!.x).toBeCloseTo(b!.x, 9);
    // And a gap between them, for daylight. Pressed together they are one deep building.
    const slot = (b!.z - b!.d / 2) - (a!.z + a!.d / 2);
    expect(m(slot), '兩排教室之間沒有留縫').toBeGreaterThan(2);
  });

  it('should join the wings with a link that does not fill the slot', () => {
    // The lobby joins the two wings but **must not fill** the gap; filled, it is one deep
    // building.
    const link = one('link');
    const [a, b] = tagged('wing').sort((p, q) => p.z - q.z);
    expect(link.z - link.d / 2).toBeCloseTo(a!.z + a!.d / 2, 9);
    expect(link.z + link.d / 2).toBeCloseTo(b!.z - b!.d / 2, 9);
    expect(link.w / a!.w, '門廳填滿了整道縫').toBeLessThan(0.6);
  });

  it('should roof both wings and the link', () => {
    for (const tag of ['wing', 'link']) {
      expect(tagged(`${tag}Roof`).length, `${tag} 沒有屋頂`).toBe(tagged(tag).length);
      for (const r of tagged(`${tag}Roof`)) expect(r.part).toBe(PART_ROOF);
    }
  });

  it('should give the children a field, not a car park', () => {
    // The playground is one of a primary school's recognition features, and it has to be the
    // **largest** surface on the plot.
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const lawn = base.filter(d => d.lawn);
    expect(lawn.length, '沒有操場').toBeGreaterThan(0);
    const area = (d: { w: number; d: number }) => d.w * d.d;
    const biggest = base.reduce((p, q) => (area(q) > area(p) ? q : p));
    expect(biggest.lawn, '基地上最大的一塊不是操場').toBe(true);
  });

  it('should mark a court on the field', () => {
    // A plain green field does not read as a playground; the court markings do.
    const marks = plan.decals.filter(d => d.layer === 'mark');
    expect(marks.length, '操場上沒有場地線').toBeGreaterThanOrEqual(4);
    for (const d of marks) expect(d.shade, '場地線不是白漆').toBeGreaterThan(0.7);
  });

  /**
   * Play equipment.
   *
   * The one thing a primary school genuinely needs custom masses for: `geometry/props` has no
   * slide, climbing frame or swings, and they are exactly what says "this is a primary school".
   */
  it('should put play equipment in the playground', () => {
    const kinds = new Set(plan.props.map(v => v.tag));
    expect(kinds, '遊具不齊').toEqual(new Set(['slide', 'climber', 'swing']));
  });

  it('should keep the play equipment child-sized', () => {
    // A three-metre swing set is not play equipment but a tower.
    for (const v of plan.props) {
      const h = m(v.y1 - v.y0);
      expect(h, `${v.tag} 有 ${h.toFixed(1)} m 高`).toBeLessThan(2.6);
    }
  });

  it('should stand the play equipment on the soft surface, not the field', () => {
    // Play equipment stands on a soft surface, sand or rubber, rather than grass or asphalt.
    const soft = plan.decals.find(d => !d.lawn && (d.layer ?? 'base') === 'base'
      && d.shade > 0.7)!;
    expect(soft, '遊具區沒有鋪面').toBeTruthy();
    for (const v of plan.props) {
      expect(Math.abs(v.x - soft.x), `${v.tag} 站到遊具區外面了`)
        .toBeLessThanOrEqual(soft.w / 2 + 1e-9);
      expect(Math.abs(v.z - soft.z), `${v.tag} 站到遊具區外面了`)
        .toBeLessThanOrEqual(soft.d / 2 + 1e-9);
    }
  });

  it('should park the school bus along the kerb, not across it', () => {
    // A school bus is 7.2 m long. Parked across a 4 m deep drop-off, half of it is inside the
    // building.
    const bus = plan.vehicles.find(v => v.kind === 'bus')!;
    expect(bus, '沒有校車').toBeTruthy();
    expect(bus.rotationY ?? 0, '校車橫著停').toBeCloseTo(0, 6);
  });

  it('should give the children somewhere to leave a bike', () => {
    expect(plan.fixtures.filter(f => f.kind === 'bikeRack').length, '單車架太少')
      .toBeGreaterThanOrEqual(2);
  });

  it('should shelter the entrance', () => {
    expect(plan.overhead.length, '大門沒有雨棚').toBeGreaterThan(0);
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
  });
});
