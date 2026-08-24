import { describe, it, expect } from 'vitest';
import { parkPlan } from '../park';
import { cemeteryPlan } from '../cemetery';
import {
  FACADE_GREEN, PART_GROUND, PART_LAMP, PART_ROOF,
} from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicDecal, CivicPlan } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const base = (p: CivicPlan) => p.decals.filter(d => (d.layer ?? 'base') === 'base');
const area = (d: CivicDecal) => d.w * d.d;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);

/**
 * The two green spaces: park and cemetery. Their shared acceptance checks live in the table in
 * `CivicPlans.test.ts`.
 *
 * They share `FACADE_GREEN`, a facade branch that **deliberately has no window panes**. The
 * masses on green space are pavilions and memorials, and a pavilion covered in windows only looks
 * like a very small office.
 */
describe.each([
  ['公園', parkPlan, 'park'],
  ['墓園', cemeteryPlan, 'cemetery'],
] as const)('%s', (_label, plan, type) => {
  it('should use the green facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_GREEN);
    expect(plan.color).toEqual(civicColorOf(type));
  });

  it('should be mostly grass', () => {
    // Green space's ground is its content. More than half paved, it is a plaza rather than green
    // space.
    const all = base(plan).reduce((s, d) => s + area(d), 0);
    const grass = base(plan).filter(d => d.lawn).reduce((s, d) => s + area(d), 0);
    expect(grass / all, `${type} 的草地只佔 ${(grass / all * 100).toFixed(0)}%`)
      .toBeGreaterThan(0.5);
  });

  it('should let people walk in', () => {
    // One paved path reaches the cell boundary. Green space with grass on all four sides is a
    // decorative lawn, and in the game it sits right against the road.
    const edge = plan.footprint.h / 2;
    const reaches = base(plan).some(d => !d.lawn && d.z + d.d / 2 >= edge - 1e-9);
    expect(reaches, `${type} 的步道沒有通到路邊`).toBe(true);
  });

  it('should light something without relying on windows', () => {
    // `FACADE_GREEN` has no window panes, so the only light at night can come from `PART_LAMP`.
    // This is BUG-238's green-space form.
    const lamps = [...plan.massing, ...plan.props]
      .filter(v => v.part === PART_LAMP).length;
    const street = plan.fixtures.filter(f => f.kind === 'lamp').length;
    expect(lamps + street, `${type} 夜裡是一塊黑地`).toBeGreaterThan(0);
  });

  it('should plant a lot of trees', () => {
    // Green space's triangles belong in its planting.
    expect(plan.fixtures.filter(f => f.kind === 'tree').length, `${type} 的樹太少`)
      .toBeGreaterThanOrEqual(6);
  });
});

describe('公園', () => {
  const plan = parkPlan;

  it('should occupy a single cell', () => {
    expect(plan.footprint).toEqual({ w: 1, h: 1 });
  });

  it('should stay small enough not to loom over the houses', () => {
    // A building on a 12 m cell is wrong here. A pavilion is a pavilion.
    const top = m(topOf(plan.massing));
    expect(top, `公園蓋到 ${top.toFixed(1)} m`).toBeLessThan(5);
  });

  it('should carry the gazebo roof on posts', () => {
    // With four walls it is a room rather than a pavilion, and nothing can be seen into it from
    // the side.
    const posts = plan.props.filter(v => v.tag === 'post');
    const roof = tagged(plan, 'gazeboRoof');
    expect(posts.length, '涼亭的柱子不到三根').toBeGreaterThanOrEqual(3);
    expect(roof.length, '涼亭沒有屋頂').toBeGreaterThan(0);
    for (const r of roof) expect(r.part).toBe(PART_ROOF);
    const eave = Math.min(...roof.map(r => r.y0));
    for (const p of posts) {
      expect(p.y1, '柱子沒有頂到屋簷').toBeCloseTo(eave, 6);
    }
  });

  it('should floor the gazebo with paving, not a wall', () => {
    // Tagged as wall, this 0.25 m platform grows windows.
    const deck = tagged(plan, 'deck')[0]!;
    expect(deck.part).toBe(PART_GROUND);
    expect(deck.shade, '台座沒有鋪面明度').toBeGreaterThan(0);
  });

  it('should light the gazebo itself, not only the paths', () => {
    // "Something lights up" is satisfied by the shared lamps alone, which is what the data table
    // checks, but that is not the point: the pavilion is this cell's focus, and unlit it leaves
    // the park as a patch of black between two street lamps at night.
    const own = [...plan.massing, ...plan.props].filter(v => v.part === PART_LAMP);
    expect(own.length, '涼亭自己沒有燈').toBeGreaterThan(0);
    for (const v of own) {
      expect(Math.hypot(v.x, v.z), '亮的東西不在涼亭上').toBeLessThan(0.2);
    }
  });

  it('should offer somewhere to sit', () => {
    expect(plan.props.filter(v => v.tag === 'bench').length, '公園沒有長椅')
      .toBeGreaterThanOrEqual(2);
  });

  it('should not pretend a 12 m park has parking', () => {
    // A one-cell park is reached on foot. One parked vehicle takes a tenth of the plot.
    expect(plan.vehicles).toEqual([]);
  });

  it('should cross the paths so all four edges connect', () => {
    // All four ends of the cross paths reach the boundary; reaching only one side, the other
    // three cannot be walked in from.
    const half = 0.5;
    const paths = base(plan).filter(d => !d.lawn);
    const reaches = (pick: (d: CivicDecal) => number) =>
      paths.some(d => Math.abs(pick(d)) >= half - 1e-9);
    expect(reaches(d => d.x + d.w / 2), '東側走不進來').toBe(true);
    expect(reaches(d => d.x - d.w / 2), '西側走不進來').toBe(true);
    expect(reaches(d => d.z + d.d / 2), '南側走不進來').toBe(true);
    expect(reaches(d => d.z - d.d / 2), '北側走不進來').toBe(true);
  });
});

describe('墓園', () => {
  const plan = cemeteryPlan;
  const stones = plan.props.filter(v => v.tag === 'headstone');

  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
  });

  it('should line the headstones up in a grid', () => {
    // Alignment is the whole of this plot. Scattered low blocks read as clutter on the ground;
    // laid out on a grid they read as a cemetery.
    expect(stones.length, '墓碑太少，讀不出是墓園').toBeGreaterThanOrEqual(20);
    const key = (v: number) => v.toFixed(6);
    const cols = new Set(stones.map(s => key(s.x)));
    const rows = new Set(stones.map(s => key(s.z)));
    expect(cols.size * rows.size, '墓碑不成格線 —— 有的行列缺角')
      .toBe(stones.length);
    expect(cols.size, '只有一行').toBeGreaterThan(2);
    expect(rows.size, '只有一列').toBeGreaterThan(2);
  });

  /**
   * And **evenly spaced**.
   *
   * "On a grid" does not rule out an uneven grid: move one row 0.1 m and the row and column
   * counts are unchanged, so the case above stays green while that row is visibly out of line.
   * Even spacing is the signal that someone maintains this, and it is the difference between a
   * cemetery and stones scattered on the ground.
   *
   * The columns (x) form two groups either side of the path, each evenly spaced within itself.
   * The path separates the groups, so uneven spacing overall is **correct**: measuring the whole
   * row together would flag that necessary gap as a fault.
   */
  it('should space the rows and columns evenly', () => {
    const gaps = (vs: number[]) => {
      const s = [...new Set(vs)].sort((a, b) => a - b);
      return s.slice(1).map((v, i) => v - s[i]!);
    };
    const rowGaps = gaps(stones.map(s => s.z));
    for (const g of rowGaps) {
      expect(m(g), `列距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(rowGaps[0]!), 6);
    }
    for (const side of [-1, 1]) {
      const colGaps = gaps(stones.filter(s => Math.sign(s.x) === side).map(s => s.x));
      for (const g of colGaps) {
        expect(m(g), `行距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(colGaps[0]!), 6);
      }
    }
  });

  it('should cut every headstone from the same mould', () => {
    for (const s of stones) {
      expect(s.w).toBeCloseTo(stones[0]!.w, 9);
      expect(s.y1).toBeCloseTo(stones[0]!.y1, 9);
    }
    const h = m(stones[0]!.y1 - stones[0]!.y0);
    expect(h, `墓碑有 ${h.toFixed(1)} m 高 —— 那是紀念碑`).toBeLessThan(1.2);
  });

  it('should keep the headstones off the path', () => {
    // A headstone growing on the path closes it.
    const path = base(plan).find(d => !d.lawn && d.d > d.w)!;
    for (const s of stones) {
      const clear = Math.abs(s.x) - s.w / 2 >= path.w / 2 - 1e-9;
      expect(clear, `有一顆墓碑站在步道上（x = ${m(s.x).toFixed(1)} m）`).toBe(true);
    }
  });

  it('should walk the path from the gate to the memorial', () => {
    // A path that stops short is a decorative line. It runs from the plot's front edge all the
    // way to the memorial.
    const plinth = tagged(plan, 'plinth')[0]!;
    const path = base(plan).find(d => !d.lawn && d.d > d.w)!;
    const court = base(plan).find(d => !d.lawn && d !== path)!;
    expect(path.z + path.d / 2, '步道沒有接到門口')
      .toBeGreaterThanOrEqual(plan.footprint.h / 2 - 1e-9);
    // The path meets the plaza and the memorial stands on it; a break between them is a path
    // that stops halfway.
    expect(path.z - path.d / 2, '步道與碑前廣場之間斷了一段')
      .toBeLessThanOrEqual(court.z + court.d / 2 + 1e-9);
    expect(Math.abs(plinth.z - court.z) + plinth.d / 2, '紀念碑站在廣場外面')
      .toBeLessThanOrEqual(court.d / 2 + 1e-9);
    expect(Math.abs(plinth.x - court.x) + plinth.w / 2)
      .toBeLessThanOrEqual(court.w / 2 + 1e-9);
  });

  /**
   * There is no building in the graveyard.
   *
   * A cemetery needs no building, and whether one is present is visible in the data as a **roof**.
   * This plot should carry no `PART_ROOF` at all, because nothing on it needs covering.
   *
   * The second condition is scale: the memorial's largest step is 3.2 m square. The limit is
   * 16 m2 — a mass larger than that is not a memorial but a building.
   */
  it('should not put a building in the graveyard', () => {
    const all = [...plan.massing, ...plan.props, ...plan.overhead];
    for (const v of all) {
      expect(v.part, `${v.tag} 是屋頂 —— 墓園裡不該有需要蓋頂的東西`)
        .not.toBe(PART_ROOF);
    }
    for (const v of plan.massing) {
      const footprint = m(v.w) * m(v.d);
      expect(footprint, `${v.tag} 佔了 ${footprint.toFixed(0)} m2 —— 那是一棟樓`)
        .toBeLessThan(16);
    }
  });

  it('should light a cross on top of the memorial', () => {
    // At night the cross is all that remains of the cemetery.
    const cross = tagged(plan, 'cross');
    const shaft = tagged(plan, 'shaft')[0]!;
    expect(cross.length, '十字不成形').toBeGreaterThanOrEqual(3);
    for (const c of cross) {
      expect(c.part, '十字不會亮').toBe(PART_LAMP);
      expect(c.y0, '十字掛在石柱下面').toBeGreaterThanOrEqual(shaft.y1 - 1e-9);
    }
    // And it has to be visible: below 4 m the cross is hidden by the trees beside the graves.
    expect(m(Math.max(...cross.map(c => c.y1))), '十字太矮').toBeGreaterThan(4.5);
  });

  it('should frame the entrance with piers and a lintel', () => {
    const piers = tagged(plan, 'gatePier');
    const lintel = plan.overhead.find(v => v.tag === 'gateLintel')!;
    expect(piers.length, '門柱不是兩根').toBe(2);
    expect(lintel, '門沒有過樑').toBeTruthy();
    for (const p of piers) {
      expect(p.y1, '門柱沒有頂到過樑').toBeCloseTo(lintel.y0, 6);
      expect(Math.abs(p.x), '門柱站到過樑外面')
        .toBeLessThanOrEqual(lintel.w / 2 + 1e-9);
    }
  });
});
