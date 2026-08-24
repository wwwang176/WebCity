import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../geometry/buildings/overheadProps';
import { OVERHEAD_CLEARANCE, SHOPFRONT_CEILING }
  from '../geometry/buildings/propBands';
import { volumesFor, VARIANT_COUNT } from '../geometry/buildings/massing';
import { maxAbsOf } from '../geometry/buildings/massing/volume';

/**
 * The narrowest variant's wall in this bucket.
 *
 * **Deliberately not `narrowestBuildingEdge`**: the canopy geometry is built from that function,
 * and using it as the reference verifies the implementation against itself, which is exactly how
 * BUG-226 escaped its test — that test measured `buildingEdge()` and the geometry was built from
 * it, so the two always agreed.
 */
function narrowestOf(z: number, d: Density, level: number): number {
  let lo = Infinity;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(z, d, level, vi);
    if (vs.length > 0) lo = Math.min(lo, maxAbsOf(vs));
  }
  return lo;
}
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachOverhead(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const level of LEVELS) {
      const variants = getOverheadVariants(z, d, level);
      for (let i = 0; i < variants.length; i++) {
        const geo = variants[i]!();
        fn(geo, `${key} L${level} v${i}`);
        geo.dispose();
      }
    }
  });
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Vertices per piece: four corners on each of two faces. */
const VERTS_PER_PIECE = 8;

/**
 * Splits the geometry back into per-piece plan outlines.
 *
 * Every overhang is a double-sided quad — four corners per face, 8 vertices — and
 * `mergeGeometries` concatenates them in order, so each group of 8 is one piece. Only XZ is read:
 * the building is solid at these heights, and whether something reaches the wall is a plan
 * question.
 */
function pieceRects(geo: THREE.BufferGeometry): Rect[] {
  const pos = geo.getAttribute('position');
  expect(pos.count % VERTS_PER_PIECE, '懸挑零件不是雙面 quad，分組失效').toBe(0);
  const out: Rect[] = [];
  for (let p = 0; p < pos.count; p += VERTS_PER_PIECE) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < VERTS_PER_PIECE; k++) {
      xs.push(pos.getX(p + k)); zs.push(pos.getZ(p + k));
    }
    out.push({
      x0: Math.min(...xs), x1: Math.max(...xs),
      z0: Math.min(...zs), z1: Math.max(...zs),
    });
  }
  return out;
}

/**
 * The tolerance for "attached".
 *
 * A sign 20 cm off the wall is still bolted to it, and demanding it sit flush makes it coplanar
 * and z-fight. 0.25 m is far below BUG-226's 0.68 to 1.17 m, so this tolerance does not let that
 * fault through.
 */
const MOUNT_TOLERANCE = 0.25 / METRES_PER_CELL;

const touches = (a: Rect, b: Rect) =>
  a.x0 <= b.x1 + MOUNT_TOLERANCE && b.x0 <= a.x1 + MOUNT_TOLERANCE
  && a.z0 <= b.z1 + MOUNT_TOLERANCE && b.z0 <= a.z1 + MOUNT_TOLERANCE;

/** Indices of pieces not connected to the building, whether directly or through another piece. */
function floatingPieces(geo: THREE.BufferGeometry, narrow: number): number[] {
  const rects = pieceRects(geo);
  const building: Rect = { x0: -narrow, x1: narrow, z0: -narrow, z1: narrow };
  const attached = rects.map(r => touches(r, building));
  for (let pass = 0; pass < rects.length; pass++) {
    let changed = false;
    rects.forEach((r, i) => {
      if (attached[i]) return;
      if (rects.some((o, j) => attached[j] && touches(r, o))) {
        attached[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return attached.flatMap((ok, i) => (ok ? [] : [i]));
}

describe('overhead props', () => {
  it('should never hang low enough to hit a walking person', () => {
    // The one reason overhangs exist: pedestrians walk beneath them. Below the clearance they
    // intersect.
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `${label} 會打到頭`)
        .toBeGreaterThanOrEqual(OVERHEAD_CLEARANCE - 1e-6);
    });
  });

  it('should actually reach past the pedestrian envelope', () => {
    // All of them inside the building's outline leaves this layer with no reason to exist: those
    // are facade components.
    const reaching: string[] = [];
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      if (outer > HALF_ENVELOPE) reaching.push(label);
    });
    expect(reaching.length, '沒有任何懸挑物真的挑出去').toBeGreaterThan(0);
  });

  it('should stop at the cell edge', () => {
    // Past the cell boundary it enters a neighbour's building.
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(outer, `${label} 伸進鄰居家`).toBeLessThanOrEqual(CELL_EDGE + 1e-6);
    });
  });

  it('should stay attached to the narrowest building in its bucket', () => {
    // BUG-226: measured against `widestBuildingEdge`, each building's width is jittered per
    // instance by +/-15% while a canopy's geometry is one copy shared across the whole
    // (zone, density, level) bucket and cannot know how wide the house it hangs on is. Attached to
    // the **widest** one, it floats 0.68 to 1.17 m away on every other, and the test verifies a
    // house nobody ever sees.
    //
    // The only way to always reach the wall is to bury inward into the narrowest one, where the
    // excess is hidden by the wall. So the inner edge is measured against
    // `narrowestBuildingEdge`.
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        const narrow = narrowestOf(z, d, level);
        for (const build of getOverheadVariants(z, d, level)) {
          const geo = build();
          // The test is **connectivity** rather than "a vertex touches the wall": a fascia hangs at
          // a canopy's outer edge and never touches the wall, yet rests on the canopy and is not
          // floating. Each piece is checked against the building or against a piece already known
          // not to float, iterated to a fixed point.
          //
          // The merged bounding box alone lets it through: with the south and east canopies both
          // floating, their combined box still encloses the building.
          const floating = floatingPieces(geo, narrow);
          expect(floating, `${key} L${level} 有 ${floating.length} 個零件浮空`)
            .toHaveLength(0);
          geo.dispose();
        }
      }
    });
  });

  it('should hang at shopfront height, not halfway up the facade', () => {
    // A canopy belongs at first-floor height. The facade shader's storey height is 2.64 to 3.6 m,
    // so the first-floor line takes the lowest: the storey height is also random per instance and
    // the geometry does not know which building it hangs on, and only the lowest value guarantees
    // it never crosses the first floor.
    //
    // At a hand-picked height in metres, 3.0 to 3.8 m, it hangs at 60% of the height of a 5 m
    // low-density commercial L1.
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const bottom = geo.boundingBox!.min.y;
      expect(bottom, `${label} 掛在 ${(bottom * METRES_PER_CELL).toFixed(2)} m，超過一樓`)
        .toBeLessThanOrEqual(SHOPFRONT_CEILING + 1e-6);
    });
  });

  it('should keep signs below the roofline of the shortest building it can sit on', () => {
    // A sign above the canopy is right; at the roof's edge it becomes something else.
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        const shortest = TARGET_HEIGHTS_M[key]![level - 1]! / METRES_PER_CELL;
        for (const build of getOverheadVariants(z, d, level)) {
          const geo = build();
          geo.computeBoundingBox();
          expect(geo.boundingBox!.max.y, `${key} L${level} 的招牌爬到屋頂`)
            .toBeLessThanOrEqual(shortest * 0.6);
          geo.dispose();
        }
      }
    });
  });

  it('should never be tagged as wall', () => {
    // A canopy growing a grid of windows would be strange.
    eachOverhead((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i), `${label} 頂點 ${i} 標成 PART_WALL`).toBeGreaterThan(0.1);
      }
    });
  });

  it('should be built from flat panels, not boxes', () => {
    // A canopy is 10 cm thick, which at 1 cell = 12 m never reaches a pixel, and five of its six
    // faces are invisible. A plane saves four fifths of the triangles.
    //
    // But a plane is single-sided — the material sets no side and defaults to FrontSide — while the
    // camera's azimuth turns freely, so each piece needs both faces: 4 triangles, still a third of
    // a BoxGeometry's.
    eachOverhead((geo, label) => {
      const pos = geo.getAttribute('position');
      expect(pos.count % VERTS_PER_PIECE, `${label} 不是雙面 quad`).toBe(0);
      expect(triangleCount(geo), `${label} 每片超過 4 個三角形`)
        .toBe((pos.count / VERTS_PER_PIECE) * 4);
    });
  });

  it('should be visible from every camera angle', () => {
    // A single-sided plane disappears seen from behind. The camera's elevation is clamped to 10-80
    // degrees while its azimuth is free, so upward-facing surfaces are always visible and vertical
    // ones are not — drawing both faces is the safe choice.
    //
    // The test: every piece's normals have to appear in pairs, n and -n, or one face is
    // missing.
    eachOverhead((geo, label) => {
      const n = geo.getAttribute('normal');
      const key = (i: number) =>
        `${n.getX(i).toFixed(4)},${n.getY(i).toFixed(4)},${n.getZ(i).toFixed(4)}`;
      const seen = new Set<string>();
      for (let i = 0; i < n.count; i++) seen.add(key(i));
      for (let i = 0; i < n.count; i++) {
        const flipped = `${(-n.getX(i)).toFixed(4)},${(-n.getY(i)).toFixed(4)},`
          + `${(-n.getZ(i)).toFixed(4)}`;
        expect(seen.has(flipped.replace(/-0\.0000/g, '0.0000')), `${label} 有一面沒畫`)
          .toBe(true);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachOverhead((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(OVERHEAD_TRIANGLE_BUDGET);
    });
  });

  it('should give commercial, office and industrial something at level 3', () => {
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [ZoneType.OFFICE, 'LOW'], [ZoneType.OFFICE, 'HIGH'],
      [ZoneType.INDUSTRIAL, 'LOW'], [ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      expect(getOverheadVariants(zone, density, 3).length, `zone ${zone}/${density}`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('should leave the detached house alone', () => {
    // A detached house has neither an arcade nor signage, and adding them makes it look like a
    // shop.
    for (const level of LEVELS) {
      expect(getOverheadVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)).toHaveLength(0);
    }
  });

  it('should earn its overhang with level', () => {
    // L1 is plain and L3 has an arcade and signage: this layer is part of the level ladder
    // itself.
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      const tris = (lv: number) => getOverheadVariants(zone, density, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tris(3), `zone ${zone} L3`).toBeGreaterThan(tris(1));
    }
  });
});
