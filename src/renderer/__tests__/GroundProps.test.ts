import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  yardRing, hasGroundProps, getGroundPropVariants, PROP_TRIANGLE_BUDGET,
} from '../geometry/buildings/groundProps';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, LEVELS, type Density }
  from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';
import { lawnSidesFor, type Side } from '../geometry/buildings/decals';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** Planting above this height counts as a tree. A 1 m hedge and a 1.5 m topiary do not. */
const TREE_MIN_Y = 2.0 / METRES_PER_CELL;

/** Which side a point is on. The same convention as decals' `SIDE_AXIS`. */
function sideOf(x: number, z: number): Side {
  return Math.abs(z) >= Math.abs(x) ? (z < 0 ? 'n' : 's') : (x > 0 ? 'e' : 'w');
}

/**
 * Cluster centres of the high planting: one cluster is one tree.
 *
 * Deciding a side per vertex misidentifies them: for a tree at t = 0.3 and 0.329 from the centre,
 * the crown's outermost vertex is (0.358, 0.271), where |x| exceeds |z|, and that vertex counts as
 * belonging to the neighbouring side. A cluster centre does not, because it is the trunk's
 * position.
 *
 * Single-linkage clustering with a threshold of twice the crown diameter: trees are at least
 * 0.4 cells apart and a crown radius is at most 0.06 cells, an order of magnitude apart.
 */
function treeClusters(geo: THREE.BufferGeometry): Array<{ x: number; z: number }> {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < pos.count; i++) {
    const p = col.getX(i);
    if (p <= 0.35 || p >= 0.65) continue;          // 不是綠化
    if (pos.getY(i) < TREE_MIN_Y) continue;         // 不夠高
    pts.push([pos.getX(i), pos.getZ(i)]);
  }

  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const LINK = 0.25;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]) <= LINK) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, { x: number; z: number; n: number }>();
  for (let i = 0; i < pts.length; i++) {
    const r = find(i);
    const g = groups.get(r) ?? { x: 0, z: 0, n: 0 };
    g.x += pts[i]![0];
    g.z += pts[i]![1];
    g.n++;
    groups.set(r, g);
  }
  return [...groups.values()].map(g => ({ x: g.x / g.n, z: g.z / g.n }));
}

describe('yardRing', () => {
  it('should give the low-density house a yard worth looking at', () => {
    const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 1);
    expect(ring).not.toBeNull();
    // Above 1 m there is room for a visible hedge and tree.
    expect((ring!.outer - ring!.inner) * METRES_PER_CELL).toBeGreaterThan(1.0);
  });

  it('should give every zone a yard now that the buildings made room', () => {
    // With buildings narrowed, every zone now has at least 0.4 m. As "plot-filling zones have no
    // yard" filtered on width == 9.8, one change to the width selects nothing and the case runs
    // empty from then on.
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        expect(yardRing(Number(zs), ds as Density, level), `${key} L${level}`).not.toBeNull();
      }
    }
  });

  it('should never let the yard reach past the pedestrian envelope', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const ring = yardRing(Number(zs), ds as Density, level);
        if (!ring) continue;
        expect(ring.outer, `${key} L${level}`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
    }
  });

  it('should start the yard outside the widest the building can jitter to', () => {
    // With the inner edge taken from the target width alone, houses jittered to their widest grow
    // into the hedge.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      // The inner edge is measured — the widest of the eight variants — rather than target width
      // times a jitter factor. Footprints take 85% to 100% of the target, so the widest is still at
      // least 85% of it.
      for (const level of LEVELS) {
        const ring = yardRing(Number(zs), ds as Density, level);
        if (!ring) continue;
        const targetHalf = TARGET_WIDTHS_M[key]! / METRES_PER_CELL / 2;
        expect(ring.inner, `${key} L${level}`).toBeGreaterThanOrEqual(targetHalf * 0.85);
      }
    }
  });
});

describe('ground prop geometry', () => {
  function eachProp(fn: (geo: THREE.BufferGeometry, label: string) => void) {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const zoneType = Number(zs);
      const density = ds as Density;
      for (const level of LEVELS) {
        const variants = getGroundPropVariants(zoneType, density, level);
        for (let i = 0; i < variants.length; i++) {
          const geo = variants[i]!();
          fn(geo, `${key} L${level} v${i}`);
          geo.dispose();
        }
      }
    }
  }

  it('should keep every prop inside the pedestrian envelope', () => {
    // Crossing the outer bound means pedestrians walk through the hedge.
    eachProp((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(outer, `${label} 外緣`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should not put anything inside the house footprint', () => {
    // Every vertex has to satisfy max(|x|,|z|) >= inner: a bounding box alone misses a tree lying
    // across the house.
    for (const level of LEVELS) {
      const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', level)!;
      for (const build of getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)) {
        const geo = build();
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
          expect(m, `L${level} 頂點 ${i} 落在房子裡`).toBeGreaterThanOrEqual(ring.inner - 1e-6);
        }
        geo.dispose();
      }
    }
  });

  it('should sit on the ground, not float', () => {
    eachProp((geo, label) => {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `${label} 埋進地下`).toBeGreaterThanOrEqual(-1e-6);
      expect(geo.boundingBox!.min.y, `${label} 浮空`).toBeLessThan(0.02);
    });
  });

  it('should stay inside the triangle budget', () => {
    eachProp((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(PROP_TRIANGLE_BUDGET);
    });
  });

  it('should never tag a prop as wall — walls grow windows', () => {
    // PART_WALL takes the shader's facade branch and a trunk grows a grid of windows.
    eachProp((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i), `${label} 頂點 ${i} 標成 PART_WALL`).toBeGreaterThan(0.1);
      }
    });
  });

  it('should make the residential garden greener with every level', () => {
    // Spec revision 4: a level has to read as better. Bare yard, then hedge, then tended garden.
    //
    // It measures planting rather than total triangles: L1's four picket runs are many cheap posts,
    // and swapping them for a tree at L2 lowers the total. Triangle count is not a proxy for
    // richness; planted area is.
    const foliage = (level: number) =>
      getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)
        .map((b) => {
          const g = b();
          const col = g.getAttribute('color');
          let n = 0;
          for (let i = 0; i < col.count; i++) {
            if (col.getX(i) > 0.35 && col.getX(i) < 0.65) n++;
          }
          g.dispose();
          return n;
        })
        .reduce((a, b) => a + b, 0);
    expect(foliage(2), 'L2 沒有比 L1 綠').toBeGreaterThan(foliage(1));
    expect(foliage(3), 'L3 沒有比 L2 綠').toBeGreaterThan(foliage(2));
  });

  it('should make every zone richer with every level', () => {
    // For non-residential zones, better means more street furniture rather than more planting. The
    // comparison uses the richest recipe at each level; a sum is skewed by recipes with many cheap
    // pieces.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const richest = (level: number) => Math.max(
        ...getGroundPropVariants(Number(zs), ds as Density, level)
          .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; }),
      );
      expect(richest(3), `${key} L3 沒有比 L1 豐富`).toBeGreaterThan(richest(1));
      expect(richest(2), `${key} L2 沒有比 L1 豐富`).toBeGreaterThan(richest(1));
    }
  });

  it('should offer at least four yards per level', () => {
    // Two variants across four rotations give 8 faces, and an 8x8 block shows the repetition.
    for (const level of LEVELS) {
      expect(getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level).length,
        `L${level}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('should give every zone something standing on the ground', () => {
    // The point of narrowing the buildings: three-dimensional props are no longer residential
    // only.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        expect(getGroundPropVariants(Number(zs), ds as Density, level).length,
          `${key} L${level}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should use a vocabulary wider than a handful of shapes', () => {
    // A machine-checkable form of "too few types". Different pieces have different triangle counts,
    // so collecting every variant's count gives a set whose size is a lower bound on the
    // vocabulary.
    const sizes = new Set<number>();
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        for (const b of getGroundPropVariants(Number(zs), ds as Density, level)) {
          const g = b();
          sizes.add(triangleCount(g));
          g.dispose();
        }
      }
    }
    // With pipe racks, gas bottles and pallets added to industry the measured value is 24. 16 locks
    // in that expansion while leaving room for a few sizes to merge.
    expect(sizes.size, '所有庭院組合只有 ' + sizes.size + ' 種三角形數')
      .toBeGreaterThanOrEqual(16);
  });

  it('should keep every zone inside its own band, not just residential', () => {
    // Other zones' bands are 0.4 m, far narrower than low-density residential's 1.45 m, and reusing
    // the residential sizes goes straight through the wall.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const ring = yardRing(Number(zs), ds as Density, level)!;
        for (const build of getGroundPropVariants(Number(zs), ds as Density, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
            expect(m, `${key} L${level} 頂點 ${i} 落在建築裡`)
              .toBeGreaterThanOrEqual(ring.inner - 1e-6);
            expect(m, `${key} L${level} 頂點 ${i} 擋住行人`)
              .toBeLessThanOrEqual(ring.outer + 1e-6);
          }
          geo.dispose();
        }
      }
    }
  });

  it('should give two variants of the same level genuinely different yards', () => {
    for (const level of LEVELS) {
      const [a, b] = getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level);
      const ga = a!();
      const gb = b!();
      ga.computeBoundingBox();
      gb.computeBoundingBox();
      expect(ga.boundingBox!.equals(gb.boundingBox!), `L${level} 兩個變體外形相同`).toBe(false);
      ga.dispose();
      gb.dispose();
    }
  });

  it('should stand every tree on a lawn, never on tarmac', () => {
    // Trees grow on grass. The forecourt layer already states which sides are grass, and a tree on
    // any other side is a tree growing out of asphalt.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const lawn = lawnSidesFor(Number(zs), ds as Density, level);
        getGroundPropVariants(Number(zs), ds as Density, level).forEach((build, i) => {
          const geo = build();
          for (const c of treeClusters(geo)) {
            const side = sideOf(c.x, c.z);
            expect(lawn, `${key} L${level} v${i} 的樹站在 ${side}，那邊沒有草皮`)
              .toContain(side);
          }
          geo.dispose();
        });
      }
    }
  });

  it('should put a tree on the lawn wherever the forecourt lays one', () => {
    // The converse of the case above. Without it, planting no trees at all passes — and what shows
    // on screen is the empty lawn at the foot of the high-density and office zones.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const lawn = lawnSidesFor(Number(zs), ds as Density, level);
        if (lawn.length === 0) continue;
        const planted = getGroundPropVariants(Number(zs), ds as Density, level)
          .filter((build) => {
            const geo = build();
            const has = treeClusters(geo).some(c => lawn.includes(sideOf(c.x, c.z)));
            geo.dispose();
            return has;
          });
        expect(planted.length, `${key} L${level} 有草皮（${lawn.join(',')}）卻一棵樹都沒有`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('should give the industrial yard more kit than a commercial pavement', () => {
    // A machine-checkable form of "industry does not look industrial". Industry's level ladder does
    // not show in height, since modern plants are single-storey with high ceilings, so it rests
    // entirely on equipment: pipe racks, gas bottles, pallets, drums. With fewer pieces at
    // industrial L1 than at commercial — a low box and two drums — it reads as a plainer commercial
    // building.
    const richest = (z: number, level: number) => Math.max(
      ...getGroundPropVariants(z, 'LOW', level)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; }),
    );
    for (const level of LEVELS) {
      expect(richest(ZoneType.INDUSTRIAL, level), `L${level} 工業的廠區比商業人行道還空`)
        .toBeGreaterThan(richest(ZoneType.COMMERCIAL_LOW, level));
    }
  });

  it('should agree with hasGroundProps', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const has = hasGroundProps(Number(zs), ds as Density, level);
        expect(getGroundPropVariants(Number(zs), ds as Density, level).length > 0).toBe(has);
      }
    }
  });
});
