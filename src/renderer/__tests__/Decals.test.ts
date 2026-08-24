import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getDecalVariants, DECAL_Y, MARK_Y } from '../geometry/buildings/decals';
import { volumesFor, VARIANT_COUNT } from '../geometry/buildings/massing';
import { maxAbsOf } from '../geometry/buildings/massing/volume';

/**
 * The narrowest variant's wall in this bucket, computed here rather than through
 * `narrowestBuildingEdge`. The paving geometry is built from that function, and using it as the
 * reference verifies the implementation against itself (BUG-226).
 */
function narrowestOf(z: number, d: Density, level: number): number {
  let lo = Infinity;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(z, d, level, vi);
    if (vs.length > 0) lo = Math.min(lo, maxAbsOf(vs));
  }
  return lo;
}
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, LEVELS, type Density }
  from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';

const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachDecal(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const level of LEVELS) {
      const variants = getDecalVariants(z, d, level);
      for (let i = 0; i < variants.length; i++) {
        const geo = variants[i]!();
        fn(geo, `${key} L${level} v${i}`);
        geo.dispose();
      }
    }
  });
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/**
 * The quads grouped by height.
 *
 * Each `PlaneGeometry` is four consecutive vertices and `mergeGeometries` concatenates them in
 * order, so each group of four is one quad. Two at different heights are meant to stack, since
 * markings sit over paving; two at the same height are not.
 */
function quadsByHeight(geo: THREE.BufferGeometry): Map<number, Rect[]> {
  const pos = geo.getAttribute('position');
  const out = new Map<number, Rect[]>();
  for (let q = 0; q + 3 < pos.count; q += 4) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < 4; k++) { xs.push(pos.getX(q + k)); zs.push(pos.getZ(q + k)); }
    const y = Math.round(pos.getY(q) * 1e6) / 1e6;
    const rect = {
      x0: Math.min(...xs), x1: Math.max(...xs),
      z0: Math.min(...zs), z1: Math.max(...zs),
    };
    const arr = out.get(y);
    if (arr) arr.push(rect);
    else out.set(y, [rect]);
  }
  return out;
}

/** Two rectangles' overlap area. Sharing an edge, which is zero area, is not an overlap. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

describe('decal geometry', () => {
  it('should exist for every zone at every level', () => {
    // The acceptance condition: no zone is left bare.
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        expect(getDecalVariants(z, d, level).length, `${key} L${level}`)
          .toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('should lie flat on the ground', () => {
    // A decal with thickness grows walls on its sides, and walls grow windows.
    eachDecal((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.min.y, `${label} 底層高度不對`).toBeCloseTo(DECAL_Y, 6);
      expect(b.max.y, `${label} 超過標線層`).toBeLessThanOrEqual(MARK_Y + 1e-9);
    });
  });

  it('should use exactly two heights — paving and markings', () => {
    // Parking bay lines lie over asphalt by nature, so two layers are necessary. More than two
    // means base layers are stacking on each other, and two quads at the same height and position
    // z-fight: invisible in a static screenshot, a flickering sheet as soon as the camera moves.
    eachDecal((geo, label) => {
      const pos = geo.getAttribute('position');
      const ys = new Set<number>();
      for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1e6));
      expect(ys.size, `${label} 有 ${ys.size} 個高度`).toBeLessThanOrEqual(2);
      for (const y of ys) {
        const v = y / 1e6;
        expect(v === DECAL_Y || Math.abs(v - MARK_Y) < 1e-9, `${label} 高度 ${v} 不是這兩層`)
          .toBe(true);
      }
    });
  });

  it('should never lay two quads on top of each other', () => {
    // "One surface per side" prevents two stacking on one side but not adjacent sides overlapping
    // at a **corner**: with all four paved, the north and east sides each span their full edge and
    // meet in four 1.5 m square overlaps. Two quads at the same height and position z-fight —
    // invisible in a static screenshot, a flickering sheet as soon as the camera moves — and this
    // layer lies at the foot of every building.
    //
    // A counting check, no more than four base quads, reads the number and not the positions.
    eachDecal((geo, label) => {
      for (const [y, rects] of quadsByHeight(geo)) {
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            expect(
              overlapArea(rects[i]!, rects[j]!),
              `${label} 高度 ${y} 的第 ${i}、${j} 塊重疊`,
            ).toBeLessThan(1e-9);
          }
        }
      }
    });
  });

  it('should never pave the same side twice', () => {
    // A base overlap is invisible once the geometry is merged, so it is prevented structurally: one
    // surface per side. This watches that there are no more than four base quads.
    eachDecal((geo, label) => {
      const pos = geo.getAttribute('position');
      let baseVerts = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - DECAL_Y) < 1e-9) baseVerts++;
      }
      // Each PlaneGeometry is 4 vertices.
      expect(baseVerts / 4, `${label} 底層有 ${baseVerts / 4} 塊`).toBeLessThanOrEqual(4);
    });
  });

  it('should sit just above the ground, not visibly floating', () => {
    // Too low it z-fights with the ground; too high it visibly floats.
    expect(DECAL_Y).toBeGreaterThan(0);
    expect(DECAL_Y).toBeLessThan(0.03);
  });

  it('should face up', () => {
    // Facing down, it is black seen from above.
    eachDecal((geo, label) => {
      const n = geo.getAttribute('normal');
      for (let i = 0; i < n.count; i++) {
        expect(n.getY(i), `${label} 頂點 ${i} 沒有朝上`).toBeGreaterThan(0.99);
      }
    });
  });

  it('should never overlap the building footprint or reach the neighbour', () => {
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        const inner = narrowestOf(z, d, level);
        for (const build of getDecalVariants(z, d, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
            expect(m, `${key} L${level} 頂點 ${i} 鋪進建築裡`)
              .toBeGreaterThanOrEqual(inner - 1e-6);
            expect(m, `${key} L${level} 頂點 ${i} 鋪到鄰居家`)
              .toBeLessThanOrEqual(CELL_EDGE + 1e-6);
          }
          geo.dispose();
        }
      }
    });
  });

  it('should only use the ground or foliage tags', () => {
    // Tagged PART_WALL it grows windows; tagged PART_ROOF it takes roof tile colours.
    eachDecal((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        const ok = (p > 0.35 && p < 0.65) || (p > 0.65 && p < 0.8);
        expect(ok, `${label} 頂點 ${i} 標籤 ${p}`).toBe(true);
      }
    });
  });

  it('should keep the shade channel inside [0, 1]', () => {
    eachDecal((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getZ(i), `${label} 頂點 ${i} 明度越界`).toBeGreaterThanOrEqual(0);
        expect(col.getZ(i), `${label} 頂點 ${i} 明度越界`).toBeLessThanOrEqual(1);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachDecal((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(TRIANGLE_BUDGET.PROP);
    });
  });

  it('should make the forecourt better with every level', () => {
    // Spec revision 4: a level has to read as better. Bare ground, then paving, then a plaza with
    // markings.
    eachBucket((z, d, key) => {
      const tri = (lv: number) => getDecalVariants(z, d, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tri(2), `${key} L2 沒有比 L1 好`).toBeGreaterThanOrEqual(tri(1));
      expect(tri(3), `${key} L3 沒有比 L1 好`).toBeGreaterThan(tri(1));
    });
  });

  it('should give industrial the darkest forecourt and commercial a paler one', () => {
    // An asphalt industrial site and a brick shopping street look nothing alike. Equal, this layer
    // merely lays the same grey carpet under every zone.
    const meanShade = (z: number, d: Density) => {
      const geo = getDecalVariants(z, d, 3)[0]!();
      const col = geo.getAttribute('color');
      let sum = 0;
      let n = 0;
      for (let i = 0; i < col.count; i++) {
        if (col.getX(i) > 0.65 && col.getX(i) < 0.8) { sum += col.getZ(i); n++; }
      }
      geo.dispose();
      return n === 0 ? 0 : sum / n;
    };
    expect(meanShade(5, 'LOW')).toBeLessThan(meanShade(4, 'HIGH'));
  });
});
