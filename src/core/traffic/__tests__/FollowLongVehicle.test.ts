import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * The car-following query stops looking once it finds a vehicle, but "a vehicle further ahead
 * always leaves a larger gap" only holds when every vehicle is the same length: a gap subtracts
 * half a body from **both** vehicles, and a bus is more than twice a car's length.
 *
 * `findGapAhead`'s unit tests cover that formula, but the "longest body" is passed in by the
 * caller. Passing the wrong value (0, say) makes the query stop early and a vehicle drives into
 * the back of a bus using a car's looser gap, with no unit test turning red.
 *
 * The threshold is therefore computed **each frame from the vehicles actually on the road**,
 * not from a constant baked out of the dimension table. A constant would be a premise nothing
 * can enforce: both `Vehicle.length` and `traffic.vehicles` are publicly mutable.
 */

function edge(id: string, fx: number, tx: number): LaneEdge {
  return {
    id,
    from: {
      id: `${id}_f`, cellKey: `${fx},0`, position: { x: fx, y: 0 },
      lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `${id}_t`, cellKey: `${tx},0`, position: { x: tx, y: 0 },
      lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight',
  };
}

/** Pins a vehicle's randomised fields. */
function pin<T extends { length: number; speedMultiplier: number; stallTime: number }>(
  v: T, length: number,
): T {
  v.length = length;
  v.speedMultiplier = 1;
  v.stallTime = 0;
  return v;
}

describe('前面那台是公車的時候', () => {
  it('should come to rest behind the bus, not behind the car in between', () => {
    const sim = new TrafficSimulation();
    const route = [edge('e1', 0, 1), edge('e2', 1, 2)];

    // Body type, speed variation and stall timing are all random; pinning them makes a failure
    // reproducible.
    const me = pin(sim.addVehicleOnEdges(route), 0.22);
    const car = pin(sim.addVehicleOnEdges(route), 0.22);   // 0.9 ahead, gap 0.68
    const bus = pin(sim.addBusVehicle([route], 1), 0.60);

    // A frame covers only centimetres, so the resting place shows only after it stops. The two
    // ahead are pinned back into place each frame, modelling a queue that never advances, so
    // where this vehicle stops depends solely on which one the query found.
    for (let f = 0; f < 200; f++) {
      car.edgeIndex = 0; car.edgeProgress = 0.9; car.currentSpeed = 0;
      bus.edgeIndex = 1; bus.edgeProgress = 0; bus.currentSpeed = 0;
      sim.advanceEdgeVehicles(1 / 60);
    }

    // The gap also reserves one MIN_GAP (0.15) of following distance:
    //   bus 1.0 - 0.11 - 0.30 - 0.15 = 0.44   <- the correct resting place
    //   car 0.9 - 0.11 - 0.11 - 0.15 = 0.53
    expect(me.edgeIndex, '這一幀就衝過了整條邊 —— 這個案例失去意義').toBe(0);
    expect(me.edgeProgress, '提前收工，照著小客車的空隙開進了公車尾巴')
      .toBeLessThan(0.48);
    expect(me.edgeProgress, '停得比公車留下的空隙還遠 —— 這個案例失去意義')
      .toBeGreaterThan(0.40);
  });

  it('should handle a vehicle longer than every dimension table', () => {
    // With the threshold baked out of the dimension table (longest 0.60, half-body 0.30), a
    // longer vehicle inserted from outside is skipped: the car's gap of 0.58 falls inside
    // 1.0 - 0.11 - 0.30 = 0.59, so the query stops early and returns 0.58, while the long
    // vehicle actually leaves only 1.0 - 0.11 - 0.50 = 0.39.
    const sim = new TrafficSimulation();
    const route = [edge('e1', 0, 1), edge('e2', 1, 2)];

    const me = pin(sim.addVehicleOnEdges(route), 0.22);
    const car = pin(sim.addVehicleOnEdges(route), 0.22);
    const longOne = pin(sim.addVehicleOnEdges(route), 1.0);   // longer than anything in the table

    for (let f = 0; f < 200; f++) {
      car.edgeIndex = 0; car.edgeProgress = 0.8; car.currentSpeed = 0;
      longOne.edgeIndex = 1; longOne.edgeProgress = 0; longOne.currentSpeed = 0;
      sim.advanceEdgeVehicles(1 / 60);
    }

    // Less one more MIN_GAP (0.15): long vehicle 0.39 - 0.15 = 0.24, car 0.58 - 0.15 = 0.43.
    expect(me.edgeIndex, '這一幀就衝過了整條邊 —— 這個案例失去意義').toBe(0);
    expect(me.edgeProgress, '照著小客車的空隙開進了那台長車')
      .toBeLessThan(0.34);
  });
});
