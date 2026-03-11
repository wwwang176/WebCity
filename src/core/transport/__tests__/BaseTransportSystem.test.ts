import { describe, it, expect } from 'vitest';
import { BaseTransportSystem, TransportSystemConfig } from '../BaseTransportSystem';
import { TransportType } from '../types';

// Concrete test implementation (minimal, no overrides)
class TestTransportSystem extends BaseTransportSystem {
  constructor(config?: Partial<TransportSystemConfig>) {
    super({
      type: TransportType.BUS,
      speed: 2,
      capacity: 50,
      dwellTicks: 2,
      operatingCostPerVehicle: 100,
      affectedByCongestion: false,
      ...config,
    });
  }
}

describe('BaseTransportSystem', () => {
  describe('addStop / removeStop', () => {
    it('should add a stop with correct coordinates and type', () => {
      const sys = new TestTransportSystem();
      const stop = sys.addStop(5, 10);
      expect(stop.x).toBe(5);
      expect(stop.y).toBe(10);
      expect(stop.type).toBe(TransportType.BUS);
      expect(stop.passengers).toBe(0);
      expect(stop.id).toBe(1);
    });

    it('should assign unique IDs to stops', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(1, 1);
      expect(s1.id).not.toBe(s2.id);
    });

    it('should remove a stop and dissolve affected routes', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      sys.createRoute([s1, s2]);
      expect(sys.getRoutes().length).toBe(1);
      sys.removeStop(s1.id);
      expect(sys.getStops().length).toBe(1);
      expect(sys.getRoutes().length).toBe(0); // dissolved (< 2 stops)
      expect(sys.getVehicles().length).toBe(0);
    });
  });

  describe('createRoute / deleteRoute', () => {
    it('should create a route with vehicles', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      const route = sys.createRoute([s1, s2], 2);
      expect(route.stops.length).toBe(2);
      expect(route.vehicles).toBe(2);
      expect(sys.getVehicles().length).toBe(2);
      expect(route.operatingCost).toBe(200); // 2 × 100
    });

    it('should delete a route and its vehicles', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      const route = sys.createRoute([s1, s2]);
      sys.deleteRoute(route.id);
      expect(sys.getRoutes().length).toBe(0);
      expect(sys.getVehicles().length).toBe(0);
    });
  });

  describe('addVehicleToRoute / removeVehicleFromRoute', () => {
    it('should add a vehicle to a route', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      const route = sys.createRoute([s1, s2], 1);
      sys.addVehicleToRoute(route.id);
      expect(sys.getVehicles().length).toBe(2);
      expect(route.vehicles).toBe(2);
    });

    it('should not remove the last vehicle from a route', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      const route = sys.createRoute([s1, s2], 1);
      sys.removeVehicleFromRoute(route.id);
      expect(sys.getVehicles().length).toBe(1); // stays at 1
    });
  });

  describe('tick', () => {
    it('should move vehicle from initial state to first stop', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      sys.createRoute([s1, s2]);
      sys.tick();
      const v = sys.getVehicles()[0]!;
      expect(v.atStop).toBe(true);
      expect(v.position.x).toBe(0);
      expect(v.position.y).toBe(0);
    });

    it('should leave stop after dwell ticks', () => {
      const sys = new TestTransportSystem({ dwellTicks: 2 });
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      sys.createRoute([s1, s2]);
      sys.tick(); // initial arrival
      sys.tick(); // waitTicks = 2 → 1
      const v1 = sys.getVehicles()[0]!;
      expect(v1.atStop).toBe(true); // still waiting
      sys.tick(); // waitTicks = 1 → 0, departs
      const v2 = sys.getVehicles()[0]!;
      expect(v2.atStop).toBe(false);
      expect(v2.traveling).toBe(true);
    });

    it('should arrive at next stop after traveling', () => {
      const sys = new TestTransportSystem({ speed: 5, dwellTicks: 1 });
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      sys.createRoute([s1, s2]);
      sys.tick(); // initial → atStop
      sys.tick(); // dwell 1→0, depart to s2, travelTicks = ceil(5/5) = 1
      sys.tick(); // travel ticks 1→0, arrive at s2
      const v = sys.getVehicles()[0]!;
      expect(v.atStop).toBe(true);
      expect(v.position.x).toBe(5);
      expect(v.position.y).toBe(0);
    });

    it('should board passengers on arrival', () => {
      const sys = new TestTransportSystem({ capacity: 50 });
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      s2.passengers = 30;
      sys.createRoute([s1, s2]);
      sys.tick(); // initial → atStop at s1
      // Run enough ticks to reach s2
      for (let i = 0; i < 20; i++) sys.tick();
      const v = sys.getVehicles()[0]!;
      // At some point the vehicle should have boarded passengers
      // After a full cycle the vehicle visits s2
      expect(s2.passengers).toBeLessThan(30);
    });

    it('should handle congestion for affected systems', () => {
      const sys = new TestTransportSystem({
        speed: 2,
        affectedByCongestion: true,
        dwellTicks: 1,
      });
      sys.congestionLevel = 0.5; // 25% speed reduction
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(4, 0);
      sys.createRoute([s1, s2]);
      sys.tick(); // initial → atStop
      sys.tick(); // dwell → depart; speed = 2 * 0.75 = 1.5, dist = 4, travelTicks = ceil(4/1.5) = 3
      const v = sys.getVehicles()[0]!;
      expect(v.travelTicks).toBe(3);
    });
  });

  describe('getOperatingCost', () => {
    it('should sum all routes operating cost', () => {
      const sys = new TestTransportSystem({ operatingCostPerVehicle: 100 });
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 0);
      sys.createRoute([s1, s2], 2);
      sys.createRoute([s1, s2], 3);
      expect(sys.getOperatingCost()).toBe(500); // 200 + 300
    });
  });

  describe('toJSON / fromJSON', () => {
    it('should round-trip serialize correctly', () => {
      const sys = new TestTransportSystem();
      const s1 = sys.addStop(0, 0);
      const s2 = sys.addStop(5, 10);
      sys.createRoute([s1, s2], 2);
      sys.tick(); // move vehicles to initial position
      s2.passengers = 15; // set after tick to avoid boarding

      const json = sys.toJSON();
      const restored = TestTransportSystem.baseFromJSON(json, {
        type: TransportType.BUS,
        speed: 2,
        capacity: 50,
        dwellTicks: 2,
        operatingCostPerVehicle: 100,
        affectedByCongestion: false,
      }, TestTransportSystem);
      expect(restored.getStops().length).toBe(2);
      expect(restored.getRoutes().length).toBe(1);
      expect(restored.getVehicles().length).toBe(2);
      expect(restored.getStops()[1]!.passengers).toBe(15);
    });
  });
});
