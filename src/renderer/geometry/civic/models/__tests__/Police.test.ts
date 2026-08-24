import { describe, it, expect } from 'vitest';
import { policePlan } from '../police';
import { FACADE_CIVIC, PART_ROOF, PART_LAMP } from '../../../buildings/parts';
import { centroidOffset, topOf } from '../../../buildings/massing/volume';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = policePlan;
const m = (cells: number) => cells * METRES_PER_CELL;

/**
 * The shared checks — footprint, budget, night lights, sitting on the ground — live in the table
 * in `CivicPlans.test.ts`. This file holds only the shape constraints **specific to** a police
 * station: what "does it still look like a police station" amounts to.
 */
describe('警局', () => {
  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
    expect(plan.facade).toBe(FACADE_CIVIC);
  });

  it('should keep the watch tower above both wings', () => {
    // The watchtower is a police station's recognition feature. Hidden behind a wing it is not
    // identifiable.
    const tower = plan.massing.find(v => v.tag === 'tower')!;
    const wings = plan.massing.filter(v => v.tag === 'wing');
    expect(tower, '找不到瞭望塔').toBeTruthy();
    expect(wings.length, 'L 形要兩支翼').toBe(2);
    for (const w of wings) {
      expect(tower.y1, '塔沒有高過翼樓').toBeGreaterThan(w.y1);
    }
  });

  it('should be an L, not a box', () => {
    // One long wing and one short one is what an L amounts to. The volume centroid's offset from
    // the bounding box centre is the computable measure of asymmetry; `centroidOffset`'s comment
    // explains why a raster difference is not used.
    expect(centroidOffset(plan.massing), '量體太對稱 —— 它是個盒子不是 L')
      .toBeGreaterThan(0.05);
  });

  // "No mass buried inside another" lives in the table in `CivicPlans.test.ts`, which every
  // building goes through, so there is no second copy here.

  it('should stay at a believable height for a police station', () => {
    // On a 24 x 24 m plot, too short and the tower is not identifiable as one; too tall and it
    // becomes a fire station's training tower.
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(14);
    expect(top).toBeLessThan(22);
  });

  it('should give the wings enough height for the lobby plus real floors', () => {
    // The CIVIC facade's lobby height is floorHeight * 1.35 and window panes start above it.
    // With the wing too short, the whole building is lobby and shows no window at all.
    const wing = plan.massing.find(v => v.tag === 'wing')!;
    const floorH = 0.22 + plan.seed[0] * 0.08;   // the shader mix(MIN, MAX, aSeed.x)
    const windowed = wing.y1 - floorH * 1.35;
    expect(windowed / floorH, '門廳之上不到兩層 —— 窗格幾乎看不到')
      .toBeGreaterThan(2);
  });

  it('should cap the tower with a roof, not a wall', () => {
    // Without it the tower top falls to the automatic `n.y > 0.85` roof test, which does give it
    // the roof palette, but a cap has to be wider than the shaft to read as a cap.
    const cap = plan.massing.find(v => v.tag === 'cap')!;
    const tower = plan.massing.find(v => v.tag === 'tower')!;
    expect(cap.part).toBe(PART_ROOF);
    expect(cap.w, '塔冠沒有比塔身寬').toBeGreaterThan(tower.w);
  });

  it('should put the parking bay lines on the mark layer', () => {
    // Parking bay lines are markings: in the massing layer they grow walls and windows, and in
    // the base decal layer they z-fight with the asphalt.
    const marks = plan.decals.filter(d => d.layer === 'mark');
    expect(marks.length, '沒有任何標線').toBeGreaterThan(0);
    for (const d of marks) {
      expect(d.shade, '標線不是白漆').toBeGreaterThan(0.7);
    }
  });

  it('should use real parking bay dimensions', () => {
    // A car has to fit between the bay lines. The industrial zone's "parking bays" do not hold up
    // at that scale, as TODO.md records; this does not repeat it.
    const stripes = plan.decals
      .filter(d => d.layer === 'mark' && d.w < d.d)
      .map(d => d.x)
      .sort((a, b) => a - b);
    expect(stripes.length, '找不到停車格分隔線').toBeGreaterThan(2);
    for (let i = 1; i < stripes.length; i++) {
      const gap = m(stripes[i]! - stripes[i - 1]!);
      expect(gap, `停車格只有 ${gap.toFixed(1)} m 寬`).toBeGreaterThan(2.3);
      expect(gap, `停車格寬到 ${gap.toFixed(1)} m`).toBeLessThan(3.5);
    }
    const depth = m(plan.decals.find(d => d.layer === 'mark' && d.w < d.d)!.d);
    expect(depth, `停車格只有 ${depth.toFixed(1)} m 深`).toBeGreaterThan(4.5);
  });

  it('should shelter the entrance with a canopy', () => {
    expect(plan.overhead.length, '門口沒有雨棚').toBeGreaterThan(0);
    // A canopy clears people's heads. 2.2 m is the pedestrian clearance
    // (`OVERHEAD_CLEARANCE`).
    for (const v of plan.overhead) {
      expect(m(v.y0), '雨棚會打到人').toBeGreaterThan(2.2);
    }
  });

  it('should light both the entrance and the car park', () => {
    // With lights only at the entrance, the whole car park is black at night, and it takes half
    // the plot.
    const street = plan.fixtures.filter(f => f.kind === 'lamp');
    const porch = plan.props.filter(v => v.part === PART_LAMP);
    expect(street.length, '停車場的路燈太少').toBeGreaterThanOrEqual(3);
    expect(porch.length, '門口沒有燈').toBeGreaterThan(0);
    const zs = [...street, ...porch].map(v => v.z);
    expect(Math.max(...zs) - Math.min(...zs), '所有的燈擠在同一條線上')
      .toBeGreaterThan(0.3);
  });

  /**
   * Every low prop comes from the shared primitives.
   *
   * A second copy ends with two differently shaped street lamps in one city, and a change to one
   * not reaching the other. So anything `geometry/props` already has may not be redrawn here as a
   * custom mass.
   */
  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    // The custom masses are only what the shared primitives genuinely lack.
    const custom = new Set(plan.props.map(v => v.tag));
    expect(custom, '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['porchLamp', 'bench']));
  });

  /**
   * Patrol cars use the existing vehicle geometry rather than plain boxes.
   *
   * A parked patrol car and one on patrol have to be the same vehicle; the two looking different
   * is the most easily spotted inconsistency there is.
   */
  it('should park real police cars, not grey boxes', () => {
    expect(plan.vehicles.some(v => v.kind === 'policeCar'), '沒有警車').toBe(true);
    expect(plan.props.some(v => v.tag === 'car'), '還留著手畫的車')
      .toBe(false);
  });

  it('should point the parked cars down the bays', () => {
    // The bays run along z while the vehicle geometry faces +x: unrotated the cars park sideways
    // and straddle two or three separator lines.
    for (const v of plan.vehicles) {
      expect(v.rotationY, `${v.kind} 沒有轉向停車格`).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('should not tag the lamp posts as glowing', () => {
    // Tagging the whole thing as glowing gives a post lit from the ground to the top at night
    // (the lesson of BUG-230). Through the shared `lamp` the primitive guarantees that, and what
    // this case guards is that the shared one is actually used.
    expect(plan.fixtures.some(f => f.kind === 'lamp'), '路燈不是共用圖元')
      .toBe(true);
    for (const v of plan.props.filter(x => x.part === PART_LAMP)) {
      const h = (v.y1 - v.y0) * METRES_PER_CELL;
      expect(h, `自訂的發光體有 ${h.toFixed(1)} m 高 —— 那是燈桿不是燈頭`)
        .toBeLessThan(1.5);
    }
  });

  it('should pave the forecourt and the car park without overlapping them', () => {
    // Overlapping base layers z-fight. `assembleDecals` catches it, but the intent is stated here
    // too: forecourt, car park and lawn are three **non-overlapping** surfaces that share edges.
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    expect(base.length, '地面只有一塊 —— 前庭、停車場、草地應該分開').toBeGreaterThanOrEqual(3);
    expect(base.some(d => d.lawn), '沒有草地').toBe(true);
  });
});
