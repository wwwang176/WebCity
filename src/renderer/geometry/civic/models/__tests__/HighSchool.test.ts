import { describe, it, expect } from 'vitest';
import { highSchoolPlan, TRACK } from '../schoolHigh';
import { FACADE_CIVIC, PART_ROOF } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = highSchoolPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;
const marks = plan.decals.filter(d => d.layer === 'mark');

/**
 * The shared acceptance checks live in the table in `CivicPlans.test.ts`. This file holds only the
 * shape constraints specific to a high school.
 *
 * Recognition features: a three-storey classroom block, a **running track**, and a review stand.
 * The track is the strongest — no other building in the city has a closed loop on the ground.
 */
describe('高中', () => {
  it('should occupy 2x3', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
    expect(plan.color).toEqual(civicColorOf('school_high'));
  });

  it('should stand three storeys, taller than an elementary school', () => {
    // A primary school is kept under 12 m, pinned by `School.test.ts`. A high school has to be
    // clearly taller, or at range the two are one building.
    const top = m(topOf(plan.massing));
    expect(top, '高中不比小學高').toBeGreaterThan(13);
    expect(top).toBeLessThan(20);
  });

  it('should roof every block it builds', () => {
    for (const tag of ['main', 'annex']) {
      expect(tagged(`${tag}Roof`).length, `${tag} 沒有屋頂`).toBe(tagged(tag).length);
      for (const r of tagged(`${tag}Roof`)) expect(r.part).toBe(PART_ROOF);
    }
  });

  // ── The track ─────────────────────────────────────────────

  it('should draw the track as a closed loop', () => {
    // A run of short lines that do not join is a dashed line, not a track. Each segment's end is
    // checked against the next one's start; testing only that many markings exist would pass a
    // pile of scattered lines.
    const lanes = TRACK.lanes;
    expect(lanes.length, '跑道不只一條線').toBeGreaterThanOrEqual(2);
    for (const lane of lanes) {
      expect(lane.length, '這一圈的段數太少，橢圓會變成多邊形')
        .toBeGreaterThanOrEqual(16);
      for (let i = 0; i < lane.length; i++) {
        const a = lane[i]!;
        const b = lane[(i + 1) % lane.length]!;
        // A segment's end is its centre plus half its length along its direction, which comes
        // from rotationY.
        const end = (s: typeof a, sign: number) => ({
          x: s.x + sign * (s.w / 2) * Math.cos(s.rotationY),
          z: s.z - sign * (s.w / 2) * Math.sin(s.rotationY),
        });
        const tail = end(a, 1);
        const head = end(b, -1);
        const gap = Math.hypot(tail.x - head.x, tail.z - head.z);
        expect(m(gap), `第 ${i} 段與下一段之間斷了 ${m(gap).toFixed(2)} m`)
          .toBeLessThan(0.35);
      }
    }
  });

  /**
   * A rounded rectangle, not an ellipse.
   *
   * A real running track is **four straights** plus four bends; an ellipse has no straight section
   * at all and reads as an egg.
   *
   * This tests for straights rather than for rectangularity: a straight amounts to several
   * consecutive segments sharing exactly one direction, which is precisely what an ellipse cannot
   * do.
   */
  it('should have four straights, not be one endless curve', () => {
    const outer = TRACK.lanes[0]!;
    const dirs = outer.map(s => s.rotationY);
    /** How many consecutive segments share this exact direction. */
    const runOf = (want: number) =>
      dirs.filter(d => Math.abs(Math.atan2(Math.sin(d - want), Math.cos(d - want)))
        < 1e-6).length;
    for (const [name, want] of [
      ['+x', 0], ['−x', Math.PI], ['+z', -Math.PI / 2], ['−z', Math.PI / 2],
    ] as const) {
      expect(runOf(want), `${name} 方向沒有直道 —— 這是橢圓不是圓角矩形`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it('should round the corners rather than square them off', () => {
    // A track with square corners cannot be run, and it is a court rather than a track.
    expect(TRACK.r, '轉角半徑是 0，那是一個方框').toBeGreaterThan(0);
    expect(TRACK.r, '轉角半徑等於半寬，那又變回橢圓了').toBeLessThan(TRACK.b);
    const outer = TRACK.lanes[0]!;
    const curved = outer.filter(s =>
      Math.min(...[0, Math.PI, Math.PI / 2, -Math.PI / 2].map(w =>
        Math.abs(Math.atan2(Math.sin(s.rotationY - w), Math.cos(s.rotationY - w)))))
      > 1e-6);
    expect(curved.length, '沒有任何一段是彎的').toBeGreaterThanOrEqual(8);
  });

  it('should be longer than it is wide', () => {
    const outer = TRACK.lanes[0]!;
    const xs = outer.map(s => s.x);
    const zs = outer.map(s => s.z);
    const a = (Math.max(...xs) - Math.min(...xs)) / 2;
    const b = (Math.max(...zs) - Math.min(...zs)) / 2;
    expect(a / b, '跑道太方了').toBeGreaterThan(1.15);
    expect(m(b), '跑道太窄，跑不起來').toBeGreaterThan(5);
  });

  it('should nest the lanes without crossing them', () => {
    // Two lane lines crossing is not a track but a tangle.
    //
    // The comparison is against the **distance to the outline, per axis**, not the straight-line
    // distance to the centre: on a rounded rectangle the furthest points from the centre are the
    // corners and the nearest are the middles of the straights, so a point on the inner straight
    // is closer to the centre than a point on the outer bend. Compared by straight-line distance,
    // a correct inner lane would be judged as having run outside.
    const [outer, inner] = TRACK.lanes;
    for (const s of inner!) {
      expect(Math.abs(s.x - TRACK.x), '內圈在 x 方向跑到外圈外面')
        .toBeLessThanOrEqual(TRACK.a - TRACK.lane + 1e-9);
      expect(Math.abs(s.z - TRACK.z), '內圈在 z 方向跑到外圈外面')
        .toBeLessThanOrEqual(TRACK.b - TRACK.lane + 1e-9);
    }
    // And the outer lane really has to touch the declared outline, or "the inner lane is smaller"
    // says nothing.
    expect(Math.max(...outer!.map(s => Math.abs(s.x - TRACK.x))))
      .toBeCloseTo(TRACK.a, 6);
  });

  it('should keep the whole track on the grass', () => {
    // A track drawn over the stand or off the plot is the least convincing thing there is.
    const field = plan.decals.find(d => d.lawn)!;
    expect(field, '沒有運動場').toBeTruthy();
    for (const s of TRACK.lanes.flat()) {
      expect(Math.abs(s.x - field.x), '跑道畫到草地外面').toBeLessThan(field.w / 2);
      expect(Math.abs(s.z - field.z), '跑道畫到草地外面').toBeLessThan(field.d / 2);
    }
  });

  it('should turn every track segment', () => {
    // A loop made entirely of axis-aligned segments is a rectangle, not a track.
    const turned = marks.filter(d => (d.rotationY ?? 0) !== 0);
    expect(turned.length, '跑道沒有任何一段轉向').toBeGreaterThanOrEqual(16);
  });

  // ── The review stand ──────────────────────────────────────

  it('should raise the podium above the field', () => {
    // A review stand is something to stand on and speak from. Flush with the ground it is only
    // paving.
    const podium = one('podium');
    expect(podium, '沒有司令台').toBeTruthy();
    const h = m(podium.y1 - podium.y0);
    expect(h, `司令台只有 ${h.toFixed(1)} m 高`).toBeGreaterThan(0.8);
    expect(h, '司令台高到變成一棟樓').toBeLessThan(2.2);
  });

  it('should face the podium onto the field', () => {
    // A review stand with its back to the field is a joke. It belongs between the classroom block
    // and the track.
    const podium = one('podium');
    const main = one('main');
    expect(podium.z, '司令台跑到教室樓後面去了').toBeGreaterThan(main.z);
    expect(podium.z, '司令台站到跑道上去了').toBeLessThan(TRACK.z);
  });

  it('should roof the podium on posts, not on walls', () => {
    // The stand's roof rests on posts; with four walls it is a room rather than a review stand.
    const posts = plan.props.filter(v => v.tag === 'podiumPost');
    expect(posts.length, '司令台的頂棚沒有柱子').toBe(4);
    const canopy = plan.overhead.find(v => v.tag === 'podiumRoof')!;
    expect(canopy, '司令台沒有頂棚').toBeTruthy();
    for (const p of posts) {
      expect(p.y1, '柱子沒有頂到頂棚').toBeCloseTo(canopy.y0, 6);
      expect(Math.abs(p.x - canopy.x), '柱子站到頂棚外面')
        .toBeLessThanOrEqual(canopy.w / 2 + 1e-9);
    }
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
  });

  it('should keep the fixtures off the running surface', () => {
    // A tree planted on a running track is the same joke as one planted on a fire station's apron.
    // The rounded rectangle's outline is per axis: clear on either axis is clear.
    for (const f of plan.fixtures) {
      const outside = Math.abs(f.x - TRACK.x) > TRACK.a
        || Math.abs(f.z - TRACK.z) > TRACK.b;
      expect(outside, `${f.kind} 站在跑道圈裡`).toBe(true);
    }
  });
});
