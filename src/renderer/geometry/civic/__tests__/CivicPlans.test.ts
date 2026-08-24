import { describe, it, expect } from 'vitest';
import { getCivicPlan, civicTypesDone } from '../registry';
import {
  assembleCivic, assembleDecals, assembleFixtures, assembleVehicles,
} from '../assemble';
import { overlapOf } from '../../buildings/massing/volume';
import { propExtent } from '../../props';
import { CIVIC_TRIANGLE_BUDGET } from '../types';
import { getInfraConfig } from '../../../../core/building/InfraConfig';
import { PART_THRESHOLDS, triangleCount, ZONE_CAT, PART_GROUND } from '../../buildings/parts';
import { METRES_PER_CELL } from '../../../../core/grid/constants';
import { TUB, STACK, COOL } from '../../buildings/massing/metrics';
import type { Volume } from '../../buildings/massing/volume';

const isLamp = (p: number) =>
  p > PART_THRESHOLDS.LAMP_MIN && p < PART_THRESHOLDS.FOLIAGE_MIN;

const partOf = (v: Volume) => v.part ?? 0;

/**
 * Open containers: their interiors are **empty**, so their contents do not count as buried.
 *
 * `tub` and `basin` are vessels holding a water surface, and `stack` is a chimney whose mouth is
 * recessed nearly to the bottom with a dark floor inside. All three exist precisely so their
 * contents are visible, while the overlap check measures bounding boxes and does not know the
 * container is hollow.
 *
 * Whether the contents' **geometry** inside the container is right is guarded by each shape's own
 * tests (`MassingGeometry`'s tub / basin / stack, and `Utility.test.ts` on water level and mouth
 * colour).
 */
const OPEN_VESSEL: Record<string, number> = {
  tub: TUB.DEPTH, basin: TUB.DEPTH, stack: STACK.DEPTH, cooling: COOL.DEPTH,
};

function contains(vessel: Volume, inner: Volume): boolean {
  const depth = OPEN_VESSEL[vessel.shape ?? ''];
  if (depth === undefined) return false;
  // The cavity is only the top section. Anything below the floor really is buried, since that
  // part is solid.
  const cavity = vessel.y1 - depth * (vessel.y1 - vessel.y0);
  return Math.abs(inner.x - vessel.x) + inner.w / 2 <= vessel.w / 2 + 1e-9
    && Math.abs(inner.z - vessel.z) + inner.d / 2 <= vessel.d / 2 + 1e-9
    && inner.y1 <= vessel.y1 + 1e-9
    && inner.y0 >= cavity - 1e-9;
}

/**
 * This guards against a table-driven suite being green on an empty table.
 *
 * `describe.each([])` **skips** the whole group rather than failing, so with no plans at all none
 * of the checks below run and the report looks entirely healthy.
 *
 * It guards against the table being emptied by accident.
 */
describe('公共建築的資料表驗收', () => {
  it('should have at least one plan registered', () => {
    expect(
      civicTypesDone().length,
      '沒有任何 plan —— 下面所有的資料表測試都被跳過了，而報告看起來是綠的',
    ).toBeGreaterThan(0);
  });
});

describe.each(civicTypesDone())('%s 的 plan', (type) => {
  const plan = getCivicPlan(type)!;
  const cfg = getInfraConfig(type)!;
  const cells = cfg.width * cfg.height;
  const all = [...plan.massing, ...plan.props, ...plan.overhead];

  it('should match the footprint declared in InfraConfig', () => {
    // A mismatch means the geometry and the game rules disagree: the building either overruns a
    // neighbouring cell or huddles in a corner.
    expect(plan.footprint).toEqual({ w: cfg.width, h: cfg.height });
  });

  it('should have a facade category the shader knows', () => {
    expect(plan.facade, `${type} 的 facade 不是 FACADE_* 常數`).toBeGreaterThan(100);
    expect(ZONE_CAT[plan.facade], `facade ${plan.facade} 不在 ZONE_CAT 裡`).toBeDefined();
  });

  it('should build every layer without leaving the footprint', () => {
    // All six layers are listed. A missing layer leaves its overruns unguarded — vehicles were
    // missed once: a 6.7 m fire engine parked on the boundary reaching half a cell out after a 90
    // degree rotation is easy to write, and on screen it only reads as slightly overrunning the
    // next cell.
    expect(() => assembleCivic(plan.massing, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.props, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.overhead, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleDecals(plan.decals, plan.footprint)).not.toThrow();
    expect(() => assembleFixtures(plan.fixtures, plan.footprint)).not.toThrow();
    expect(() => assembleVehicles(plan.vehicles, plan.footprint)).not.toThrow();
  });

  it('should not bury one massing volume inside another', () => {
    // Overlapping masses create invisible interior faces: triangles spent for nothing, showing up
    // nowhere on screen.
    //
    // The tolerance is in cubic metres rather than a strict 0: `M()` divides by 12, so "this
    // piece's right edge" and "the next piece's left edge" are two different expressions for one
    // real number, about 1e-17 apart in floating point. Sharing an edge should be exactly 0, and
    // that 0 is not reachable in floating point. One cubic millimetre is not buried.
    for (let i = 0; i < plan.massing.length; i++) {
      for (let j = i + 1; j < plan.massing.length; j++) {
        const a = plan.massing[i]!;
        const b = plan.massing[j]!;
        // If one sits inside an open container, the overlap is with the cavity, not with solid
        // material.
        if (contains(a, b) || contains(b, a)) continue;
        const m3 = overlapOf(a, b) * METRES_PER_CELL ** 3;
        expect(m3, `${type}：${a.tag ?? i} 與 ${b.tag ?? j} 重疊 ${m3.toFixed(3)} m3`)
          .toBeLessThan(1e-6);
      }
    }
  });

  /**
   * Vehicles park on something paved.
   *
   * A vehicle parked on grass is visible at a glance and legal under every other check here: no
   * overrun, no overlap, no budget exceeded. The centre is computed from the **rotated** actual
   * geometry; with a hand-written dimension table, lengthening the fire engine would leave this
   * check working from the old numbers.
   *
   * It checks the centre rather than the whole vehicle: one wheel over the edge of the paving is
   * normal, and a vehicle **parked** on grass is the mistake.
   */
  it('should park every vehicle on something paved', () => {
    const hard = plan.decals.filter(d => (d.layer ?? 'base') === 'base' && !d.lawn);
    for (const v of plan.vehicles) {
      const geo = assembleVehicles([v], plan.footprint);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const on = hard.some(d =>
        Math.abs(cx - d.x) <= d.w / 2 + 1e-9 && Math.abs(cz - d.z) <= d.d / 2 + 1e-9);
      expect(on, `${type} 的 ${v.kind} 停在草地上（或根本沒有鋪面）`).toBe(true);
    }
  });

  /**
   * And no vehicle may be embedded in anything.
   *
   * A landfill's truck inside the waste mound and a sewage plant's truck inside a basin are one
   * hole: **no check asks whether anything else occupies the spot a vehicle parks on**. The
   * "parked on paving" case only asks which decal the vehicle's centre lands on, and a refuse
   * truck buried entirely in a mound has its centre sitting quite properly on paving.
   *
   * A vehicle's footprint is computed from the **actual geometry**, the rotated bounding box:
   * with a hand-written dimension table, lengthening the truck would leave this check working
   * from the old numbers.
   *
   * `overhead` does not count — a canopy is there for vehicles to park under. Nor do trees: a
   * crown at 6 m is something a vehicle correctly parks beneath.
   */
  it('should park every vehicle in the clear', () => {
    const span = (a0: number, a1: number, b0: number, b1: number) =>
      Math.min(a1, b1) - Math.max(a0, b0) > 1e-9;
    const boxes = plan.vehicles.map((v) => {
      const geo = assembleVehicles([v], plan.footprint);
      geo.computeBoundingBox();
      return { v, b: geo.boundingBox! };
    });

    for (const { v, b } of boxes) {
      for (const [i, s] of [...plan.massing, ...plan.props].entries()) {
        const hit = span(b.min.x, b.max.x, s.x - s.w / 2, s.x + s.w / 2)
          && span(b.min.z, b.max.z, s.z - s.d / 2, s.z + s.d / 2)
          && span(b.min.y, b.max.y, s.y0, s.y1);
        expect(hit, `${type} 的 ${v.kind} 卡進 ${s.tag ?? i}`).toBe(false);
      }
      for (const f of plan.fixtures) {
        if (f.kind === 'tree') continue;
        const e = propExtent(f);
        const hit = span(b.min.x, b.max.x, f.x - e.x, f.x + e.x)
          && span(b.min.z, b.max.z, f.z - e.z, f.z + e.z);
        expect(hit, `${type} 的 ${v.kind} 停在 ${f.kind} 上`).toBe(false);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const c = boxes[j]!;
        const hit = span(a.b.min.x, a.b.max.x, c.b.min.x, c.b.max.x)
          && span(a.b.min.z, a.b.max.z, c.b.min.z, c.b.max.z);
        expect(hit, `${type} 的 ${a.v.kind} 與 ${c.v.kind} 停在同一格`).toBe(false);
      }
    }
  });

  /**
   * Shared primitives may not grow inside a mass either.
   *
   * The "no vehicle embedded in anything" case catches vehicles, while lamps, trees, pipe racks
   * and fences live in another layer (`fixtures`) where the same mistake is unguarded. A lamp
   * growing out of a plant's wall and a refuse truck parked inside a mound are the same thing.
   *
   * Three exceptions, each of them correct rather than a temporary pass:
   *
   * - **Raised masses do not count.** A crown reaching under an 11 m eave, or a flower bed
   *   standing beneath a cap 20 m up: those overlap in plan and are metres apart in space.
   * - **`PART_GROUND` masses do not count.** Platforms, quay decks and aprons are paving for
   *   people to stand on, and a lamp standing on one is correct.
   * - **Point primitives are compared by centre only.** A tree's `propExtent` reports the
   *   **crown** radius while its trunk is what it occupies. Linear ones — pipe racks, hedges,
   *   bike racks — are compared along their whole length, since a pipe rack running through a
   *   wall can have its centre sitting quite properly outside it.
   */
  it('should not grow a fixture inside a building', () => {
    const span = (a0: number, a1: number, b0: number, b1: number) =>
      Math.min(a1, b1) - Math.max(a0, b0) > 1e-9;
    /** These stand on the ground as a single upright, occupying only their own point. */
    const POINTY = new Set(['tree', 'shrub', 'topiary', 'flowerBed', 'lamp',
      'bin', 'bollard', 'hydrant', 'mailbox', 'drum']);
    const GROUND_LEVEL = 0.5 / METRES_PER_CELL;

    for (const f of plan.fixtures) {
      // A fence runs the whole plot boundary and passes walls by design.
      if (f.kind === 'fence') continue;
      const e = POINTY.has(f.kind) ? { x: 0, z: 0 } : propExtent(f);
      for (const [i, v] of [...plan.massing, ...plan.props].entries()) {
        if (v.y0 > GROUND_LEVEL) continue;
        if (v.part === PART_GROUND) continue;
        const hit = span(f.x - e.x, f.x + e.x, v.x - v.w / 2, v.x + v.w / 2)
          && span(f.z - e.z, f.z + e.z, v.z - v.d / 2, v.z + v.d / 2);
        expect(hit, `${type} 的 ${f.kind} 長在 ${v.tag ?? i} 裡`).toBe(false);
      }
    }
  });

  it('should not paint a marking in grass', () => {
    // `lawn` takes the `PART_FOLIAGE` branch, which ignores `shade` entirely. So a marking tagged
    // `lawn` is **green** while `shade: 1.0`, white paint, still sits there in the data. Two
    // fields contradicting each other with nothing reported is this structure's quietest failure
    // mode.
    for (const d of plan.decals.filter(x => x.layer === 'mark')) {
      expect(d.lawn, `${type} 有一條長在草裡的標線 —— 它會是綠的`).toBeFalsy();
    }
  });

  it('should keep the overhead layer above head height', () => {
    // Canopies, platform roofs and signage all live in this layer and all have to clear a
    // pedestrian. 2.2 m is `OVERHEAD_CLEARANCE`. Anything lower looks fine in an isometric view
    // and turns out, up close, to cut through people's heads.
    for (const v of plan.overhead) {
      const h = v.y0 * METRES_PER_CELL;
      expect(h, `${type} 的 ${v.tag ?? '懸挑'} 只有 ${h.toFixed(1)} m 高 —— 會打到人`)
        .toBeGreaterThan(2.2);
    }
  });

  /** This case is BUG-238 itself: if everything is still dark at night when it is done, it turns red. */
  it('should light something at night', () => {
    // Both sources count: custom masses tagged PART_LAMP, and the shared primitive lamp
    // (`geometry/props`'s `lamp`, whose head is PART_LAMP already). Checking one alone, a building
    // that switched entirely to shared lamps would read as having none.
    const custom = all.filter(v => isLamp(partOf(v))).length;
    const shared = plan.fixtures.filter(f => f.kind === 'lamp').length;
    expect(custom + shared, `${type} 一盞燈都沒有 —— 夜裡它會是一塊黑`)
      .toBeGreaterThan(0);
  });

  it('should not tag a whole lamp post as glowing', () => {
    // Tagging the whole thing as glowing gives a post lit from the ground to the top at night
    // (the lesson of BUG-230). The head is PART_LAMP and the pole is PART_DETAIL.
    for (const v of all.filter(x => isLamp(partOf(x)))) {
      const h = (v.y1 - v.y0) * METRES_PER_CELL;
      expect(h, `${type} 有一個 ${h.toFixed(1)} m 高的發光體 —— 那是燈桿不是燈頭`)
        .toBeLessThan(1.5);
    }
  });

  it('should sit on the ground', () => {
    // The lowest mass sits on the ground. A whole building floating 0.6 m up is the shape of
    // BUG-224, and in an isometric view it reads only as "the shadow looks odd".
    const lowest = Math.min(...plan.massing.map(v => v.y0));
    expect(lowest, `${type} 的量體整批離地`).toBeLessThanOrEqual(1e-6);
  });

  it('should stay inside the per-cell triangle budget', () => {
    const layers: Array<[string, number, number]> = [
      ['量體', triangleCount(assembleCivic(plan.massing, plan.footprint, plan.color)),
        CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * cells],
      ['貼片', triangleCount(assembleDecals(plan.decals, plan.footprint)),
        CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL * cells],
      ['矮物件', triangleCount(assembleCivic(plan.props, plan.footprint, plan.color))
        + triangleCount(assembleFixtures(plan.fixtures, plan.footprint)),
        CIVIC_TRIANGLE_BUDGET.PROP_BASE + CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL * cells],
      ['懸挑', triangleCount(assembleCivic(plan.overhead, plan.footprint, plan.color)),
        CIVIC_TRIANGLE_BUDGET.OVERHEAD_PER_CELL * cells],
    ];
    for (const [name, tris, budget] of layers) {
      expect(tris, `${type} 的${name}超支：${tris} > ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('should give the shader a usable seed', () => {
    // aSeed.x is the floor rhythm, which the shader reads as mix(MIN, MAX, aSeed.x). Outside
    // [0,1] it extrapolates to a storey height that does not exist, and the facade's window panes
    // stop lining up with the mass's floor lines.
    for (const [i, s] of plan.seed.entries()) {
      expect(s, `${type} 的 seed[${i}] 不在 [0,1]`).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
