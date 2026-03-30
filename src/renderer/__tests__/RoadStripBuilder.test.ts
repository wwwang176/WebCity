import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../../core/road/types';
import {
  buildCenterLineData,
  buildLaneMarkingData,
  type RoadCell,
  type CenterLine,
} from '../RoadStripBuilder';

function makeCell(x: number, y: number, roadType: number, flags: number): RoadCell {
  return { x, y, roadType, roadFlags: flags };
}

const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const EW = RoadDirection.EAST | RoadDirection.WEST;

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
