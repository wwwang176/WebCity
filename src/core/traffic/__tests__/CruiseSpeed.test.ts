import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../TrafficSimulation';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import type { LaneEdge } from '../LaneGraph';

/**
 * How fast vehicles travel.
 *
 * This group pins the **observable speed**, not "speed equals some constant": comparing a
 * constant against itself moves both sides when it changes and stays green forever (BUG-260).
 * The bounds are therefore literal numbers, with the relative ordering between road types
 * checked separately.
 *
 * Vehicles are decorative and their movement is decoupled from the simulation clock: a cell is
 * 12 metres and 3.5 cells per second works out to roughly 150 km/h against a posted 50. The
 * multiplier is deliberate — on the clock, one game day at 1x lasts 6 seconds and vehicles
 * would be too slow to read as moving.
 */

/** A road long enough to reach cruise, entirely on cells of one road type. */
function straightPath(n: number): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}`,
      from: {
        id: `e${i}_from`, cellKey: `${i},0`, position: { x: i, y: 0 },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}_to`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0,
      type: 'straight',
    });
  }
  return edges;
}

/** A vehicle's settled speed on this road type in cells per second, with its individual
 *  multiplier divided out. */
function cruiseSpeed(roadType: RoadType): number {
  const sim = new TrafficSimulation();
  const v = sim.addVehicleOnEdges(straightPath(400));
  v.stallTime = 0;
  const limit = ROAD_CONFIGS[roadType]!.speedLimit;
  // The path is long enough that lookahead braking does not intervene within these steps.
  for (let i = 0; i < 200; i++) sim.advanceEdgeVehicles(0.05, undefined, () => limit);
  return v.currentSpeed / v.speedMultiplier;
}

describe('車輛的巡航速度', () => {
  it('should cruise at half the old pace on an ordinary street', () => {
    // The bound is a **literal**: comparing against `TRAFFIC.EDGE_SPEED` would move with it if
    // it went back to 7 cells/s and the test would prove nothing.
    const speed = cruiseSpeed(RoadType.TWO_LANE);
    expect(speed, '一般道路的車跑得比預期快').toBeLessThanOrEqual(4);
    expect(speed, '一般道路的車幾乎不動了').toBeGreaterThan(2.5);
  });

  it('should keep the fastest road under a sane ceiling', () => {
    // The highway is the fastest road type and sets the top speed visible on screen.
    expect(cruiseSpeed(RoadType.HIGHWAY), '快速道路的車快到看不清').toBeLessThanOrEqual(8);
  });

  it('should leave the relative speed of each road type untouched', () => {
    // Slowing everything down must not be done by editing speed limits: a speed limit is also
    // the pathfinding cost weight, so changing it changes which routes traffic takes.
    const base = cruiseSpeed(RoadType.TWO_LANE);
    for (const roadType of [
      RoadType.RURAL, RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY,
    ]) {
      const want = ROAD_CONFIGS[roadType]!.speedLimit / ROAD_CONFIGS[RoadType.TWO_LANE]!.speedLimit;
      expect(cruiseSpeed(roadType) / base, `${roadType} 與一般道路的速度比不等於速限比`)
        .toBeCloseTo(want, 6);
    }
  });

  it('should still reach cruise speed quickly enough to clear a junction', () => {
    // Lowering the top speed without lowering acceleration makes vehicles snap to full speed;
    // cutting acceleration too far leaves a queue unable to crawl out of a junction on green.
    const top = TRAFFIC.EDGE_SPEED;
    const secondsToCruise = top / TRAFFIC.ACCEL;
    expect(secondsToCruise, '加速太慢，綠燈時車隊爬不出路口').toBeLessThan(1.5);
    expect(secondsToCruise, '加速快到像瞬移').toBeGreaterThan(0.2);
  });
});
