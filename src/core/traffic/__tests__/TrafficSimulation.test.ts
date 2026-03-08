import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';

describe('TrafficSimulation', () => {
  it('should add a vehicle with path', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0']);
    expect(v.pathPos).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should advance vehicle position each tick', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0']);
    sim.tick();
    expect(v.pathPos).toBeGreaterThan(0);
  });

  it('should mark vehicle as arrived at destination', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0', '2,0']);
    sim.tick(); // at 1,0
    sim.tick(); // at 2,0 - arrived
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should track segment density', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0', '2,0']);
    expect(sim.getSegmentDensity('0,0')).toBe(1);
    sim.tick();
    expect(sim.getSegmentDensity('0,0')).toBe(0);
    expect(sim.getSegmentDensity('1,0')).toBe(1);
  });

  it('should remove arrived vehicles', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0']);
    sim.tick(); // arrived
    expect(sim.getVehicleCount()).toBe(0);
  });
});
