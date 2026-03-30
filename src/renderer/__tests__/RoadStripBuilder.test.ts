import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../../core/road/types';
import {
  buildCenterLineData,
  buildCurvedCenterLineData,
  buildLaneMarkingData,
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
