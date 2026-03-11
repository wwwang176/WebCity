import { describe, it, expect } from 'vitest';
import {
  buildLinePath,
  distanceToSegmentParam,
  advanceTrain,
  type TrainAnimState,
} from '../MetroLinePath';

describe('buildLinePath', () => {
  it('should return empty path for fewer than 2 stations', () => {
    expect(buildLinePath([]).segments).toHaveLength(0);
    expect(buildLinePath([{ x: 0, y: 0 }]).segments).toHaveLength(0);
  });

  it('should create 2 segments (round trip) for 2 stations', () => {
    const path = buildLinePath([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    // 2 stations → A→B and B→A (round trip)
    expect(path.segments).toHaveLength(2);
    expect(path.totalLength).toBeCloseTo(10); // 5 + 5
    expect(path.stationDistances).toHaveLength(2);
    expect(path.stationDistances[0]).toBe(0);
    expect(path.stationDistances[1]).toBeCloseTo(5); // dist(A,B) = 5
  });

  it('should create N segments for 3+ stations (loop)', () => {
    const path = buildLinePath([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ]);
    expect(path.segments).toHaveLength(3);
    // seg0: (0,0)→(3,0) = 3
    // seg1: (3,0)→(3,4) = 4
    // seg2: (3,4)→(0,0) = 5
    expect(path.stationDistances[0]).toBe(0);
    expect(path.stationDistances[1]).toBeCloseTo(3);
    expect(path.stationDistances[2]).toBeCloseTo(7);
    expect(path.totalLength).toBeCloseTo(12);
  });

  it('should have monotonically increasing cumulativeStart', () => {
    const path = buildLinePath([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ]);
    for (let i = 1; i < path.segments.length; i++) {
      expect(path.segments[i]!.cumulativeStart).toBeGreaterThan(
        path.segments[i - 1]!.cumulativeStart
      );
    }
  });
});

describe('distanceToSegmentParam', () => {
  const path = buildLinePath([
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 8 },
  ]);
  // seg0: 6, seg1: 8, seg2: 10 → total = 24

  it('should return segment 0, localT=0 at distance 0', () => {
    const result = distanceToSegmentParam(path, 0);
    expect(result.segmentIndex).toBe(0);
    expect(result.localT).toBeCloseTo(0);
  });

  it('should return correct segment and localT at midpoint', () => {
    const result = distanceToSegmentParam(path, 3); // middle of seg0 (length 6)
    expect(result.segmentIndex).toBe(0);
    expect(result.localT).toBeCloseTo(0.5);
  });

  it('should transition to next segment', () => {
    const result = distanceToSegmentParam(path, 10); // 6 (seg0) + 4 (half seg1)
    expect(result.segmentIndex).toBe(1);
    expect(result.localT).toBeCloseTo(0.5);
  });

  it('should wrap around for distances >= totalLength', () => {
    const result = distanceToSegmentParam(path, path.totalLength + 3);
    expect(result.segmentIndex).toBe(0);
    expect(result.localT).toBeCloseTo(0.5);
  });

  it('should handle negative distances by wrapping', () => {
    const result = distanceToSegmentParam(path, -3);
    // -3 wraps to totalLength - 3 = 21, which is in seg2
    expect(result.segmentIndex).toBe(2);
  });
});

describe('advanceTrain', () => {
  const totalLength = 12;
  const stationDistances = [0, 4, 8]; // 3 stations
  const speed = 2;       // units/sec
  const waitTime = 1.0;  // seconds

  function createTrain(overrides?: Partial<TrainAnimState>): TrainAnimState {
    return {
      distance: 0,
      atStation: false,
      waitTimer: 0,
      nextStationIndex: 1,
      ...overrides,
    };
  }

  it('should advance distance by speed * dt', () => {
    const train = createTrain({ distance: 1 });
    advanceTrain(train, 0.5, totalLength, stationDistances, speed, waitTime);
    expect(train.distance).toBeCloseTo(2); // 1 + 2*0.5
  });

  it('should stop at next station', () => {
    const train = createTrain({ distance: 3.5, nextStationIndex: 1 });
    advanceTrain(train, 0.5, totalLength, stationDistances, speed, waitTime);
    // Would reach 4.5, but station at 4 → snap to 4
    expect(train.distance).toBeCloseTo(4);
    expect(train.atStation).toBe(true);
    expect(train.waitTimer).toBeCloseTo(waitTime);
  });

  it('should wait at station and then resume', () => {
    const train = createTrain({
      distance: 4,
      atStation: true,
      waitTimer: 0.5,
      nextStationIndex: 2,
    });
    // Wait phase: reduce timer
    advanceTrain(train, 0.3, totalLength, stationDistances, speed, waitTime);
    expect(train.atStation).toBe(true);
    expect(train.waitTimer).toBeCloseTo(0.2);

    // Wait complete
    advanceTrain(train, 0.3, totalLength, stationDistances, speed, waitTime);
    expect(train.atStation).toBe(false);
  });

  it('should advance nextStationIndex when departing', () => {
    const train = createTrain({
      distance: 4,
      atStation: true,
      waitTimer: 0.1,
      nextStationIndex: 2,
    });
    advanceTrain(train, 0.2, totalLength, stationDistances, speed, waitTime);
    expect(train.atStation).toBe(false);
    expect(train.nextStationIndex).toBe(2); // still heading to 2
  });

  it('should wrap around to station 0 at end of loop', () => {
    const train = createTrain({
      distance: 11.5,
      nextStationIndex: 0,
    });
    advanceTrain(train, 0.5, totalLength, stationDistances, speed, waitTime);
    // Would reach 12.5, wraps → station 0 at distance 0 (=totalLength)
    expect(train.distance).toBeCloseTo(0);
    expect(train.atStation).toBe(true);
    expect(train.nextStationIndex).toBe(1);
  });

  it('should not move when dt is 0', () => {
    const train = createTrain({ distance: 5 });
    advanceTrain(train, 0, totalLength, stationDistances, speed, waitTime);
    expect(train.distance).toBeCloseTo(5);
  });
});
