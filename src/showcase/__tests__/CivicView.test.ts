import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { civicTriangleReport, placeCivic, allMeshes } from '../civic';
import { CIVIC_TRIANGLE_BUDGET } from '../../renderer/geometry/civic/types';
import { FACADE_CIVIC, PART_LAMP, ZONE_CAT } from '../../renderer/geometry/buildings/parts';
import type { CivicPlan } from '../../renderer/geometry/civic/types';

const NO_TRIS = { massing: 0, decal: 0, prop: 0, overhead: 0 };

describe('civic 檢視的三角形統計', () => {
  it('should scale the budget by footprint, not per building', () => {
    // A 2x2 hospital cannot be measured against the per-building HOUSE: 400, a line drawn for one
    // building per cell. The sample is three cells' worth rather than a literal: written as a
    // literal, recalibrating the budget turns this red for a reason unrelated to what it tests.
    const threeCells = CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 3;
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: threeCells });
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4);
    expect(r.over.massing, '四格的預算容不下三格的量').toBe(false);
  });

  it('should flag a plan that blows the budget', () => {
    // "One triangle over" is derived from the budget rather than written as a literal: as a literal,
    // adjusting CIVIC_TRIANGLE_BUDGET silently turns this into a case that reports nothing.
    const justOver = CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4 + 1;
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: justOver });
    expect(r.over.massing).toBe(true);
    const exact = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: justOver - 1 });
    expect(exact.over.massing, '剛好用完預算不算超支').toBe(false);
  });

  it('should count cells as w * h, not as the longer side', () => {
    // A 9 by 6 large airport is 54 cells. Taking the longer edge understates the budget sixfold and
    // marks the whole table red.
    const r = civicTriangleReport({ w: 9, h: 6 }, NO_TRIS);
    expect(r.cells).toBe(54);
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 54);
  });

  it('should budget all four layers', () => {
    const r = civicTriangleReport({ w: 1, h: 1 }, NO_TRIS);
    expect(r.budget).toEqual({
      massing: CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL,
      decal: CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL,
      prop: CIVIC_TRIANGLE_BUDGET.PROP_BASE + CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL,
      overhead: CIVIC_TRIANGLE_BUDGET.OVERHEAD_PER_CELL,
    });
  });

  it('should flag each layer independently', () => {
    // Each layer has its own budget and its own problems; under a single switch, which one is over
    // budget is guesswork.
    const r = civicTriangleReport({ w: 1, h: 1 }, { ...NO_TRIS, prop: 999 });
    expect(r.over).toEqual({ massing: false, decal: false, prop: true, overhead: false });
  });
});

describe('placeCivic 的四層', () => {
  /** One recognisable object per layer, so that all four can be confirmed to exist. */
  const fullPlan = (): CivicPlan => ({
    footprint: { w: 2, h: 2 },
    facade: FACADE_CIVIC,
    color: [0.2, 0.3, 0.8],
    seed: [0.25, 0.5, 0.75],
    massing: [{ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5 }],
    decals: [{ x: 0, z: 0, w: 1.8, d: 1.8, shade: 0.4 }],
    props: [{ x: 0.6, z: 0.6, w: 0.2, d: 0.2, y0: 0, y1: 0.3, part: PART_LAMP }],
    overhead: [{ x: 0, z: 0.6, w: 0.8, d: 0.3, y0: 0.4, y1: 0.45 }],
    fixtures: [{ kind: 'tree', x: -0.6, z: 0.6, heightM: 5, crownRadius: 0.1 }],
    vehicles: [{ kind: 'policeCar', x: 0.5, z: -0.5 }],
  });

  it('should build every layer', () => {
    // Five building meshes against four budget fields: the shared ground props take a mesh of their
    // own, since cones and spheres do not merge into the frusta, but they are ground props and their
    // triangles count in the prop field.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    expect(placed.building.length, '有一層沒有建出來').toBe(5);
    for (const key of ['massing', 'decal', 'prop', 'overhead'] as const) {
      expect(placed.tris[key], `${key} 是空的`).toBeGreaterThan(0);
    }
  });

  it('should keep the parked vehicles out of the building meshes', () => {
    // Vehicles take a different material and must **never** be touched by stampZoneCategory, which
    // overwrites the real RGB in color with part labels and turns a white and blue police car into a
    // block of grey.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    expect(placed.vehicles, '沒有停車').not.toBeNull();
    expect(placed.building).not.toContain(placed.vehicles);
    expect(placed.vehicles!.geometry.getAttribute('aOccupancy'),
      '車輛被餵了建築的逐實例屬性').toBeUndefined();
    expect(allMeshes(placed).length).toBe(placed.building.length + 1);
  });

  it('should report no vehicle mesh when nothing is parked', () => {
    const placed = placeCivic({ ...fullPlan(), vehicles: [] }, new THREE.Scene(), 0.8)!;
    expect(placed.vehicles).toBeNull();
    expect(allMeshes(placed).length).toBe(placed.building.length);
  });

  it('should count shared fixtures into the prop budget, not a fifth one', () => {
    const withPlants = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const noPlants = placeCivic({ ...fullPlan(), fixtures: [] }, new THREE.Scene(), 0.8)!;
    expect(withPlants.tris.prop, '共用矮物件沒有算進 prop 的三角形數')
      .toBeGreaterThan(noPlants.tris.prop);
  });

  /**
   * The shape of BUG-230c: writing the per-instance attributes only on the massing layer.
   *
   * Signs and lamp heads live on the ground-prop and overhead layers and take their brightness from
   * the same `aOccupancy`. Fed to the massing layer alone, those two stay at 0, the shader reads
   * nobody home, and every street lamp and sign in the city is dark.
   */
  it('should stamp the per-instance attributes on every layer', () => {
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    for (const m of placed.building) {
      for (const name of ['aOccupancy', 'aSeed', 'aHighlight', 'aHighlightColor']) {
        expect(m.geometry.getAttribute(name), `某一層少了 ${name}`).toBeTruthy();
      }
      expect(m.geometry.getAttribute('aOccupancy').getX(0)).toBeCloseTo(0.8, 6);
      expect(m.geometry.getAttribute('aSeed').getX(0), 'aSeed 不是 plan 給的值')
        .toBeCloseTo(0.25, 6);
    }
  });

  it('should stamp the facade category on every layer', () => {
    // Without it that layer's vZoneCat is 0 and it takes the low-residential facade branch.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    for (const m of placed.building) {
      expect(m.geometry.getAttribute('color').getY(0), '某一層沒有蓋上立面類別')
        .toBeCloseTo(ZONE_CAT[FACADE_CIVIC]!, 6);
    }
  });

  it('should carry the building colour into every layer', () => {
    // Without it the shader reads aBldgColor = 0 and the whole building is black.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const massing = placed.building[1]!;   // 順序：貼片、量體、自訂矮物件、共用矮物件、懸挑
    const a = massing.geometry.getAttribute('aBldgColor');
    expect(a, '量體層沒有 aBldgColor').toBeTruthy();
    // Float32 cannot hold 0.2 exactly, and a bitwise comparison fails for a reason unrelated to
    // colour.
    for (const [i, want] of [0.2, 0.3, 0.8].entries()) {
      expect([a.getX(0), a.getY(0), a.getZ(0)][i]).toBeCloseTo(want, 6);
    }
  });

  it('should not flatten a per-volume colour override', () => {
    // `assembleCivic` writes aBldgColor per volume: the hospital's red cross, the university's
    // golden dome. `stampInstanceValues` rewriting the whole array unconditionally flattens those
    // overrides, and on screen that shows only as the red cross being gone.
    const p = fullPlan();
    p.massing = [
      { x: -0.3, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 0.5 },
      { x: 0.3, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 0.5, color: [1, 0, 0] },
    ];
    const placed = placeCivic(p, new THREE.Scene(), 0.8)!;
    const a = placed.building[1]!.geometry.getAttribute('aBldgColor');
    const seen = new Set<string>();
    for (let i = 0; i < a.count; i++) {
      seen.add([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(2)).join(','));
    }
    expect(seen.size, '逐量體的顏色覆寫被抹平了').toBe(2);
  });

  it('should cull only the prop and overhead layers', () => {
    // Decals do not switch off: they are flat paving, and switching them off empties the ground at a
    // distance. Nor, of course, does the massing.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    expect(placed.culled.length, '自訂矮物件、共用矮物件、懸挑、車輛四層要跟著遠景關掉')
      .toBe(4);
  });

  it('should not cast shadows from the decal layer', () => {
    // Flat paving casting a shadow draws a black rim beneath itself.
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const noShadow = placed.building.filter(m => !m.castShadow);
    expect(noShadow.length, '不投影的層數不是一層（貼片）').toBe(1);
  });

  /**
   * Laid out together, each of the nineteen still carries plan coordinates measured from its own
   * footprint centre, so placement translates the whole building. A layer left out — the vehicles
   * most easily, as they do not go through that loop — stays at the origin and reads as one
   * building's trees standing in someone else's plot.
   */
  it('should move every layer to the slot it was given', () => {
    const at = { x: 6, z: -4 };
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8, at);
    for (const m of allMeshes(placed)) {
      expect(m.position.x, '有一層沒有跟著平移').toBeCloseTo(at.x, 6);
      expect(m.position.z, '有一層沒有跟著平移').toBeCloseTo(at.z, 6);
    }
  });

  it('should keep each layer at its own height when moved', () => {
    // The translation moves the horizontal plane only. Overwriting y as well lifts the decals off
    // the ground, or sinks the whole building into it.
    const here = placeCivic(fullPlan(), new THREE.Scene(), 0.8);
    const there = placeCivic(fullPlan(), new THREE.Scene(), 0.8, { x: 6, z: -4 });
    expect(there.building.map(m => m.position.y))
      .toEqual(here.building.map(m => m.position.y));
  });

  it('should stand at the origin when no slot is given', () => {
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8);
    expect(placed.building.every(m => m.position.x === 0 && m.position.z === 0)).toBe(true);
  });

  it('should skip a layer that has nothing in it', () => {
    // A park has no overhangs, and building a mesh for empty geometry spends a draw call for
    // nothing.
    const placed = placeCivic(
      { ...fullPlan(), overhead: [], props: [], fixtures: [], vehicles: [] },
      new THREE.Scene(), 0.8,
    )!;
    expect(placed.building.length).toBe(2);
    expect(placed.culled.length).toBe(0);
  });
});
