import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection, ROAD_WIDTHS } from '../../core/road/types';
import { SIDEWALK_WIDTH } from '../../core/traffic/SidewalkGraph';
import {
  buildRoadStrips, buildSidewalkStrips, buildLampPositions,
  BEND_ARC_SEGMENTS, BEND_KERB_SEGMENTS,
  type RoadCell,
} from '../RoadStripBuilder';

/**
 * A 90 degree bend's road surface and kerbs follow an arc rather than a right angle made of two
 * rectangles.
 *
 * Lane dashes and the double yellow line are already curved (`emitLBendDashes`,
 * `buildCurvedCenterLineData`), leaving only the asphalt and the kerbs square: the lines on a bend
 * are round and the road is square.
 *
 * Surface and kerb change together: curving the kerb alone puts the square asphalt corner entirely
 * outside it.
 */

const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const NE = RoadDirection.NORTH | RoadDirection.EAST;
const NW = RoadDirection.NORTH | RoadDirection.WEST;
const SE = RoadDirection.SOUTH | RoadDirection.EAST;
const SW = RoadDirection.SOUTH | RoadDirection.WEST;

function cell(flags: number, roadType = RoadType.TWO_LANE): RoadCell {
  return { x: 0, y: 0, roadType, roadFlags: flags };
}

/** Which corner this bend turns about. The same parameters `emitLBendDashes` uses. */
function turnCentre(flags: number): { cx: number; cz: number } {
  const hasN = (flags & RoadDirection.NORTH) !== 0;
  const hasE = (flags & RoadDirection.EAST) !== 0;
  return { cx: hasE ? 0.5 : -0.5, cz: hasN ? -0.5 : 0.5 };
}

const radius = (s: { x: number; z: number }, c: { cx: number; cz: number }) =>
  Math.hypot(s.x - c.cx, s.z - c.cz);

describe('L 形彎的路面', () => {
  it('should lay the asphalt along an arc instead of two rectangles', () => {
    expect(buildRoadStrips([cell(NE)])).toHaveLength(BEND_ARC_SEGMENTS);
  });

  it('should put the outer edge exactly where the road ends', () => {
    // The outer edge is the visible one. A rectangle cannot fill a curved annulus, and every
    // extension goes **inward**: extended outward, the asphalt projects past the kerb, which is
    // exactly what a player would notice.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half, 9);
    }
  });

  it('should keep every piece on the arc', () => {
    // The bend's centre is on the cell's corner and the road's centre line is that quarter circle.
    // The lane dashes use the same radius, so they land on the asphalt. The slight inward offset of
    // the centre is what the inward extension leaves, under 0.002 cells.
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      expect(Math.abs(radius(s, c) - 0.5)).toBeLessThan(0.01);
    }
  });

  it('should point every piece along the arc, not along the axes', () => {
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      // The long axis, local +Z rotated by rotY, has to be perpendicular to the radius.
      const along = { x: Math.sin(s.rotY), z: Math.cos(s.rotY) };
      const out = { x: s.x - c.cx, z: s.z - c.cz };
      expect(along.x * out.x + along.z * out.z).toBeCloseTo(0, 9);
    }
  });

  it('should not let the asphalt spill past the outer edge of the turn', () => {
    // The square corner lands at sqrt(2) x (0.5 + half-width) ~ 1.13 while the surface's outer edge
    // reaches only 0.5 + half-width = 0.8. That excess asphalt is exactly what shows outside the
    // kerb once the kerb is curved.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      const outer = radius(s, c) + s.sx / 2;
      expect(outer).toBeLessThanOrEqual(0.5 + half + 1e-9);
    }
  });

  it('should still meet the neighbouring cells at both ends', () => {
    // The arc runs from the cell's north boundary to its east boundary. Falling short leaves gaps
    // at both ends of the bend.
    const c = turnCentre(NE);
    const angles = buildRoadStrips([cell(NE)])
      .map(s => Math.atan2(Math.abs(s.z - c.cz), Math.abs(s.x - c.cx)))
      .sort((a, b) => a - b);
    const step = (Math.PI / 2) / BEND_ARC_SEGMENTS;
    expect(angles[0]).toBeCloseTo(step / 2, 9);
    expect(angles[angles.length - 1]).toBeCloseTo(Math.PI / 2 - step / 2, 9);
  });

  it('should cover the whole quarter-ring, with no holes anywhere in it', () => {
    // Checking only whether adjacent segments' **centre line endpoints** meet asks the wrong
    // question: they do meet, but each segment is a straight rectangle and adjacent ones sit at an
    // angle theta, so the outer edge opens a wedge-shaped hole while the inner edges overlap. The
    // centre line is the one line that never has a gap, so the test stays green while the surface
    // is broken.
    //
    // This asks directly whether every point on the annulus is covered, which is what a player
    // sees.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildRoadStrips([cell(NE)]);
    const eps = 1e-6;

    for (const rad of [0.5 - half + eps, 0.5 - half / 2, 0.5, 0.5 + half / 2, 0.5 + half - eps]) {
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * (Math.PI / 2);
        // An NE bend has dirX = -1 and dirZ = +1 (see emitLBendDashes).
        const px = c.cx - rad * Math.cos(a);
        const pz = c.cz + rad * Math.sin(a);
        const covered = strips.some(s => {
          // Into this segment's own frame: local +Z is its length and +X its width.
          const dx = px - s.x, dz = pz - s.z;
          const along = dx * Math.sin(s.rotY) + dz * Math.cos(s.rotY);
          const across = dx * Math.cos(s.rotY) - dz * Math.sin(s.rotY);
          return Math.abs(along) <= s.sz / 2 + 1e-9 && Math.abs(across) <= s.sx / 2 + 1e-9;
        });
        expect(covered, `半徑 ${rad.toFixed(3)}、角度 ${(a * 180 / Math.PI).toFixed(1)}° 沒有柏油`)
          .toBe(true);
      }
    }
  });

  it('should cover the whole kerb band too', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildSidewalkStrips([cell(NE)]);
    // The kerb straddles the asphalt's edge, so its centre is that edge.
    const mid = 0.5 + half;
    const eps = 1e-6;

    for (const rad of [mid - SIDEWALK_WIDTH / 2 + eps, mid, mid + SIDEWALK_WIDTH / 2 - eps]) {
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * (Math.PI / 2);
        const px = c.cx - rad * Math.cos(a);
        const pz = c.cz + rad * Math.sin(a);
        const covered = strips.some(s => {
          const dx = px - s.x, dz = pz - s.z;
          const along = dx * Math.sin(s.rotY) + dz * Math.cos(s.rotY);
          const across = dx * Math.cos(s.rotY) - dz * Math.sin(s.rotY);
          return Math.abs(along) <= s.sz / 2 + 1e-9 && Math.abs(across) <= s.sx / 2 + 1e-9;
        });
        expect(covered, `路緣在 ${(a * 180 / Math.PI).toFixed(1)}° 破了`).toBe(true);
      }
    }
  });

  it('should carry at least the full road width across the turn', () => {
    // At least the road's width, or it cannot meet the straight road at either end. Anything more
    // is the inward extension, which should not be large enough to see.
    for (const type of [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.HIGHWAY]) {
      for (const s of buildRoadStrips([cell(NE, type)])) {
        expect(s.sx, `${type} too narrow`).toBeGreaterThanOrEqual(ROAD_WIDTHS[type]! - 1e-9);
        expect(s.sx, `${type} overshoots`).toBeLessThan(ROAD_WIDTHS[type]! + 0.02);
      }
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should turn around the right corner (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    for (const s of buildRoadStrips([cell(flags)])) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half, 9);
    }
  });

  it('should leave straight roads alone', () => {
    const strips = buildRoadStrips([cell(NS)]);
    expect(strips).toHaveLength(1);
    expect(strips[0]!.rotY).toBe(0);
    expect(strips[0]!.sz).toBeCloseTo(1, 9);
  });
});

describe('L 形彎的路緣', () => {
  it('should follow the same arc, just further out', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildSidewalkStrips([cell(NE)]);
    expect(strips).toHaveLength(BEND_KERB_SEGMENTS);
    for (const s of strips) {
      // The outer edge is exact: a kerb's outside is the block boundary a player sees. Its inner
      // half is under the asphalt, as on a straight road.
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
      expect(s.sx).toBeGreaterThanOrEqual(SIDEWALK_WIDTH - 1e-9);
      expect(s.sx).toBeLessThan(SIDEWALK_WIDTH + 0.03);
    }
  });

  it('should keep its inner half under the asphalt, like a straight kerb does', () => {
    // On a straight road half the kerb is under the surface: the kerb's plane is at y = 0.028 and
    // the road slab spans 0 to 0.05. A bend does the same so the visible width matches. Buried
    // deeper than half is wrong too — that is the inward extension running away, and the kerb looks
    // narrower than on a straight road.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      const buried = (0.5 + half) - (radius(s, c) - s.sx / 2);
      expect(buried).toBeGreaterThanOrEqual(SIDEWALK_WIDTH / 2 - 1e-9);
      expect(buried).toBeLessThan(SIDEWALK_WIDTH / 2 + 0.01);
    }
  });

  it('should only kerb the outside of the turn', () => {
    // No kerb on the inside: a straight road's rule is "only the side with no road", and a bend has
    // road on both inner sides.
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      expect(radius(s, c)).toBeGreaterThan(0.5);
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should kerb the outside for every orientation (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    const strips = buildSidewalkStrips([cell(flags)]);
    expect(strips).toHaveLength(BEND_KERB_SEGMENTS);
    for (const s of strips) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
    }
  });

  it('should leave straight roads alone', () => {
    const strips = buildSidewalkStrips([cell(NS)]);
    expect(strips).toHaveLength(2);
    for (const s of strips) expect(s.rotY).toBe(0);
  });

  it('should leave intersections alone', () => {
    const cross = cell(RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    for (const s of buildSidewalkStrips([cross])) expect(s.rotY).toBe(0);
    for (const s of buildRoadStrips([cross])) expect(s.rotY).toBe(0);
  });
});

describe('L 形彎的路緣石不能凸出去', () => {
  /** The furthest of a rectangle's four corners from the bend's centre. */
  function furthestCorner(
    s: { x: number; z: number; sx: number; sz: number; rotY: number },
    c: { cx: number; cz: number },
  ): number {
    let far = 0;
    for (const a of [1, -1]) {
      for (const b of [1, -1]) {
        const px = s.x + a * (s.sz / 2) * Math.sin(s.rotY) + b * (s.sx / 2) * Math.cos(s.rotY);
        const pz = s.z + a * (s.sz / 2) * Math.cos(s.rotY) - b * (s.sx / 2) * Math.sin(s.rotY);
        far = Math.max(far, Math.hypot(px - c.cx, pz - c.cz));
      }
    }
    return far;
  }

  it('should not let the kerb bulge past its own outer radius', () => {
    // Each segment is a straight rectangle following the arc, so **its two ends** bulge outside the
    // circle by R x (1/cos(theta/2) - 1). With too few segments that is a visible scalloped edge,
    // and it shows most against a straight road's kerb: the straight one is a line and the bend
    // bulges out of it.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const nominal = 0.5 + half + SIDEWALK_WIDTH / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      // The tolerance is 5% of the kerb's width; more is visible.
      expect(furthestCorner(s, c) - nominal).toBeLessThan(SIDEWALK_WIDTH * 0.05);
    }
  });

  it('should keep the kerb about as thick as it is on a straight', () => {
    // The inward extension scales with the radius, and a kerb's radius exceeds the surface's, so
    // with too few segments a bend's kerb is wider than a straight road's.
    for (const s of buildSidewalkStrips([cell(NE)])) {
      expect(s.sx).toBeLessThan(SIDEWALK_WIDTH * 1.05);
    }
  });

  it('should spend the extra pieces on the kerb, not on the asphalt', () => {
    // The asphalt's bulge is covered by the kerb, so it needs fewer segments. Separate counts avoid
    // spending instances for nothing.
    expect(BEND_KERB_SEGMENTS).toBeGreaterThan(BEND_ARC_SEGMENTS);
    expect(buildSidewalkStrips([cell(NE)])).toHaveLength(BEND_KERB_SEGMENTS);
    expect(buildRoadStrips([cell(NE)])).toHaveLength(BEND_ARC_SEGMENTS);
  });
});

describe('路燈', () => {
  it('should stand on the kerb of a straight road', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2 + SIDEWALK_WIDTH / 2;
    const lamps = buildLampPositions([cell(NS)]);
    expect(lamps.map(l => `${l.x.toFixed(3)},${l.z.toFixed(3)}`).sort())
      .toEqual([`${(-half).toFixed(3)},0.000`, `${half.toFixed(3)},0.000`].sort());
  });

  it('should follow the kerb round a bend', () => {
    // Placed by the straight-road rule, the lamps land at the midpoints of the south and west
    // boundaries, 1.003 from the bend's centre while the kerb reaches only 0.87 — leaving them
    // standing on grass.
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const onKerb = 0.5 + half + SIDEWALK_WIDTH / 2;
    const c = turnCentre(NE);
    const lamps = buildLampPositions([cell(NE)]);
    expect(lamps).toHaveLength(2);
    for (const l of lamps) {
      expect(Math.hypot(l.x - c.cx, l.z - c.cz)).toBeCloseTo(onKerb, 9);
    }
  });

  it('should not put both bend lamps in the same place', () => {
    const lamps = buildLampPositions([cell(NE)]);
    expect(Math.hypot(lamps[0]!.x - lamps[1]!.x, lamps[0]!.z - lamps[1]!.z))
      .toBeGreaterThan(0.3);
  });

  it.each([[NE], [NW], [SE], [SW]])('should light the outside of every bend (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    for (const l of buildLampPositions([cell(flags)])) {
      expect(Math.hypot(l.x - c.cx, l.z - c.cz)).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
    }
  });

  it('should light only the sides with no road on them', () => {
    // With road on three sides, only one side needs a lamp.
    const lamps = buildLampPositions([cell(RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST)]);
    expect(lamps).toHaveLength(1);
    expect(lamps[0]!.x).toBeLessThan(0);
  });

  it('should carry the source cell so the renderer can track it', () => {
    for (const l of buildLampPositions([{ x: 4, y: 7, roadType: RoadType.TWO_LANE, roadFlags: NE }])) {
      expect(l.srcX).toBe(4);
      expect(l.srcY).toBe(7);
    }
  });
});

describe('彎道的路緣石看起來要跟直路一樣寬', () => {
  const TYPES = [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.SIX_LANE,
    RoadType.HIGHWAY, RoadType.ONE_WAY];

  /** How much of a straight road's kerb shows outside the asphalt. */
  function visibleOnStraight(type: number): number {
    const w = ROAD_WIDTHS[type]!;
    const strip = buildSidewalkStrips([cell(NS, type)]).find(s => s.x > 0)!;
    return strip.x + strip.sx / 2 - w / 2;
  }

  it.each(TYPES)('should bury half the kerb under the asphalt on a straight (%i)', (type) => {
    // A straight road's kerb **straddles the asphalt's edge**: the strip's centre sits at
    // +/-width/2 and its inner half is under the surface, since the kerb's plane is at y = 0.028
    // and the road slab spans 0 to 0.05. So only half of it shows — which is why this case exists,
    // and a bend has to follow the same rule.
    expect(visibleOnStraight(type)).toBeCloseTo(SIDEWALK_WIDTH / 2, 9);
  });

  it.each(TYPES)('should show exactly as much kerb on a bend (%i)', (type) => {
    // With the whole kerb placed outside the asphalt, a bend shows 0.14 against a straight road's
    // 0.07: exactly twice, at every road width.
    const w = ROAD_WIDTHS[type]!;
    const asphaltEdge = 0.5 + w / 2;
    const c = turnCentre(NE);
    const want = visibleOnStraight(type);
    for (const s of buildSidewalkStrips([cell(NE, type)])) {
      const visible = Math.hypot(s.x - c.cx, s.z - c.cz) + s.sx / 2 - asphaltEdge;
      expect(visible, `路寬 ${w}:彎道露出 ${visible.toFixed(4)}，直路露出 ${want.toFixed(4)}`)
        .toBeCloseTo(want, 2);
    }
  });
});

describe('高架路燈的光只灑在橋面上', () => {
  /** Which way this lamp's light opens: local +Z rotated by rotY. */
  const facing = (l: { rotY: number }) => ({ x: Math.sin(l.rotY), z: Math.cos(l.rotY) });

  /** The unit vector from a toward b. */
  function towards(a: { x: number; z: number }, bx: number, bz: number) {
    const dx = bx - a.x, dz = bz - a.z;
    const len = Math.hypot(dx, dz);
    return { x: dx / len, z: dz / len };
  }

  it('should face a straight road`s lamp inwards, across the carriageway', () => {
    // An elevated lamp's glow is a half circle rather than a full one: it stands at the deck's edge
    // and its light should not fall into open air beyond the bridge. Which way the half opens comes
    // from rotY, and it has to point at the road surface.
    for (const l of buildLampPositions([cell(NS)])) {
      const f = facing(l);
      const inward = towards(l, 0, 0);
      expect(f.x * inward.x + f.z * inward.z).toBeCloseTo(1, 6);
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should face a bend`s lamps at the centre of the turn (%i)', (flags) => {
    // On a bend, inward is the direction of the bend's centre rather than a coordinate axis: each
    // lamp points inward, and together they make a band of light along the arc.
    const c = turnCentre(flags);
    for (const l of buildLampPositions([cell(flags)])) {
      const f = facing(l);
      const inward = towards(l, c.cx, c.cz);
      expect(f.x * inward.x + f.z * inward.z).toBeCloseTo(1, 6);
    }
  });

  it('should face every side of a dead end back at the road', () => {
    // A dead end needs a lamp on every side but the one traffic arrives from. All three point at the
    // cell's centre; sharing one angle sends two of them off the bridge. Checking only that the
    // angles differ is not enough: three distinct angles can all point the wrong way.
    const lamps = buildLampPositions([cell(RoadDirection.NORTH)]);
    expect(lamps).toHaveLength(3);
    for (const l of lamps) {
      const f = facing(l);
      const inward = towards(l, 0, 0);
      expect(f.x * inward.x + f.z * inward.z, `(${l.x}, ${l.z}) 的光打到橋外面`)
        .toBeCloseTo(1, 6);
    }
  });
});
