import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnarTree, shrubBall, plantRadius } from '../plants';
import { getGroundPropVariants } from '../buildings/groundProps';
import {
  PART_DETAIL, PART_FOLIAGE, triangleCount,
} from '../buildings/parts';
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../buildings/registry';
import { METRES_PER_CELL } from '../../../core/grid/constants';

const M = (m: number) => m / METRES_PER_CELL;

interface PropFingerprint { tris: number; fp: string }

/**
 * A stable fingerprint: every vertex coordinate and tag, quantised to 1e-6 and accumulated.
 *
 * A triangle count alone is not enough: moving a tree, changing its radius or mis-tagging a piece
 * all leave the count unchanged. A mechanical move of 20 functions needs something that can prove
 * "identical".
 */
function fingerprint(g: THREE.BufferGeometry): string {
  let h = 2166136261;
  for (const name of ['position', 'color'] as const) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = a.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) {
      const q = Math.round(arr[i]! * 1e6);
      h = Math.imul(h ^ (q & 0xffff), 16777619);
      h = Math.imul(h ^ ((q >>> 16) & 0xffff), 16777619);
    }
  }
  return (h >>> 0).toString(16);
}

const BASELINE: Record<string, PropFingerprint[]> = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '__tests__', 'fixtures',
    'ground-prop-triangles.json'),
  'utf8',
));

function tagsOf(geos: ReturnType<typeof columnarTree>): number[] {
  return geos.map(g => g.getAttribute('color').getX(0));
}

/**
 * Planting primitives.
 *
 * Separated because a civic building drawing its own tree gives two differently shaped trees in
 * one city, with a change to one not reaching the other.
 *
 * This module **does not know** who calls it: it takes world coordinates and sizes, not "the
 * cell's prop band". The residential side computes coordinates from its band and then calls in,
 * while civic buildings pass coordinates directly.
 */
describe('柱狀樹', () => {
  it('should be a trunk plus a crown, not one lump', () => {
    const parts = columnarTree(0, 0, 6, M(1.2));
    expect(parts.length, '樹應該是兩件：樹幹與樹冠').toBe(2);
  });

  it('should tag the trunk as detail and the crown as foliage', () => {
    // A trunk tagged PART_WALL grows windows, and a mis-tagged crown is not green. Exact
    // comparison does not work: vertex colours are Float32 and cannot hold 0.2.
    const [trunk, crown] = tagsOf(columnarTree(0, 0, 6, M(1.2)));
    expect(trunk).toBeCloseTo(PART_DETAIL, 6);
    expect(crown).toBeCloseTo(PART_FOLIAGE, 6);
  });

  it('should stack the crown on top of the trunk', () => {
    const [trunk, crown] = columnarTree(0, 0, 6, M(1.2));
    trunk!.computeBoundingBox();
    crown!.computeBoundingBox();
    expect(crown!.boundingBox!.min.y, '樹冠沒有坐在樹幹上')
      .toBeGreaterThanOrEqual(trunk!.boundingBox!.max.y - 1e-6);
  });

  it('should reach the height it was asked for', () => {
    const parts = columnarTree(0, 0, 6, M(1.2));
    let top = 0;
    for (const g of parts) {
      g.computeBoundingBox();
      top = Math.max(top, g.boundingBox!.max.y);
    }
    expect(top * METRES_PER_CELL).toBeCloseTo(6, 3);
  });

  it('should stand where it was put', () => {
    // This compares the same tree at the origin against the same tree at (0.4, -0.25), rather
    // than measuring its centre.
    //
    // The trunk is a five-sided prism whose end caps are fans with a centre vertex, so **neither**
    // the bounding box centre nor the vertex mean lies on the axis; each is about 1 mm off. That
    // is not a positioning error, but asserting on either would turn this case red for a reason
    // unrelated to position.
    const at0 = columnarTree(0, 0, 6, M(1.2))[0]!;
    const at1 = columnarTree(0.4, -0.25, 6, M(1.2))[0]!;
    const p0 = at0.getAttribute('position');
    const p1 = at1.getAttribute('position');
    expect(p1.count).toBe(p0.count);
    for (let i = 0; i < p0.count; i++) {
      expect(p1.getX(i) - p0.getX(i)).toBeCloseTo(0.4, 6);
      expect(p1.getZ(i) - p0.getZ(i)).toBeCloseTo(-0.25, 6);
      expect(p1.getY(i) - p0.getY(i), '不該動到高度').toBeCloseTo(0, 9);
    }
  });

  it('should report a radius wide enough to bound the crown', () => {
    // Civic buildings use it for the plot check: under-reported, a tree reaches out over a
    // neighbouring cell.
    const r = M(1.2);
    const [, crown] = columnarTree(0, 0, 6, r);
    crown!.computeBoundingBox();
    const half = Math.max(
      Math.abs(crown!.boundingBox!.min.x), Math.abs(crown!.boundingBox!.max.x),
    );
    expect(plantRadius({ kind: 'tree', x: 0, z: 0, heightM: 6, crownRadius: r }))
      .toBeGreaterThanOrEqual(half - 1e-9);
  });
});

describe('灌木球', () => {
  it('should be foliage and sit on the ground', () => {
    const g = shrubBall(0, 0, M(0.8));
    expect(g.getAttribute('color').getX(0)).toBe(PART_FOLIAGE);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
  });
});

/**
 * The residential trees must not change by **a single triangle**.
 *
 * Moving the low-prop implementation into a shared module leaves the residential side computing
 * coordinates first and then calling in. The baseline was captured **before** any code moved: a
 * baseline captured after the refactor is no baseline at all.
 *
 * It compares a **vertex fingerprint** rather than only a triangle count: a wrong position, a
 * wrong radius or a mis-tagged piece all leave the count unchanged.
 */
describe('住宅的庭院沒有被這次重構動到', () => {
  it('should keep every ground prop variant at its original triangle count', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [z, d] = key.split(':');
      for (const lv of LEVELS) {
        const got = getGroundPropVariants(Number(z), d as Density, lv).map((b) => {
          const g = b();
          const r = { tris: triangleCount(g), fp: fingerprint(g) };
          g.dispose();
          return r;
        });
        expect(got, `${key}:${lv} 的庭院變了`).toEqual(BASELINE[`${key}:${lv}`]);
      }
    }
  });
});
