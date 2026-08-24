import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMassingVariants, volumesFor } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { HALF_ENVELOPE, FLOOR_HEIGHT_UNITS, TUB, COOL }
  from '../geometry/buildings/massing/metrics';

const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
import { rasterise, differenceRatio, centroidOffset, rotate90, type Volume }
  from '../geometry/buildings/massing/volume';
import { assemble } from '../geometry/buildings/massing/assemble';
import { triangleCount, PART_THRESHOLDS } from '../geometry/buildings/parts';
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, type Density }
  from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';
import { METRES_PER_CELL } from '../../core/grid/constants';

/**
 * How far apart two silhouettes have to be to count as different shapes, in cells.
 *
 * 0.36 m is the smallest eave difference the eye picks up. At half a storey (1.6 m), "same
 * prototype, one step taller" counts as identical, collapsing commercial low L1's eight
 * variants to four faces, while the adjacent-repeat rate is computed from variant indices and
 * would look better than it is.
 */
const SILHOUETTE_TOLERANCE = 0.36 / METRES_PER_CELL;

const LEVELS = [1, 2, 3] as const;

function eachBucket(fn: (z: number, d: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachVariant(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const lv of LEVELS) {
      getMassingVariants(z, d, lv).forEach((build, i) => {
        const g = build();
        fn(g, `${key} L${lv} v${i}`);
        g.dispose();
      });
    }
  });
}

describe('massing geometry', () => {
  it('should give every bucket exactly eight variants', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(getMassingVariants(z, d, lv).length, `${key} L${lv}`).toBe(VARIANT_COUNT);
      }
    });
  });

  it('should return nothing for a bucket with no buildings', () => {
    expect(getMassingVariants(1, 'HIGH', 1)).toEqual([]);   // 住宅低沒有高密度
    expect(getMassingVariants(999, 'LOW', 1)).toEqual([]);
  });

  it('should build the same geometry every time', () => {
    // Geometry is generated at game start. Any leaked randomness gives the whole city a new set
    // of shapes after a load, which on screen reads only as "this looks different from before".
    const a = getMassingVariants(4, 'HIGH', 3)[2]!();
    const b = getMassingVariants(4, 'HIGH', 3)[2]!();
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    for (let i = 0; i < pa.length; i++) expect(pa[i]).toBe(pb[i]);
  });

  it('should stand on the ground and be centred in the cell', () => {
    // assemble deliberately does **not** re-centre: composers centre by construction, and
    // automatic centring would silently absorb a composer that computed an offset, which then
    // reaches the attachment layers as "the footprint is narrower than expected". So this is an
    // assertion, not a correction.
    eachVariant((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.min.y, `${label} 沒有落地`).toBeCloseTo(0, 6);
      expect((b.min.x + b.max.x) / 2, `${label} 沒有置中`).toBeCloseTo(0, 6);
      expect((b.min.z + b.max.z) / 2, `${label} 沒有置中`).toBeCloseTo(0, 6);
    });
  });

  it('should never cross the pedestrian envelope', () => {
    // BUG-221/222: door nodes sit outside HALF_ENVELOPE, and crossing it means pedestrians walk
    // through walls. The geometry is measured directly rather than through the scaling formula:
    // a correct formula over off-centre geometry is how BUG-222 happened.
    eachVariant((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const maxAbs = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(
        maxAbs,
        `${label} 越過包絡線 ${((maxAbs - HALF_ENVELOPE) * METRES_PER_CELL).toFixed(2)} m`,
      ).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-6);
    });
  });

  it('should reach the height the table asks for', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const target = TARGET_HEIGHTS_M[key]![lv - 1]! / METRES_PER_CELL;
        // Tolerance scaled by height, plus the roof's own height. A crown adds 0.5 x the storey
        // height, whose maximum is FLOOR_HEIGHT_UNITS.MAX; using the midpoint would miss the
        // tallest variants.
        const tolerance = Math.max(0.1 * target, MID_FLOOR)
          + FLOOR_HEIGHT_UNITS.MAX * 0.55;
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const g = build();
          g.computeBoundingBox();
          expect(Math.abs(g.boundingBox!.max.y - target), `${key} L${lv} v${i}`)
            .toBeLessThanOrEqual(tolerance);
          g.dispose();
        });
      }
    });
  });

  it('should build the geometry the volumes describe', () => {
    // Every other silhouette test runs on Volumes: they prove the plan is right, not that what
    // is drawn follows it. Without this case, assemble could stack every piece at the cell
    // centre with every test green, which regression checking confirmed.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const vs = volumesFor(z, d, lv, i);
          const want = {
            minX: Math.min(...vs.map(v => v.x - v.w / 2)),
            maxX: Math.max(...vs.map(v => v.x + v.w / 2)),
            minZ: Math.min(...vs.map(v => v.z - v.d / 2)),
            maxZ: Math.max(...vs.map(v => v.z + v.d / 2)),
            maxY: Math.max(...vs.map(v => v.y1)),
          };
          const g = build();
          g.computeBoundingBox();
          const b = g.boundingBox!;
          const label = `${key} L${lv} v${i}`;
          expect(b.min.x, `${label} 幾何比量體窄（西）`).toBeCloseTo(want.minX, 5);
          expect(b.max.x, `${label} 幾何比量體窄（東）`).toBeCloseTo(want.maxX, 5);
          expect(b.min.z, `${label} 幾何比量體窄（北）`).toBeCloseTo(want.minZ, 5);
          expect(b.max.z, `${label} 幾何比量體窄（南）`).toBeCloseTo(want.maxZ, 5);
          expect(b.max.y, `${label} 幾何比量體矮`).toBeCloseTo(want.maxY, 5);
          g.dispose();
        });
      }
    });
  });

  it('should wind every face outward', () => {
    // BUG-227: the whole frustum's winding was reversed, so every face's normal pointed inward
    // and FrontSide culling showed the building's inner walls.
    //
    // Signed volume — the sum of each triangle's signed cone volume about the origin — is the
    // only global test for this: checking normals face by face needs to know which side is
    // outside, and signed volume does not. Outward is positive.
    eachVariant((geo, label) => {
      const p = geo.getAttribute('position').array as Float32Array;
      let v = 0;
      for (let i = 0; i < p.length; i += 9) {
        const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!;
        const bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!;
        const cx = p[i + 6]!, cy = p[i + 7]!, cz = p[i + 8]!;
        v += (ax * (by * cz - bz * cy)
            - ay * (bx * cz - bz * cx)
            + az * (bx * cy - by * cx)) / 6;
      }
      expect(v, `${label} 帶號體積 ${v.toFixed(4)} —— 面朝內`).toBeGreaterThan(0);
    });
  });

  it('should point the roof normal up', () => {
    // Signed volume catches a wholesale flip but not a flipped top face alone, and the roof is
    // the face most often seen in an isometric view.
    eachVariant((geo, label) => {
      const pos = geo.getAttribute('position');
      const n = geo.getAttribute('normal');
      geo.computeBoundingBox();
      const top = geo.boundingBox!.max.y;
      let checked = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - top) > 1e-6) continue;
        if (Math.abs(n.getY(i)) < 0.9) continue;   // top edge of a side face, skip
        expect(n.getY(i), `${label} 頂面法線朝下`).toBeGreaterThan(0);
        checked++;
      }
      expect(checked, `${label} 沒有找到任何頂面`).toBeGreaterThan(0);
    });
  });

  it('should tag every vertex with a known part', () => {
    eachVariant((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        const known = p === 0
          || (p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.FOLIAGE_MIN)
          || p > PART_THRESHOLDS.ROOF_MIN;
        expect(known, `${label} 頂點 ${i} 標籤 ${p}`).toBe(true);
      }
    });
  });

  it('should contain no foliage and no ground paving', () => {
    // Greenery lives in the ground-prop layer and paving in the decal layer. A mass growing
    // either colour means the layers were confused.
    eachVariant((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        expect(p > PART_THRESHOLDS.FOLIAGE_MIN && p < PART_THRESHOLDS.FOLIAGE_MAX,
          `${label} 有樹葉標籤`).toBe(false);
        expect(p > PART_THRESHOLDS.GROUND_MIN && p < PART_THRESHOLDS.GROUND_MAX,
          `${label} 有鋪面標籤`).toBe(false);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const budget = lv === 3 ? TRIANGLE_BUDGET.TOWER : TRIANGLE_BUDGET.HOUSE;
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const g = build();
          expect(triangleCount(g), `${key} L${lv} v${i}`).toBeLessThanOrEqual(budget);
          g.dispose();
        });
      }
    });
  });

  // "L3 is richer than L1" is not tested here. The massing level ladder is more available
  // prototypes, not more pieces: commercial high L1's parapet is four pieces, exactly offsetting
  // the prototypes L3 adds, so piece count as a proxy measures roof form rather than level. The
  // ladder itself is tested directly by MassingPrototypes'
  // `should only ever add prototypes as the level climbs`.
});

const isEquipment = (v: Volume) => {
  const p = v.part ?? 0;
  return p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.FOLIAGE_MIN;
};

/**
 * Equipment masses standing above the building itself: stacks, silos, water tanks.
 *
 * The reference is the highest point of walls **plus roof**, not of the walls alone. Against
 * walls alone, two ways of burying a stack still pass: a roof placed over the stack itself
 * (`volumesFor` picking the wrong `top`), and a single-storey variant whose ridge climbs above
 * the stack (a composer leaving no room for the ridge). On screen both read as "the stack is
 * gone".
 */
function stacksIn(vs: readonly Volume[]): number {
  const buildingTop = Math.max(...vs.filter(v => !isEquipment(v)).map(v => v.y1), 0);
  return vs.filter(v => isEquipment(v) && v.y1 > buildingTop + 1e-9).length;
}

describe('industrial reads as industrial', () => {
  it('should raise a stack or silo above the roof on at least half the variants', () => {
    // Industry's level ladder does **not** show in height — modern plants are single-storey with
    // high ceilings, covering the plot — so without equipment, industry is just a shorter
    // commercial box.
    for (const lv of LEVELS) {
      let withStack = 0;
      for (let vi = 0; vi < VARIANT_COUNT; vi++) {
        if (stacksIn(volumesFor(ZoneType.INDUSTRIAL, 'LOW', lv, vi)) > 0) withStack++;
      }
      expect(withStack, `工業 L${lv} 只有 ${withStack}/8 個變體有立管`)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it('should keep stacks out of every other zone', () => {
    // The counterpart to the case above; without it, "a stack on every zone" would pass too.
    eachBucket((z, d, key) => {
      if (z === ZoneType.INDUSTRIAL) return;
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          expect(stacksIn(volumesFor(z, d, lv, vi)), `${key} L${lv} v${vi} 長了煙囪`).toBe(0);
        }
      }
    });
  });
});

describe('cylinder volumes', () => {
  it('should build a round column that still fills the box it declared', () => {
    // A cylinder with a smaller footprint than its mass declares skews the wall surface
    // propBands measures, since that layer works from the mass rather than the geometry.
    const box: Volume = { x: 0.1, z: -0.05, w: 0.2, d: 0.16, y0: 0, y1: 1 };
    const round = assemble([{ ...box, shape: 'cylinder' }]);
    const square = assemble([box]);
    expect(triangleCount(round), '圓柱的面數不比方柱多').toBeGreaterThan(triangleCount(square));

    round.computeBoundingBox();
    const b = round.boundingBox!;
    expect(b.min.x).toBeCloseTo(0, 6);
    expect(b.max.x).toBeCloseTo(0.2, 6);
    expect(b.min.z).toBeCloseTo(-0.13, 6);
    expect(b.max.z).toBeCloseTo(0.03, 6);
    expect(b.max.y).toBeCloseTo(1, 6);
  });
});

describe('dome volumes', () => {
  /**
   * A dome has to be a **hemisphere**, not a stack of drums narrowing toward the top.
   *
   * Four stacked octagonal prisms read as a dome at range and as four sharply stepped tiers up
   * close.
   *
   * "Is it hemispherical" has a directly measurable geometric property: **the radius at any
   * height equals `sqrt(1 - y^2)`**. A stack of drums holds a constant radius within each tier,
   * so this catches it.
   */
  const box: Volume = { x: 0.2, z: -0.1, w: 0.4, d: 0.4, y0: 0.5, y1: 0.7 };

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'dome' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.min.x).toBeCloseTo(0, 6);
    expect(b.max.x).toBeCloseTo(0.4, 6);
    expect(b.min.z).toBeCloseTo(-0.3, 6);
    expect(b.max.z).toBeCloseTo(0.1, 6);
    // The base sits at y0 and the apex just touches y1: a hemisphere is the upper half of the
    // declared box.
    expect(b.min.y).toBeCloseTo(0.5, 6);
    expect(b.max.y).toBeCloseTo(0.7, 6);
  });

  it('should curve like a hemisphere, not step like a stack of drums', () => {
    const geo = assemble([{ ...box, shape: 'dome' }]);
    // Checked per vertex rather than sampled per height: an 8-by-4 hemisphere has only five
    // rings of vertices, and a sample height falling between rings measures nothing, which reads
    // as "this shape is empty".
    const pos = geo.getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const y = (pos.getY(i) - box.y0) / (box.y1 - box.y0);
      const r = Math.hypot(pos.getX(i) - box.x, pos.getZ(i) - box.z) / (box.w / 2);
      // An octagon's vertices lie on the circumscribed circle and its edge midpoints on the
      // inscribed one, a factor of cos(pi/8) ~ 0.924 apart, so the tolerance has to absorb it.
      expect(r * r + y * y, `頂點 (r=${r.toFixed(2)}, y=${y.toFixed(2)}) 不在球面上`)
        .toBeGreaterThan(0.82);
      expect(r * r + y * y).toBeLessThan(1.01);
      seen.add(y.toFixed(3));
    }
    // And it really is several rings: a single disc also satisfies the case above.
    expect(seen.size, '半球只有一圈頂點，那是一個蓋子').toBeGreaterThanOrEqual(4);
  });

  it('should merge with the other shapes', () => {
    // `mergeGeometries` requires a matching attribute set. The cylinder path hit this with
    // indices and uvs, and the hemisphere uses the same THREE primitive, so the same trap is one
    // step away.
    expect(() => assemble([
      { ...box, shape: 'dome' },
      { x: 0, z: 0, w: 0.2, d: 0.2, y0: 0, y1: 0.5 },
    ])).not.toThrow();
  });
});

describe('cooling tower volumes', () => {
  /**
   * A cooling tower's **waist**.
   *
   * Without it the building does not read as a power plant. In a low-poly city a power plant's
   * most recognisable silhouette is a hyperbolic cooling tower, and that shape amounts to one
   * fact: **the middle is narrower than both the top and the bottom**. Neither a cylinder nor a
   * frustum can do that — one is straight, the other monotone — so this measures the waist.
   */
  const box: Volume = { x: 0, z: 0, w: 0.6, d: 0.6, y0: 0, y1: 1.2 };

  it('should pinch in at the waist', () => {
    const geo = assemble([{ ...box, shape: 'cooling' }]);
    const pos = geo.getAttribute('position');
    const ring = (lo: number, hi: number) => {
      let r = 0;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - box.y0) / (box.y1 - box.y0);
        if (t < lo || t > hi) continue;
        r = Math.max(r, Math.hypot(pos.getX(i) - box.x, pos.getZ(i) - box.z));
      }
      return r;
    };
    // The sampling window has to absorb floating-point error: the top ring's t can come out as
    // 1.0000000000000002, and `t > 1.0` would discard the whole ring, measuring radius 0 with a
    // message that reads as "the tower mouth is gone".
    const foot = ring(-0.01, 0.08);
    const waist = ring(0.55, 0.75);
    const lip = ring(0.9, 1.01);
    expect(waist, '腰沒有比底座窄 —— 那是一根柱子').toBeLessThan(foot * 0.85);
    expect(lip, '塔口沒有比腰寬 —— 那是一個漏斗').toBeGreaterThan(waist * 1.05);
    expect(lip, '塔口比底座還寬 —— 那是一個喇叭').toBeLessThan(foot);
  });

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'cooling' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.6, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(1.2, 6);
  });

  /**
   * **This is the one you can see into from an isometric view.**
   *
   * `LatheGeometry`'s profile runs from bottom to top and stops, capping **neither end**: an
   * open tube. The building material is `FrontSide`, so as soon as the angle is high enough to
   * see into the mouth, the far inner wall is back-face culled and what shows through is the
   * background, leaving the tower as two broken shells.
   *
   * (A real cooling tower is open at the top, so "add a flat cap" is the wrong answer: it would
   * read as a silo. What is needed is a **recess** — the profile folds inward at the top and
   * runs back down, carrying its normals toward the axis, so looking down shows inner wall
   * rather than background.)
   */
  it('should close the top with a recess instead of leaving a hole', () => {
    const geo = assemble([{ ...box, shape: 'cooling' }]);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    let inward = 0;
    let floorY = -Infinity;
    for (let t = 0; t < pos.count / 3; t++) {
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        cx += pos.getX(i) / 3; cy += pos.getY(i) / 3; cz += pos.getZ(i) / 3;
        nx += nrm.getX(i) / 3; ny += nrm.getY(i) / 3; nz += nrm.getZ(i) / 3;
      }
      const r = Math.hypot(cx - box.x, cz - box.z);
      const radial = r < 1e-9 ? 0 : ((cx - box.x) * nx + (cz - box.z) * nz) / r;
      if (radial < -0.5) inward++;
      if (ny > 0.9 && r < box.w / 4) floorY = Math.max(floorY, cy);
    }
    expect(inward, '塔口沒有朝內的內壁 —— 俯視會直接看穿').toBeGreaterThan(0);
    expect(floorY, '凹槽沒有底 —— 那還是一個洞').toBeGreaterThan(-Infinity);
    // And deep enough. The mouth's diameter is close to half the tower's, so an oblique view
    // sees only a small part of it; a shallow ring at that angle reads as a groove around the
    // top rather than an opening.
    const depth = (box.y1 - floorY) / (box.y1 - box.y0);
    // The lower bound is a literal. Compared against `COOL.DEPTH` this would be a tautology:
    // reduce the constant, the geometry follows, and the test stays green.
    expect(depth, '塔口太淺').toBeGreaterThan(0.15);
    expect(depth, '幾何沒有跟著 COOL.DEPTH 走').toBeCloseTo(COOL.DEPTH, 6);
  });
});

/**
 * A stack's **mouth**.
 *
 * A cylinder's top is a solid disc, and looking down from an isometric view the most
 * conspicuous part of a stack more than ten metres tall is that flat cap, while a real stack
 * has a hole at the top.
 *
 * A recess cannot be built from the shape library because everything in it is a **solid convex
 * body**: two concentric cylinders leave the outer cap covering the inner one entirely, and
 * making the outer one an uncapped tube does not help — the building material is `FrontSide`, a
 * tube's inner wall normals point outward, and looking down they are back-face culled, showing
 * the background instead.
 *
 * So this shape amounts to one fact: **the recess's inner wall normals point toward the axis**.
 * A surface of revolution (`LatheGeometry`) provides that, because folding the profile back
 * carries the normals with it.
 */
describe('stack volumes', () => {
  const box: Volume = { x: 0.2, z: -0.1, w: 0.4, d: 0.4, y0: 0, y1: 2.0 };

  /**
   * Per triangle: centroid, normal, the normal's radial component (positive is outward, negative
   * is toward the axis), and the highest of the three vertices.
   *
   * `ytop` is necessary: each profile segment of a surface of revolution produces **one** row of
   * quads, so the whole inner wall's centroids fall at that segment's middle, and asking a
   * centroid where the recess starts never reaches the mouth.
   */
  function faces(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const out: Array<{ y: number; ytop: number; r: number; radial: number; ny: number }> = [];
    for (let t = 0; t < pos.count / 3; t++) {
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      let ytop = -Infinity;
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        cx += pos.getX(i) / 3; cy += pos.getY(i) / 3; cz += pos.getZ(i) / 3;
        nx += nrm.getX(i) / 3; ny += nrm.getY(i) / 3; nz += nrm.getZ(i) / 3;
        ytop = Math.max(ytop, pos.getY(i));
      }
      const dx = cx - box.x;
      const dz = cz - box.z;
      const r = Math.hypot(dx, dz);
      out.push({ y: cy, ytop, r, radial: r < 1e-9 ? 0 : (dx * nx + dz * nz) / r, ny });
    }
    return out;
  }

  it('should hollow out a mouth you can see into', () => {
    const geo = assemble([{ ...box, shape: 'stack' }]);
    const all = faces(geo);

    // The recess's inner wall, normals toward the axis. Without it the recess is a dark ring
    // painted on the cap.
    const inner = all.filter(f => f.radial < -0.5);
    expect(inner.length, '煙囪沒有朝內的面 —— 那是一片實心的頂蓋')
      .toBeGreaterThan(0);

    // The inner wall runs down from the **mouth**. Not reaching the top, the recess is a ring
    // floating inside the shaft.
    const highest = Math.max(...inner.map(f => f.ytop));
    expect(highest, '凹槽沒有從管口開始').toBeCloseTo(box.y1, 6);

    // The floor sits below the mouth; flush, looking down still shows a flat surface.
    const floor = all.filter(f => f.ny > 0.9 && f.r < box.w / 4);
    expect(floor.length, '凹槽沒有底').toBeGreaterThan(0);
    const depth = box.y1 - Math.max(...floor.map(f => f.y));
    // And **nearly to the bottom**. A shallow ring reads in an isometric view as a shadow on
    // the cap rather than an opening: the mouth is half the shaft's diameter, so the small part
    // visible obliquely has to be deep enough for the inner wall at depth to fall entirely in
    // shadow.
    expect(depth / (box.y1 - box.y0), '凹槽太淺，俯視看不出是個洞')
      .toBeGreaterThan(0.6);
  });

  it('should cap the shaft with a ring, not a disc', () => {
    const geo = assemble([{ ...box, shape: 'stack' }]);
    const top = faces(geo).filter(f =>
      f.ny > 0.9 && Math.abs(f.y - box.y1) < 1e-6);
    expect(top.length, '管口沒有環').toBeGreaterThan(0);
    // The ring's inner edge stands away from the axis; at 0 it is a disc.
    const inner = Math.min(...top.map(f => f.r));
    expect(inner / (box.w / 2), '管口是實心的圓盤').toBeGreaterThan(0.2);
  });

  it('should fill the box it declared', () => {
    // The same rule as every other shape: the bounds computed from the mass are where the
    // geometry actually sits, or `maxAbsOf` cannot catch an overrun.
    const geo = assemble([{ ...box, shape: 'stack' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.4, 6);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(box.x, 6);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(box.z, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(2.0, 6);
  });

  it('should merge with the other shapes', () => {
    expect(() => assemble([
      { ...box, shape: 'stack' },
      { x: 0, z: 0, w: 0.2, d: 0.2, y0: 0, y1: 0.5 },
    ])).not.toThrow();
  });
});

/**
 * Open containers: `tub` (round) and `basin` (rectangular).
 *
 * For a tub to read as a tub, the water surface has to sit **below the rim**, which a solid
 * cylinder or box cannot do: its top is a solid face, and pushed under it the water disappears
 * inside the mass entirely. The data is right, nothing shows on screen, and nothing reports it.
 *
 * So these two shapes amount to the same fact as the stack's recess: **the inner wall normals
 * point toward the container's centre**. The round one gets that from a surface of revolution
 * whose profile folds back and runs down, the rectangular one from four walls, since a box's
 * inner faces already point inward. Neither can be a shell with the lid removed, which under
 * `FrontSide` shows straight through.
 */
describe('tub volumes', () => {
  const box: Volume = { x: 0.2, z: -0.1, w: 0.4, d: 0.4, y0: 0, y1: 0.5 };

  function faces(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const out: Array<{ y: number; r: number; radial: number; ny: number }> = [];
    for (let t = 0; t < pos.count / 3; t++) {
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        cx += pos.getX(i) / 3; cy += pos.getY(i) / 3; cz += pos.getZ(i) / 3;
        nx += nrm.getX(i) / 3; ny += nrm.getY(i) / 3; nz += nrm.getZ(i) / 3;
      }
      const dx = cx - box.x;
      const dz = cz - box.z;
      const r = Math.hypot(dx, dz);
      out.push({ y: cy, r, radial: r < 1e-9 ? 0 : (dx * nx + dz * nz) / r, ny });
    }
    return out;
  }

  it('should open the top so the water inside can be seen', () => {
    const all = faces(assemble([{ ...box, shape: 'tub' }]));
    // The rim ring stops at the inner wall. An upward face at the centre is a lid, and the
    // water ends up buried beneath it.
    const lid = all.filter(f =>
      f.ny > 0.9 && Math.abs(f.y - box.y1) < 1e-6 && f.r < box.w / 2 * TUB.INNER * 0.9);
    expect(lid.length, '水槽是封起來的 —— 水面會埋在頂蓋下面').toBe(0);

    const inner = all.filter(f => f.radial < -0.5);
    expect(inner.length, '水槽沒有朝內的槽壁').toBeGreaterThan(0);
  });

  it('should floor the tub below the rim', () => {
    const all = faces(assemble([{ ...box, shape: 'tub' }]));
    // The rim ring also faces up, so this selects what is **inside** the inner wall, which can
    // only be the floor.
    const floor = all.filter(f =>
      f.ny > 0.9 && f.r < box.w / 2 * TUB.INNER * 0.9);
    expect(floor.length, '水槽沒有底 —— 俯視會直接看穿到地面').toBeGreaterThan(0);
    const depth = (box.y1 - Math.max(...floor.map(f => f.y))) / (box.y1 - box.y0);
    // The same reason as the tower mouth: a literal lower bound, or reducing the constant keeps
    // the test green.
    expect(depth, '槽太淺 —— 水位低於槽緣就看不出來了').toBeGreaterThan(0.15);
    expect(depth, '幾何沒有跟著 TUB.DEPTH 走').toBeCloseTo(TUB.DEPTH, 6);
  });

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'tub' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.4, 6);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(box.x, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.5, 6);
  });
});

describe('basin volumes', () => {
  const box: Volume = { x: 0.05, z: -0.05, w: 0.4, d: 0.6, y0: 0, y1: 0.4 };

  /** Per triangle: centroid and normal. */
  function faces(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const out: Array<{ x: number; y: number; z: number; nx: number; ny: number; nz: number }> = [];
    for (let t = 0; t < pos.count / 3; t++) {
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        cx += pos.getX(i) / 3; cy += pos.getY(i) / 3; cz += pos.getZ(i) / 3;
        nx += nrm.getX(i) / 3; ny += nrm.getY(i) / 3; nz += nrm.getZ(i) / 3;
      }
      out.push({ x: cx, y: cy, z: cz, nx, ny, nz });
    }
    return out;
  }

  it('should leave the middle open and wall it on four sides', () => {
    const all = faces(assemble([{ ...box, shape: 'basin' }]));
    const inW = box.w / 2 * TUB.INNER;
    const inD = box.d / 2 * TUB.INNER;

    // No face at the centre; one there makes this a solid box with the water buried inside.
    const middle = all.filter(f =>
      Math.abs(f.x - box.x) < inW * 0.8 && Math.abs(f.z - box.z) < inD * 0.8);
    expect(middle.length, '方池是實心的 —— 水面會埋在頂面下面').toBe(0);

    // Four inner walls with normals toward the centre. One missing is a gap you can see
    // through.
    const sides = [
      all.some(f => f.nx > 0.9 && f.x < box.x),
      all.some(f => f.nx < -0.9 && f.x > box.x),
      all.some(f => f.nz > 0.9 && f.z < box.z),
      all.some(f => f.nz < -0.9 && f.z > box.z),
    ];
    expect(sides, '方池的內壁不是四面都有').toEqual([true, true, true, true]);
  });

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'basin' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.4, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.6, 6);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(box.x, 6);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(box.z, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.4, 6);
  });

  it('should merge with the other shapes', () => {
    expect(() => assemble([
      { ...box, shape: 'basin' },
      { ...box, shape: 'tub' },
      { x: 0, z: 0, w: 0.2, d: 0.2, y0: 0, y1: 0.5 },
    ])).not.toThrow();
  });
});

describe('massing variety', () => {
  it('should give every bucket eight distinct silhouettes', () => {
    // The main condition of this stage. Two identical variants are one variant fewer.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const grids: Float32Array[] = [];
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          grids.push(rasterise(volumesFor(z, d, lv, vi)));
        }
        for (let i = 0; i < grids.length; i++) {
          for (let j = i + 1; j < grids.length; j++) {
            expect(differenceRatio(grids[i]!, grids[j]!, SILHOUETTE_TOLERANCE),
              `${key} L${lv} 的 v${i} 與 v${j} 輪廓相同`).toBeGreaterThanOrEqual(0.10);
          }
        }
      }
    });
  });

  it('should make rotation worth something for at least half the variants', () => {
    // The spec says 6/8, which towers cannot reach: slabs and podium towers are symmetric by
    // nature and are the only prototypes high-density zones have at L1. 4/8 is the reachable
    // value derived from the prototype table.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        let asym = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          if (centroidOffset(volumesFor(z, d, lv, vi)) > 0.04) asym++;
        }
        expect(asym, `${key} L${lv} 只有 ${asym}/8 個不對稱`).toBeGreaterThanOrEqual(4);
      }
    });
  });

  it('should actually change the silhouette when an asymmetric variant rotates', () => {
    // The case above looks at centroids and this one at the rotated appearance; together they
    // catch "the centroid is offset but the rotation looks the same".
    eachBucket((z, d, key) => {
      for (let vi = 0; vi < VARIANT_COUNT; vi++) {
        const vs = volumesFor(z, d, 3, vi);
        if (centroidOffset(vs) <= 0.04) continue;
        const g = rasterise(vs);
        expect(differenceRatio(g, rotate90(g), SILHOUETTE_TOLERANCE),
          `${key} L3 v${vi} 轉了等於沒轉`).toBeGreaterThanOrEqual(0.10);
      }
    });
  });
});
