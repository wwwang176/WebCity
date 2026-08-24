import { describe, it, expect } from 'vitest';
import { assembleCivic, assembleDecals } from '../assemble';
import { CIVIC_INSET, type CivicDecal, type CivicVolume, type Footprint } from '../types';
import {
  PART_WALL, PART_GROUND, PART_FOLIAGE, PART_ROOF, triangleCount,
} from '../../buildings/parts';

const FOOT: Footprint = { w: 2, h: 2 };
/** Colour is not what this file tests; the colour checks live in `CivicColors.test.ts`. */
const GREY = [0.7, 0.7, 0.7] as const;

const box = (o: Partial<CivicVolume> = {}): CivicVolume =>
  ({ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5, ...o });

const decal = (o: Partial<CivicDecal> = {}): CivicDecal =>
  ({ x: 0, z: 0, w: 1, d: 1, shade: 0.5, ...o });

/**
 * Civic buildings' mass guard differs from zoned buildings'.
 *
 * The zoned `assemble()` bounds the **pedestrian envelope**, an in-cell concept whose door nodes
 * sit outside it and which pedestrians cross by walking through walls (BUG-221). Civic buildings
 * occupy several cells, where the envelope does not apply; what has to be kept out is the plot
 * boundary, and crossing it means overrunning a neighbouring cell's building or road.
 */
describe('assembleCivic 的護欄', () => {
  it('should accept volumes inside the footprint', () => {
    expect(() => assembleCivic([box({ w: 1.9, d: 1.9 })], FOOT, GREY)).not.toThrow();
  });

  it('should throw when a volume leaves the footprint', () => {
    // Silently overrunning a neighbour is a hundred times harder to track down than failing on
    // the spot, the same reasoning as in `assemble()`.
    expect(() => assembleCivic([box({ w: 2.4, d: 1 })], FOOT, GREY)).toThrow(/leaves the plot/);
  });

  it('should throw on an off-centre volume that pokes out one side', () => {
    // A bounding box's **width** does not show a one-sided bulge: this mass is 1 cell wide on a
    // 2-cell plot, but its centre is offset by 0.8 so its right edge is at 1.3, already in the
    // next cell. That is the shape of BUG-222, which is why the maximum distance from the centre
    // is measured rather than the width.
    expect(() => assembleCivic([box({ x: 0.8, w: 1, d: 1 })], FOOT, GREY)).toThrow(/leaves the plot/);
  });

  it('should measure the footprint per axis, not as a square', () => {
    // A 2x3 hospital has 3 cells along z and only 2 along x. A single radius either wastes the
    // long side or lets the short one overflow.
    const tall: Footprint = { w: 2, h: 3 };
    expect(() => assembleCivic([box({ w: 1.9, d: 2.9 })], tall, GREY)).not.toThrow();
    expect(() => assembleCivic([box({ w: 2.9, d: 1.9 })], tall, GREY)).toThrow(/leaves the plot/);
  });

  it('should reserve the inset', () => {
    // Flush with the plot boundary it becomes coplanar with a neighbour's geometry; the
    // z-fighting does not show in a static screenshot and turns into a flickering sheet as soon as
    // the camera moves.
    const flush = 2 - CIVIC_INSET * 2;
    expect(() => assembleCivic([box({ w: flush, d: flush })], FOOT, GREY)).not.toThrow();
    expect(() => assembleCivic([box({ w: flush + 0.01, d: flush })], FOOT, GREY)).toThrow();
  });

  it('should say how far out it went, in metres', () => {
    // "Outside the footprint" is not enough on its own: fixing the mass table takes knowing by
    // how much.
    expect(() => assembleCivic([box({ w: 3, d: 1 })], FOOT, GREY)).toThrow(/m/);
  });

  it('should tag every vertex it emits', () => {
    const geo = assembleCivic([box({ part: PART_WALL }), box({ x: 0.4, part: PART_ROOF })], FOOT, GREY);
    const col = geo.getAttribute('color');
    expect(col, '沒有頂點色 —— shader 會把整棟當成 partType 0').toBeTruthy();
    expect(col.count).toBe(geo.getAttribute('position').count);
  });

  it('should keep each volume tag on its own vertices', () => {
    // With the tags mixed up after merging, roofs grow windows or walls are coloured as roofs.
    const geo = assembleCivic(
      [box({ z: -0.4, d: 0.5, part: PART_WALL }), box({ z: 0.4, d: 0.5, part: PART_ROOF })],
      FOOT, GREY,
    );
    const col = geo.getAttribute('color');
    const tags = new Set<number>();
    for (let i = 0; i < col.count; i++) tags.add(Number(col.getX(i).toFixed(4)));
    expect(tags).toEqual(new Set([PART_WALL, PART_ROOF]));
  });

  it('should return an empty tagged geometry for an empty plan', () => {
    // A park can have no masses at all, only decals and trees. An empty array makes
    // mergeGeometries return null, and the null travels to `new THREE.Mesh` before failing.
    const geo = assembleCivic([], FOOT, GREY);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color')).toBeTruthy();
  });
});

/**
 * Rotated markings.
 *
 * A running track is a loop and taxiway hold lines are skewed; neither can be an axis-aligned
 * rectangle. Rotation lets a curve be approximated by a run of short straight pieces, which is
 * how low-poly works anyway.
 *
 * **Only the marking layer may rotate.** Base decals' overlap check intersects axis-aligned
 * rectangles, and a rotated base makes that check wrong in silence: two genuinely overlapping
 * surfaces pass, and the result flickers on screen.
 */
describe('轉向的貼片', () => {
  const bar = (o: Partial<CivicDecal> = {}): CivicDecal =>
    ({ x: 0, z: 0, w: 0.8, d: 0.05, shade: 1, layer: 'mark', ...o });

  it('should turn the marking about its own centre', () => {
    const geo = assembleDecals([bar({ rotationY: Math.PI / 2 })], FOOT);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    // Rotated 90 degrees, the long side moves to z.
    expect(b.max.x - b.min.x).toBeCloseTo(0.05, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.8, 6);
    // The centre does not move; if it did, a whole track loop would drift.
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6);
  });

  it('should turn a marking that is not at the origin about its own centre', () => {
    // **This has to be tested away from the origin.** At (0, 0), rotating about itself and
    // rotating about the origin are the same thing, while every track segment is far from the
    // origin and rotating about the origin swings the whole loop away.
    const geo = assembleDecals([bar({ x: 0.5, z: 0.3, rotationY: Math.PI / 2 })], FOOT);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect((b.min.x + b.max.x) / 2, '標線繞原點轉了').toBeCloseTo(0.5, 6);
    expect((b.min.z + b.max.z) / 2, '標線繞原點轉了').toBeCloseTo(0.3, 6);
  });

  it('should measure the footprint after the marking is turned', () => {
    // A line that just fits along x no longer fits along z once turned 90 degrees. Checked against
    // its pre-rotation width and depth it passes, and on screen it reaches into the next cell.
    const long = bar({ w: 1.9, z: 0.9 });
    expect(() => assembleDecals([long], FOOT), '沒轉的時候該放得下').not.toThrow();
    expect(() => assembleDecals([{ ...long, rotationY: Math.PI / 2 }], FOOT))
      .toThrow(/leaves the plot/);
  });

  it('should reject a turned base decal', () => {
    // Refusing loudly beats computing the wrong answer in silence.
    expect(() => assembleDecals([bar({ layer: 'base', rotationY: 0.3 })], FOOT))
      .toThrow(/only marking layers/);
  });

  it('should leave an unturned marking exactly where it was', () => {
    const plain = assembleDecals([bar()], FOOT);
    const zero = assembleDecals([bar({ rotationY: 0 })], FOOT);
    plain.computeBoundingBox();
    zero.computeBoundingBox();
    expect(zero.boundingBox!.min.x).toBeCloseTo(plain.boundingBox!.min.x, 9);
    expect(zero.boundingBox!.min.z).toBeCloseTo(plain.boundingBox!.min.z, 9);
  });
});

/**
 * Raised paving.
 *
 * `CivicDecal` always lies on the ground, since `GROUND_LAYERS` sit at fixed heights, so **raised
 * paving** — a hospital's rooftop helipad, a station's platform surface — cannot be a decal. It
 * has to be a mass, and a mass carries no "how bright is this paving" of its own.
 *
 * The brightness lives in the vertex colour's B channel (`setGroundShade`), the same channel and
 * the same shader branch decals use: on separate paths, concrete on a roof and concrete on the
 * ground would be two different colours.
 */
describe('量體上的鋪面明度', () => {
  it('should write the shade into the blue channel', () => {
    const geo = assembleCivic([box({ part: PART_GROUND, shade: 0.8 })], FOOT, GREY);
    const c = geo.getAttribute('color');
    expect(c.getZ(0), '明度沒有寫進 B 通道').toBeCloseTo(0.8, 6);
  });

  it('should keep each volume on its own shade', () => {
    // A helipad's dark deck and white H are two pieces in one geometry. Written over the whole
    // thing at once, the H disappears — exactly the reasoning behind writing `aBldgColor` per
    // mass.
    const geo = assembleCivic([
      box({ x: -0.3, w: 0.4, part: PART_GROUND, shade: 0.2 }),
      box({ x: 0.3, w: 0.4, part: PART_GROUND, shade: 1.0 }),
    ], FOOT, GREY);
    const c = geo.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i++) seen.add(c.getZ(i).toFixed(2));
    expect(seen, '兩塊鋪面的明度被寫成同一個').toEqual(new Set(['0.20', '1.00']));
  });

  it('should leave the channel alone when no shade is asked for', () => {
    // Walls and roofs do not read the B channel. Writing it feeds the shader a meaningless value,
    // and the day someone adds a wall branch that reads B, that value suddenly starts mattering.
    const geo = assembleCivic([box()], FOOT, GREY);
    expect(geo.getAttribute('color').getZ(0)).toBe(0);
  });
});

describe('assembleDecals', () => {
  it('should emit flat quads with no sides', () => {
    // With thickness the sides become walls, and walls grow windows, as `decals.ts` records.
    const geo = assembleDecals([decal()], FOOT);
    const pos = geo.getAttribute('position');
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Number(pos.getY(i).toFixed(6)));
    expect(ys.size, '貼片有兩個以上的高度 —— 它有厚度').toBe(1);
    expect(triangleCount(geo)).toBe(2);
  });

  it('should face up', () => {
    // Facing down it is entirely invisible from an isometric view; the material is FrontSide
    // (BUG-227).
    const geo = assembleDecals([decal()], FOOT);
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getY(i), `第 ${i} 個頂點的法線朝下`).toBeGreaterThan(0.99);
    }
  });

  it('should tag paving as ground and lawn as foliage', () => {
    const paved = assembleDecals([decal()], FOOT).getAttribute('color');
    expect(paved.getX(0)).toBeCloseTo(PART_GROUND, 6);
    const lawn = assembleDecals([decal({ lawn: true })], FOOT).getAttribute('color');
    expect(lawn.getX(0), '草地走了鋪面的分支 —— 它會是灰的').toBeCloseTo(PART_FOLIAGE, 6);
  });

  it('should write shade into the blue channel', () => {
    // Brightness goes through vertex colours rather than aSeed: one decal geometry has to carry
    // both dark asphalt and a pale sidewalk, and aSeed is per instance and cannot tell two ground
    // patches within one mesh apart.
    const geo = assembleDecals([decal({ shade: 0.85 })], FOOT);
    expect(geo.getAttribute('color').getZ(0)).toBeCloseTo(0.85, 6);
  });

  it('should stack marks above the base layer', () => {
    const base = assembleDecals([decal()], FOOT).getAttribute('position').getY(0);
    const mark = assembleDecals([decal({ layer: 'mark' })], FOOT).getAttribute('position').getY(0);
    expect(mark, '標線沒有疊在鋪面之上 —— 兩者會 z-fighting').toBeGreaterThan(base);
  });

  it('should reject overlapping base decals', () => {
    // Two quads at the same height and position do not show in a static screenshot and turn into a
    // flickering sheet as soon as the camera moves.
    expect(() => assembleDecals([decal(), decal({ x: 0.5 })], FOOT))
      .toThrow(/base decals overlap/);
  });

  it('should allow base decals that merely touch', () => {
    // Sharing an edge is not overlapping. Refusing shared edges would make "a different surface
    // along each of the four sides" impossible to express.
    expect(() => assembleDecals([decal(), decal({ x: 1 })], { w: 3, h: 2 })).not.toThrow();
  });

  it('should allow a mark to sit on top of a base decal', () => {
    expect(() => assembleDecals([decal(), decal({ layer: 'mark' })], FOOT)).not.toThrow();
  });

  it('should allow two marks to overlap', () => {
    // Markings are meant to stack: parking bay lines are drawn across an entrance tread.
    expect(() => assembleDecals(
      [decal({ layer: 'mark' }), decal({ layer: 'mark' })], FOOT,
    )).not.toThrow();
  });

  it('should keep decals inside the footprint', () => {
    expect(() => assembleDecals([decal({ w: 3 })], FOOT)).toThrow(/leaves the plot/);
  });

  it('should let a decal reach the footprint edge', () => {
    // Decals differ from masses: they are flat paving, and paving to the cell boundary is correct,
    // since a sidewalk runs all the way to the kerb. So they take no CIVIC_INSET.
    expect(() => assembleDecals([decal({ w: 2, d: 2 })], FOOT)).not.toThrow();
  });

  it('should return an empty tagged geometry when there are no decals', () => {
    const geo = assembleDecals([], FOOT);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color')).toBeTruthy();
  });
});
