import { describe, it, expect } from 'vitest';
import { getTrafficStats, type TrafficStatsContext } from '../TrafficStats';

function makeCtx(overrides: Partial<TrafficStatsContext> = {}): TrafficStatsContext {
  return {
    commuteVehicleCount: overrides.commuteVehicleCount ?? 0,
    topCongested: overrides.topCongested ?? [],
    avgPathLength: overrides.avgPathLength ?? 0,
    roadTileCount: overrides.roadTileCount ?? 0,
  };
}

describe('getTrafficStats', () => {
  it('should return zeros for empty city', () => {
    const result = getTrafficStats(makeCtx());
    expect(result.commuteVehicleCount).toBe(0);
    expect(result.topCongested).toEqual([]);
    expect(result.avgPathLength).toBe(0);
    expect(result.totalRoads).toBe(0);
  });

  it('should pass through the commute vehicle count', () => {
    const result = getTrafficStats(makeCtx({ commuteVehicleCount: 42 }));
    expect(result.commuteVehicleCount).toBe(42);
  });

  it('should pass through top congested segments', () => {
    const congested = [
      { segment: '5,5', density: 0.8 },
      { segment: '10,10', density: 0.6 },
    ];
    const result = getTrafficStats(makeCtx({ topCongested: congested }));
    expect(result.topCongested).toEqual(congested);
  });

  it('should round avg path length to 1 decimal', () => {
    const result = getTrafficStats(makeCtx({ avgPathLength: 12.345 }));
    expect(result.avgPathLength).toBe(12.3);
  });

  it('should return road tile count as totalRoads', () => {
    const result = getTrafficStats(makeCtx({ roadTileCount: 150 }));
    expect(result.totalRoads).toBe(150);
  });
});
