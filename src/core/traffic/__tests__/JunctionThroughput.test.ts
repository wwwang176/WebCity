import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import { TRAFFIC_LIGHT } from '../TrafficLights';
import type { LaneEdge } from '../LaneGraph';

/**
 * How many vehicles one green clears.
 *
 * Signal phases are in **real seconds** while vehicle speed is in cells per second, with no
 * link between them. Halving the speed halves the distance covered during a green and halves
 * the vehicles that get through (measured: a 4-second green went from 14 to 7), silently
 * halving junction throughput.
 *
 * This group therefore pins **throughput**, not durations, so moving either the phase length or
 * the speed alone turns it red. Comparing against something like "duration x speed" would move
 * with both.
 */

function path(n: number): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}`,
      from: {
        id: `e${i}_f`, cellKey: `${i},0`, position: { x: i, y: 0 },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight',
    });
  }
  return edges;
}

/** Queues vehicles at a red light and returns how many cross the stop line during `green`
 *  seconds. */
function clearedPerGreen(green: number): number {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 40; i++) {
    const v = sim.addVehicleOnEdges(path(60));
    // A queue does not move by definition; keep it from being retired as stalled.
    v.stallTime = -1e6;
    v.speedMultiplier = 1;
    cars.push(v);
  }
  const STOP_LINE = 10;
  const red = (_from: string, next: string) => next !== `${STOP_LINE},0`;
  // Let the queue settle completely first.
  for (let t = 0; t < 20 / 0.02; t++) sim.advanceEdgeVehicles(0.02, red);

  const before = cars.filter(v => v.edgeIndex >= STOP_LINE).length;
  for (let t = 0; t < green / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
  return cars.filter(v => v.edgeIndex >= STOP_LINE).length - before;
}

describe('路口的通行量', () => {
  it('should clear a queue worth of cars on a standard green', () => {
    // The bound is a literal: with the speed halved and the durations unchanged this measured 7.
    expect(clearedPerGreen(TRAFFIC_LIGHT.PHASE_DURATION), '一次綠燈放行的車太少')
      .toBeGreaterThanOrEqual(12);
  });

  it('should clear proportionally more on a large junction', () => {
    expect(clearedPerGreen(TRAFFIC_LIGHT.PHASE_DURATION_LARGE), '大路口的綠燈放行的車太少')
      .toBeGreaterThanOrEqual(25);
  });

  it('should not buy throughput with an unreasonable wait', () => {
    // Throughput can also be bought with a minute-long green, which leaves the cross direction
    // waiting long enough at 1x to read as a broken signal. A red lasts the opposing green plus
    // the all-red clearance.
    const worstWait = TRAFFIC_LIGHT.PHASE_DURATION_LARGE + TRAFFIC_LIGHT.CLEARANCE_DURATION;
    expect(worstWait, '紅燈長到會讓人以為號誌壞了').toBeLessThanOrEqual(20);
  });

  it('should give the large junction a longer phase than the standard one', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION_LARGE)
      .toBeGreaterThan(TRAFFIC_LIGHT.PHASE_DURATION);
  });
});
