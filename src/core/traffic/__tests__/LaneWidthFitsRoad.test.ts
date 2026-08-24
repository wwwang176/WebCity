import { describe, it, expect } from 'vitest';
import { LaneGraph } from '../LaneGraph';
import { SERVICE_VEHICLE_DIMS } from '../TrafficSimulation';
import {
  RoadType, RoadDirection, ROAD_WIDTHS, getLaneCount, getLaneWidth,
} from '../../road/types';
import { ROAD_WIDTHS as SIDEWALK_ROAD_WIDTHS } from '../SidewalkGraph';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/**
 * Vehicles drive on their own asphalt.
 *
 * A fixed lane width (`LANE_GEOMETRY.LANE_WIDTH = 0.18`) is independent of road width
 * (`ROAD_WIDTHS`). Three lanes per direction on a six-lane road come to 0.54 against a half
 * road width of only 0.475, so part of the outermost lane lies off the asphalt and vehicles
 * drive there: a 0.125-wide truck overhangs the kerb by 0.0375 cells (45cm) with its wheels on
 * the pavement.
 *
 * Lane width is therefore derived from road width: `road width / 2 / lanes in that direction`.
 */

const WITH_WIDTH = [
  RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE,
  RoadType.SIX_LANE, RoadType.HIGHWAY, RoadType.ONE_WAY,
] as const;

/** The widest vehicle. Trucks and fire engines share a width; this is the maximum of the
 *  service vehicle dimension table. */
const WIDEST_VEHICLE = Math.max(
  ...Object.values(SERVICE_VEHICLE_DIMS).map(d => d.width),
);

/** A straight east-west road; returns each lane's lateral offset from the centre line at the
 *  middle cell. */
function laneOffsets(roadType: RoadType): number[] {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  for (let x = 0; x < 3; x++) {
    cells.set(`${x},0`, {
      roadType,
      roadFlags: (x > 0 ? RoadDirection.WEST : 0) | (x < 2 ? RoadDirection.EAST : 0),
    });
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return graph.getConnectionPoints('1,0')
    .filter(p => p.type === 'exit' && p.direction === 'east')
    .sort((a, b) => a.lane - b.lane)
    .map(p => p.position.y);
}

describe('車道寬與路寬', () => {
  it('should have exactly one table of road widths', () => {
    // With two independent copies, editing one silently puts the vehicles off the asphalt.
    expect(SIDEWALK_ROAD_WIDTHS, '路寬有第二份拷貝').toBe(ROAD_WIDTHS);
  });

  it.each(WITH_WIDTH)('should fit every lane inside the asphalt on a %s road', (roadType) => {
    const half = ROAD_WIDTHS[roadType]!/ 2;
    const lanes = getLaneCount(roadType);
    expect(lanes * getLaneWidth(roadType), `${roadType}：該向車道加起來比路面半寬還寬`)
      .toBeLessThanOrEqual(half + 1e-9);
  });

  it.each(WITH_WIDTH)('should keep the widest vehicle on the asphalt on a %s road', (roadType) => {
    // A lane **centre** inside the asphalt is not enough: vehicles have width.
    const half = ROAD_WIDTHS[roadType]! / 2;
    const outermost = (getLaneCount(roadType) - 0.5) * getLaneWidth(roadType);
    expect(outermost + WIDEST_VEHICLE / 2, `${roadType}：最外側車道的車會壓到路緣外`)
      .toBeLessThanOrEqual(half + 1e-9);
  });

  it.each(WITH_WIDTH)('should place the lanes the graph hands out inside the road (%s)', (roadType) => {
    // The two above check the formula; this one checks that the lane graph **actually lays the
    // lanes out that way**.
    const half = ROAD_WIDTHS[roadType]! / 2;
    const offsets = laneOffsets(roadType);
    expect(offsets.length, `${roadType}：車道圖沒有給出車道`).toBe(getLaneCount(roadType));
    for (const o of offsets) {
      expect(Math.abs(o) + WIDEST_VEHICLE / 2, `${roadType}：車道圖把車排到路面外`)
        .toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(o), `${roadType}：車道壓在中心線上`).toBeGreaterThan(0);
    }
  });

  it('should widen the lanes as the road widens, per direction', () => {
    // Four-lane and six-lane are both arterials, but six-lane fits three per direction, so each
    // must be narrower.
    expect(getLaneWidth(RoadType.SIX_LANE), '六車道的車道沒有比四車道窄')
      .toBeLessThan(getLaneWidth(RoadType.FOUR_LANE));
    expect(getLaneWidth(RoadType.FOUR_LANE), '四車道的車道沒有比兩車道窄')
      .toBeLessThan(getLaneWidth(RoadType.TWO_LANE));
  });

  it('should keep opposing traffic on opposite sides', () => {
    // Lanes are laid out outwards from the centre line, so the innermost centre is half a lane
    // width. Zero would overlap opposing traffic on the centre line.
    for (const roadType of WITH_WIDTH) {
      const innermost = 0.5 * getLaneWidth(roadType);
      expect(innermost, `${roadType}：最內側車道壓在中心線上`).toBeGreaterThan(0);
    }
  });

  it('should still split a one-way road into its full lane count', () => {
    // Every lane on a one-way road runs the same way, so its lane count is the total, and lane
    // width still divides its own half width.
    expect(getLaneCount(RoadType.ONE_WAY)).toBe(2);
  });
});

describe('車道圖用的是算出來的車道寬', () => {
  it('should not fall back to a fixed lane width', () => {
    // Identical spacing for two-lane and six-lane roads means a fixed constant is still in use.
    const two = laneOffsets(RoadType.TWO_LANE);
    const six = laneOffsets(RoadType.SIX_LANE);
    expect(two[0], '兩車道的車道位置還是寫死的 0.09').not.toBeCloseTo(six[0]!, 6);
  });

  it('should space the lanes evenly across the half road', () => {
    const six = laneOffsets(RoadType.SIX_LANE).map(Math.abs).sort((a, b) => a - b);
    const w = getLaneWidth(RoadType.SIX_LANE);
    expect(six).toHaveLength(3);
    six.forEach((o, i) => {
      expect(o, `第 ${i} 條車道的中心不在 (i + 0.5) × 車道寬`)
        .toBeCloseTo((i + 0.5) * w, 9);
    });
  });
});
