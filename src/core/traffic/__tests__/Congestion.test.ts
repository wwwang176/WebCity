import { describe, it, expect } from 'vitest';
import { getCongestionRate, getSpeedMultiplier, CONGESTION } from '../Congestion';
import { TrafficSimulation } from '../TrafficSimulation';
import { LaneEdge, LaneNode } from '../LaneGraph';

describe('Congestion', () => {
  it('should calculate congestion rate', () => {
    expect(getCongestionRate(8, 10)).toBeCloseTo(0.8);
    expect(getCongestionRate(12, 10)).toBeCloseTo(1.2);
  });

  it('should reduce speed at >80% congestion', () => {
    const multiplier = getSpeedMultiplier(0.85);
    expect(multiplier).toBe(0.5);
  });

  it('should nearly stop at >100% congestion', () => {
    const multiplier = getSpeedMultiplier(1.2);
    expect(multiplier).toBeLessThan(0.2);
  });

  it('should have full speed under 50% congestion', () => {
    expect(getSpeedMultiplier(0.3)).toBe(1);
  });

  it('should recover speed when congestion drops', () => {
    const high = getSpeedMultiplier(0.9);
    const low = getSpeedMultiplier(0.3);
    expect(low).toBeGreaterThan(high);
  });

  it('CONGESTION thresholds should be in ascending order', () => {
    expect(CONGESTION.LOW_THRESHOLD).toBeLessThan(CONGESTION.MEDIUM_THRESHOLD);
    expect(CONGESTION.MEDIUM_THRESHOLD).toBeLessThan(CONGESTION.HIGH_THRESHOLD);
  });

  it('CONGESTION speed multipliers should decrease with congestion', () => {
    expect(CONGESTION.MEDIUM_SPEED).toBeLessThan(1);
    expect(CONGESTION.HIGH_SPEED).toBeLessThan(CONGESTION.MEDIUM_SPEED);
    expect(CONGESTION.MIN_SPEED).toBeLessThan(CONGESTION.HIGH_SPEED);
  });
});

describe('TrafficSimulation.getCongestionLevel', () => {
  it('returns 0 when no vehicles exist', () => {
    const ts = new TrafficSimulation();
    expect(ts.getCongestionLevel()).toBe(0);
  });

  it('returns a value between 0 and 1 with vehicles', () => {
    const ts = new TrafficSimulation();
    // Add some fake vehicles by adding edge paths
    const nodeA: LaneNode = { cellKey: '0,0', lane: 0 };
    const nodeB: LaneNode = { cellKey: '1,0', lane: 0 };
    const edge: LaneEdge = { from: nodeA, to: nodeB, length: 1 };
    for (let i = 0; i < 5; i++) {
      ts.addVehicleOnEdges([edge]);
    }
    const level = ts.getCongestionLevel();
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });

  it('increases with more vehicles', () => {
    const ts = new TrafficSimulation();
    const nodeA: LaneNode = { cellKey: '0,0', lane: 0 };
    const nodeB: LaneNode = { cellKey: '1,0', lane: 0 };
    const edge: LaneEdge = { from: nodeA, to: nodeB, length: 1 };

    for (let i = 0; i < 3; i++) ts.addVehicleOnEdges([edge]);
    const low = ts.getCongestionLevel();

    for (let i = 0; i < 50; i++) ts.addVehicleOnEdges([edge]);
    const high = ts.getCongestionLevel();

    expect(high).toBeGreaterThanOrEqual(low);
  });
});
