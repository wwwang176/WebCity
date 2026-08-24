import { describe, it, expect } from 'vitest';
import {
  RoadType, RoadDirection, ROAD_WIDTHS, getLaneCount, getLaneWidth,
} from '../../core/road/types';
import {
  buildCenterLineData,
  buildCurvedCenterLineData,
  buildLaneMarkingData,
  MAX_LANE_MARKINGS_PER_CELL,
  type RoadCell,
  type CenterLine,
  type CurvedCenterLine,
} from '../RoadStripBuilder';

function makeCell(x: number, y: number, roadType: number, flags: number): RoadCell {
  return { x, y, roadType, roadFlags: flags };
}

const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const EW = RoadDirection.EAST | RoadDirection.WEST;
const NE = RoadDirection.NORTH | RoadDirection.EAST;
const NW = RoadDirection.NORTH | RoadDirection.WEST;
const SE = RoadDirection.SOUTH | RoadDirection.EAST;
const SW = RoadDirection.SOUTH | RoadDirection.WEST;

describe('buildCenterLineData', () => {
  it('returns empty for RURAL road', () => {
    const cells = [makeCell(5, 5, RoadType.RURAL, NS)];
    expect(buildCenterLineData(cells)).toEqual([]);
  });

  it('returns empty for TWO_LANE road', () => {
    const cells = [makeCell(5, 5, RoadType.TWO_LANE, NS)];
    expect(buildCenterLineData(cells)).toEqual([]);
  });

  it('returns empty for ONE_WAY road', () => {
    const cells = [makeCell(5, 5, RoadType.ONE_WAY, NS)];
    expect(buildCenterLineData(cells)).toEqual([]);
  });

  it('generates 2 center lines for FOUR_LANE N-S road', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NS)];
    const result = buildCenterLineData(cells);
    expect(result.length).toBe(2);
    // Two parallel lines with small perpendicular offset
    const offsets = result.map(r => r.offsetPerp).sort((a, b) => a - b);
    expect(offsets[0]).toBeLessThan(0);
    expect(offsets[1]).toBeGreaterThan(0);
    expect(Math.abs(offsets[0]! + offsets[1]!)).toBeCloseTo(0); // symmetric
    // Both should span the full cell (continuous solid line)
    expect(result[0]!.length).toBeGreaterThan(0.5);
    // rotY=0 for N-S
    expect(result[0]!.rotY).toBe(0);
    expect(result[1]!.rotY).toBe(0);
  });

  it('generates 2 center lines for SIX_LANE N-S road', () => {
    const cells = [makeCell(5, 5, RoadType.SIX_LANE, NS)];
    const result = buildCenterLineData(cells);
    expect(result.length).toBe(2);
  });

  it('generates 2 center lines for HIGHWAY N-S road', () => {
    const cells = [makeCell(5, 5, RoadType.HIGHWAY, NS)];
    const result = buildCenterLineData(cells);
    expect(result.length).toBe(2);
  });

  it('generates center lines for E-W road with rotY=PI/2', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, EW)];
    const result = buildCenterLineData(cells);
    expect(result.length).toBe(2);
    expect(result[0]!.rotY).toBe(Math.PI / 2);
  });

  it('skips intersections (3+ connections)', () => {
    const cells = [
      makeCell(5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST),
    ];
    expect(buildCenterLineData(cells)).toEqual([]);
  });

  it('does not include center line in lane marking offsets for 4+ lane roads', () => {
    // After refactor, buildLaneMarkingData should NOT emit offsetPerp=0 for isFourLane
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NS)];
    const markings = buildLaneMarkingData(cells);
    const centerMarkings = markings.filter(m => m.offsetPerp === 0);
    expect(centerMarkings.length).toBe(0);
  });

  it('straight center line skips L-bends', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NE)];
    expect(buildCenterLineData(cells)).toEqual([]);
  });

  it('shortens center line near intersection neighbor', () => {
    // Cell at (5,4) is an intersection, cell at (5,5) is FOUR_LANE N-S
    const cells = [
      makeCell(5, 4, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST),
      makeCell(5, 5, RoadType.FOUR_LANE, NS),
    ];
    const result = buildCenterLineData(cells);
    // Should still produce lines but might be shorter on the north side
    expect(result.length).toBe(2);
    // The lines should be positioned shifted away from the intersection
    for (const cl of result) {
      // Center of line should be shifted south (away from intersection at y=4)
      expect(cl.z).toBeGreaterThan(5);
    }
  });
});

describe('buildCurvedCenterLineData', () => {
  it('returns empty for non-L-bend (straight N-S)', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NS)];
    expect(buildCurvedCenterLineData(cells)).toEqual([]);
  });

  it('returns empty for intersections', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NE | RoadDirection.SOUTH)];
    expect(buildCurvedCenterLineData(cells)).toEqual([]);
  });

  it('returns empty for TWO_LANE L-bend', () => {
    const cells = [makeCell(5, 5, RoadType.TWO_LANE, NE)];
    expect(buildCurvedCenterLineData(cells)).toEqual([]);
  });

  it('returns empty for ONE_WAY L-bend', () => {
    const cells = [makeCell(5, 5, RoadType.ONE_WAY, NE)];
    expect(buildCurvedCenterLineData(cells)).toEqual([]);
  });

  it('generates 1 entry for FOUR_LANE N+E bend', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NE)];
    const result = buildCurvedCenterLineData(cells);
    expect(result.length).toBe(1);
    // Arc center at NE corner of cell
    expect(result[0]!.cx).toBeCloseTo(5.5);
    expect(result[0]!.cz).toBeCloseTo(4.5);
    expect(result[0]!.scaleX).toBe(1);
    expect(result[0]!.rotY).toBe(0);
  });

  it('generates 1 entry for FOUR_LANE N+W bend', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NW)];
    const result = buildCurvedCenterLineData(cells);
    expect(result.length).toBe(1);
    expect(result[0]!.cx).toBeCloseTo(4.5);
    expect(result[0]!.cz).toBeCloseTo(4.5);
    expect(result[0]!.scaleX).toBe(-1);
    expect(result[0]!.rotY).toBe(0);
  });

  it('generates 1 entry for FOUR_LANE S+W bend', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, SW)];
    const result = buildCurvedCenterLineData(cells);
    expect(result.length).toBe(1);
    expect(result[0]!.cx).toBeCloseTo(4.5);
    expect(result[0]!.cz).toBeCloseTo(5.5);
    expect(result[0]!.scaleX).toBe(1);
    expect(result[0]!.rotY).toBeCloseTo(Math.PI);
  });

  it('generates 1 entry for FOUR_LANE S+E bend', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, SE)];
    const result = buildCurvedCenterLineData(cells);
    expect(result.length).toBe(1);
    expect(result[0]!.cx).toBeCloseTo(5.5);
    expect(result[0]!.cz).toBeCloseTo(5.5);
    expect(result[0]!.scaleX).toBe(-1);
    expect(result[0]!.rotY).toBeCloseTo(Math.PI);
  });

  it('works for HIGHWAY and SIX_LANE L-bends', () => {
    expect(buildCurvedCenterLineData([makeCell(5, 5, RoadType.HIGHWAY, NE)]).length).toBe(1);
    expect(buildCurvedCenterLineData([makeCell(5, 5, RoadType.SIX_LANE, SW)]).length).toBe(1);
  });
});

describe('buildLaneMarkingData L-bend support', () => {
  it('generates dashes for FOUR_LANE N+E bend', () => {
    const cells = [makeCell(5, 5, RoadType.FOUR_LANE, NE)];
    const markings = buildLaneMarkingData(cells);
    expect(markings.length).toBeGreaterThan(0);
    // Each marking should have offsetPerp=0 (pre-baked into position)
    for (const m of markings) {
      expect(m.offsetPerp).toBe(0);
    }
  });

  it('generates dashes for TWO_LANE N+E bend', () => {
    const cells = [makeCell(5, 5, RoadType.TWO_LANE, NE)];
    const markings = buildLaneMarkingData(cells);
    expect(markings.length).toBeGreaterThan(0);
  });

  it('skips RURAL L-bends', () => {
    const cells = [makeCell(5, 5, RoadType.RURAL, NE)];
    expect(buildLaneMarkingData(cells)).toEqual([]);
  });

  it('generates dashes for all 4 L-bend orientations', () => {
    for (const flags of [NE, NW, SE, SW]) {
      const cells = [makeCell(5, 5, RoadType.FOUR_LANE, flags)];
      const markings = buildLaneMarkingData(cells);
      expect(markings.length).toBeGreaterThan(0);
    }
  });
});

/**
 * A painted lane divider falls between the two lanes cars actually drive in.
 *
 * Placing dividers at `road width / 4` and drawing exactly **one** regardless of lane count made two
 * independent sets of numbers, the other being the lane graph's lane width. Four lanes happened to
 * line up, since `w/4` equals the lane width at two lanes, while six lanes gave one divider against
 * three columns of cars, with that line between no two of them.
 *
 * Both sides now come from `getLaneWidth`.
 */
describe('虛線與車道', () => {
  /** The lateral divider positions in the middle cell of a straight east-west road, deduplicated, positive, inner to outer. */
  function dividers(roadType: RoadType): number[] {
    const cells: RoadCell[] = [];
    for (let x = 0; x < 3; x++) {
      cells.push({
        x, y: 0, roadType,
        roadFlags: (x > 0 ? RoadDirection.WEST : 0) | (x < 2 ? RoadDirection.EAST : 0),
      });
    }
    const mine = buildLaneMarkingData(cells).filter(m => m.srcX === 1);
    // Deduplicated without rounding: every dash of one divider already carries the same value, and
    // truncating only distorts the comparisons below past the seventh decimal.
    return [...new Set(mine.map(m => m.offsetPerp))]
      .filter(o => o > 0)
      .sort((a, b) => a - b);
  }

  /** That direction's lane centres, inner to outer. */
  function laneCentres(roadType: RoadType): number[] {
    const w = getLaneWidth(roadType);
    return Array.from({ length: getLaneCount(roadType) }, (_, i) => (i + 0.5) * w);
  }

  it('should draw one divider between every pair of adjacent lanes', () => {
    for (const roadType of [RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY]) {
      expect(dividers(roadType).length, `${roadType}：虛線數量不等於車道間隙數`)
        .toBe(getLaneCount(roadType) - 1);
    }
  });

  it('should put each divider exactly between the two lanes it separates', () => {
    for (const roadType of [RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY]) {
      const centres = laneCentres(roadType);
      const lines = dividers(roadType);
      lines.forEach((line, i) => {
        const between = (centres[i]! + centres[i + 1]!) / 2;
        expect(line, `${roadType}：第 ${i} 條虛線沒有落在兩排車中間`)
          .toBeCloseTo(between, 9);
      });
    }
  });

  it('should keep the dashes on the asphalt', () => {
    for (const roadType of [RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY]) {
      const half = ROAD_WIDTHS[roadType]! / 2;
      for (const line of dividers(roadType)) {
        expect(line, `${roadType}：虛線畫到路面外`).toBeLessThan(half);
      }
    }
  });

  it('should still draw a dashed centre line on a single-lane-per-direction road', () => {
    // With one lane there is no between-lanes, and the divider is the centre line itself.
    const cells: RoadCell[] = [{
      x: 0, y: 0, roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    }];
    const offsets = new Set(buildLaneMarkingData(cells).map(m => m.offsetPerp));
    expect([...offsets], '兩車道的虛線不在中心線上').toEqual([0]);
  });
});

/**
 * The divider instance capacity covers what is actually drawn.
 *
 * `RoadInstanceTracker` returns -1 when full and the caller skips the whole cell, so dividers past
 * the capacity disappear silently without an error. Six lanes going from 8 dashes per cell to 16
 * ran straight into a hardcoded 14.
 */
describe('虛線的容量', () => {
  const TWO_WAY_FLAGS = [
    RoadDirection.NORTH | RoadDirection.SOUTH,
    RoadDirection.EAST | RoadDirection.WEST,
    RoadDirection.NORTH | RoadDirection.EAST,
    RoadDirection.NORTH | RoadDirection.WEST,
    RoadDirection.SOUTH | RoadDirection.EAST,
    RoadDirection.SOUTH | RoadDirection.WEST,
  ];

  it('should never emit more markings for one cell than the cap allows', () => {
    for (const roadType of Object.keys(ROAD_WIDTHS).map(Number)) {
      for (const roadFlags of TWO_WAY_FLAGS) {
        const n = buildLaneMarkingData([{ x: 0, y: 0, roadType, roadFlags }]).length;
        expect(n, `路型 ${roadType}、旗標 ${roadFlags}：一格畫了 ${n} 條，超過上限`)
          .toBeLessThanOrEqual(MAX_LANE_MARKINGS_PER_CELL);
      }
    }
  });

  it('should be tight enough to be worth having', () => {
    // A capacity set too high keeps this green forever; the widest road has to actually reach it.
    const worst = Math.max(...Object.keys(ROAD_WIDTHS).map(Number).flatMap(roadType =>
      TWO_WAY_FLAGS.map(roadFlags =>
        buildLaneMarkingData([{ x: 0, y: 0, roadType, roadFlags }]).length)));
    expect(worst, '上限比任何一種路實際畫的都寬').toBe(MAX_LANE_MARKINGS_PER_CELL);
  });
});
