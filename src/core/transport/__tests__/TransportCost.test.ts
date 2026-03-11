import { describe, it, expect } from 'vitest';
import { getTotalTransportOperatingCost } from '../TransportRegistry';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { RailSystem } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';
import { AirportSystem } from '../AirportSystem';

describe('getTotalTransportOperatingCost', () => {
  it('returns 0 when no transport systems have routes', () => {
    const systems = {
      bus: new BusSystem(),
      metro: new MetroSystem(),
      rail: new RailSystem(),
      ferry: new FerrySystem(),
      airport: new AirportSystem(),
    };
    expect(getTotalTransportOperatingCost(systems)).toBe(0);
  });

  it('sums operating costs from systems that have routes', () => {
    const bus = new BusSystem();
    // Add 2 stops and create a route with a vehicle to generate operating cost
    bus.addStop(0, 0);
    bus.addStop(5, 5);
    bus.createRoute([1, 2]);

    const systems = {
      bus,
      metro: new MetroSystem(),
      rail: new RailSystem(),
      ferry: new FerrySystem(),
      airport: new AirportSystem(),
    };
    const cost = getTotalTransportOperatingCost(systems);
    expect(cost).toBe(bus.getOperatingCost());
    expect(cost).toBeGreaterThan(0);
  });

  it('matches manual sum of all getOperatingCost() calls', () => {
    const bus = new BusSystem();
    bus.addStop(0, 0);
    bus.addStop(5, 5);
    bus.createRoute([1, 2]);

    const metro = new MetroSystem();
    metro.addStop(10, 10);
    metro.addStop(15, 15);
    metro.createRoute([1, 2]);

    const rail = new RailSystem();
    const ferry = new FerrySystem();
    const airport = new AirportSystem();

    const systems = { bus, metro, rail, ferry, airport };

    const manualSum = bus.getOperatingCost()
      + metro.getOperatingCost()
      + rail.getOperatingCost()
      + ferry.getOperatingCost()
      + airport.getOperatingCost();

    expect(getTotalTransportOperatingCost(systems)).toBe(manualSum);
  });
});
