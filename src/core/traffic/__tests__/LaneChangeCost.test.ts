import { describe, it, expect } from 'vitest';
import { LaneGraph, type LaneEdge } from '../LaneGraph';
import { refineLanePath, laneEdgeCost, LANE_CHANGE_COST } from '../Pathfinding';
import { RoadType } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/**
 * "Changing lane must cost more than going straight" was the one lane-level
 * rule never implemented, and it was violated outright.
 *
 * Lane-change edges already carried the real diagonal length — 0.9178 against
 * 0.9000 on a six-lane road — and the generator equalises them at turns so
 * geometry alone cannot favour crossing lanes. But the cost also divides by
 * getLaneSpeedMultiplier(lane) = 0.95^lane, making each lane inward 5% cheaper.
 * Two percent of geometry does not hold against five percent of speed:
 *
 *     stay in lane 1   0.9000 / 0.95 = 0.9474
 *     dive to lane 0   0.9178 / 1.00 = 0.9178   <- CHEAPER
 *
 * So one manoeuvre paid for itself immediately, and a straight ten-cell
 * six-lane road produced lanes `2 1 1 0 0 0 0 0 0 0 0 0 0 1 1 2 2` — four
 * changes, the outer pair of which bought nothing.
 *
 * What is NOT a defect, and is deliberately preserved: moving to a faster lane
 * for a long run. LanePathfinding.test.ts already pins both halves of that —
 * three cells must not change lane, ten cells must — and those are the cases
 * LANE_CHANGE_COST is calibrated against.
 */
function straightRoad(cellCount: number, roadType: RoadType) {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const keys: string[] = [];
  for (let x = 0; x < cellCount; x++) {
    cells.set(`${x},0`, { roadType, roadFlags: 12 });
    keys.push(`${x},0`);
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), keys);
  return { graph, keys };
}

const changesOn = (cellCount: number, roadType: RoadType) => {
  const { graph, keys } = straightRoad(cellCount, roadType);
  const path = refineLanePath(graph, keys);
  expect(path, `${roadType} x${cellCount} must stay routable`).not.toBeNull();
  return (path ?? []).filter(e => e.type === 'lane_change').length;
};

const edge = (length: number, type: LaneEdge['type'], lane: number) =>
  ({ length, type, to: { lane } } as LaneEdge);

describe('changing lane costs more than going straight', () => {
  it('should cost more to dive into the fast lane than to stay put', () => {
    // The exact violation, in the exact figures it occurred at.
    expect(laneEdgeCost(edge(0.9178, 'lane_change', 0)))
      .toBeGreaterThan(laneEdgeCost(edge(0.9, 'straight', 1)));
  });

  it('should charge the same for a manoeuvre whatever lane it ends in', () => {
    // Fixed, not proportional: the manoeuvre takes what it takes, and an
    // additive cost is what makes it repayable only over distance.
    for (const lane of [0, 1, 2]) {
      expect(laneEdgeCost(edge(0.9, 'lane_change', lane)) - laneEdgeCost(edge(0.9, 'straight', lane)))
        .toBeCloseTo(LANE_CHANGE_COST, 9);
    }
  });

  it('should scale with the road speed like every other edge', () => {
    // A faster road makes every edge cheaper; the manoeuvre must not be exempt,
    // or it would dominate the cost on motorways.
    expect(laneEdgeCost(edge(0.9, 'lane_change', 0), 2))
      .toBeLessThan(laneEdgeCost(edge(0.9, 'lane_change', 0), 1));
  });
});

describe('the vehicle only crosses lanes when it keeps the gain', () => {
  it('should stay put on a short road', () => {
    expect(changesOn(3, RoadType.FOUR_LANE)).toBe(0);
  });

  it('should still move over on a long one', () => {
    // Deliberately preserved. Making multi-lane roads pointless to the
    // pathfinder would be a worse bug than the weaving.
    expect(changesOn(10, RoadType.FOUR_LANE)).toBeGreaterThan(0);
  });

  it('should cross at most once each way, however long the road', () => {
    // Out and back. More than that is weaving.
    for (const n of [10, 20, 30]) {
      expect(changesOn(n, RoadType.FOUR_LANE), `${n} cells`).toBeLessThanOrEqual(2);
    }
  });

  it('should not carry on past the second lane into the first', () => {
    // A straight six-lane road used to go 2 -> 1 -> 0 and back: four
    // manoeuvres, the outer pair of which bought nothing.
    expect(changesOn(10, RoadType.SIX_LANE)).toBeLessThanOrEqual(2);
  });

  it('should never make a road unroutable', () => {
    // A preference, not a prohibition.
    for (const t of [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE,
                     RoadType.SIX_LANE, RoadType.ONE_WAY]) {
      expect(() => changesOn(6, t)).not.toThrow();
    }
  });
});
