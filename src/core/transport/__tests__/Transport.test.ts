import { describe, it, expect } from 'vitest';
import {
  TransportType,
  TransportMode,
} from '../types';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { TramSystem } from '../TramSystem';
import { RailSystem, RailServiceType } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';
import { AirportSystem } from '../AirportSystem';
import { TaxiSystem } from '../TaxiSystem';
import { chooseMode, AvailableTransport } from '../ModeChoice';

// ---------------------------------------------------------------------------
// BusSystem
// ---------------------------------------------------------------------------
describe('BusSystem', () => {
  it('should create stops with unique ids', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 5);
    expect(s1.id).not.toBe(s2.id);
    expect(s1.type).toBe(TransportType.BUS);
    expect(s1.x).toBe(0);
    expect(s1.y).toBe(0);
    expect(bus.getStops()).toHaveLength(2);
  });

  it('should create a route with the given stops', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    const route = bus.createRoute([s1, s2]);
    expect(route.type).toBe(TransportType.BUS);
    expect(route.stops).toHaveLength(2);
    expect(route.vehicles).toBe(1);
    expect(route.operatingCost).toBeGreaterThan(0);
  });

  it('should create vehicles when a route is created', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2], 2);
    expect(bus.getVehicles()).toHaveLength(2);
  });

  it('should advance bus to stop and dwell for 2 ticks', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2]);

    // tick 1 -- bus arrives at stop 0, starts dwelling
    bus.tick();
    const v1 = bus.getVehicles()[0]!;
    expect(v1.atStop).toBe(true);
    expect(v1.waitTicks).toBe(2);
    expect(v1.position.x).toBe(0);

    // tick 2 -- still dwelling (waitTicks 1)
    bus.tick();
    const v2 = bus.getVehicles()[0]!;
    expect(v2.atStop).toBe(true);
    expect(v2.waitTicks).toBe(1);

    // tick 3 -- done dwelling, moves to next stop index
    bus.tick();
    const v3 = bus.getVehicles()[0]!;
    expect(v3.atStop).toBe(false);
    expect(v3.currentStopIndex).toBe(1);
  });

  it('should cycle back to first stop after reaching the last', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    bus.createRoute([s1, s2]);

    // Advance through s1 dwell (2 ticks) + departure (1 tick to arrive at s2)
    bus.tick(); // arrive s1, waitTicks=2
    bus.tick(); // dwell, waitTicks=1
    bus.tick(); // depart s1, currentStopIndex=1
    bus.tick(); // arrive s2, waitTicks=2
    bus.tick(); // dwell, waitTicks=1
    bus.tick(); // depart s2, currentStopIndex=0 (wrapped)

    const v = bus.getVehicles()[0]!;
    expect(v.currentStopIndex).toBe(0);
  });

  it('should calculate total operating cost', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2], 2);
    bus.createRoute([s1, s2], 1);
    // 2 * 100 + 1 * 100 = 300
    expect(bus.getOperatingCost()).toBe(300);
  });

  it('should be affected by congestion (bus still moves at high congestion but slower)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2]);
    bus.congestionLevel = 0.8;

    // Even with congestion the bus should still arrive (speedMultiplier > 0)
    bus.tick();
    const v = bus.getVehicles()[0]!;
    expect(v.atStop).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MetroSystem
// ---------------------------------------------------------------------------
describe('MetroSystem', () => {
  it('should create stations with unique ids', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(5, 5);
    expect(st1.id).not.toBe(st2.id);
    expect(st1.type).toBe(TransportType.METRO);
    expect(metro.getStations()).toHaveLength(2);
  });

  it('should create a line with stations', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    const line = metro.createLine([st1, st2]);
    expect(line.type).toBe(TransportType.METRO);
    expect(line.stops).toHaveLength(2);
    expect(metro.getLines()).toHaveLength(1);
  });

  it('should advance trains and NOT be affected by road traffic', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2]);

    // tick -- train arrives at station 0
    metro.tick();
    const train = metro.getTrains()[0]!;
    expect(train.atStop).toBe(true);
    // Metro has no congestionLevel property -- it is inherently unaffected
    expect(train.position.x).toBe(0);
  });

  it('should have capacity of 200 per train', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2]);
    const train = metro.getTrains()[0]!;
    expect(train.capacity).toBe(200);
  });

  it('should have higher build cost than bus', () => {
    const metro = new MetroSystem();
    // 2 stations
    expect(metro.getBuildCost(2)).toBe(10000);
  });

  it('should calculate operating cost', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2], 2);
    // 2 trains * 300 = 600
    expect(metro.getOperatingCost()).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// TramSystem
// ---------------------------------------------------------------------------
describe('TramSystem', () => {
  it('should create stops on fixed tracks', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    tram.addStop(5, 0);
    expect(s1.type).toBe(TransportType.TRAM);
    expect(tram.getStops()).toHaveLength(2);
  });

  it('should create a route', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    const s2 = tram.addStop(5, 0);
    const route = tram.createRoute([s1, s2]);
    expect(route.type).toBe(TransportType.TRAM);
    expect(route.stops).toHaveLength(2);
  });

  it('should occupy road space', () => {
    const tram = new TramSystem();
    expect(tram.occupiesRoadSpace).toBe(true);
  });

  it('should advance trams along routes via tick', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    const s2 = tram.addStop(5, 0);
    tram.createRoute([s1, s2]);

    tram.tick();
    const v = tram.getVehicles()[0]!;
    expect(v.atStop).toBe(true);
    expect(v.position.x).toBe(0);
    expect(v.position.y).toBe(0);
  });

  it('should have capacity of 80', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    const s2 = tram.addStop(5, 0);
    tram.createRoute([s1, s2]);
    expect(tram.getVehicles()[0]!.capacity).toBe(80);
  });

  it('should calculate operating cost', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    const s2 = tram.addStop(5, 0);
    tram.createRoute([s1, s2], 2);
    // 2 * 150 = 300
    expect(tram.getOperatingCost()).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// RailSystem
// ---------------------------------------------------------------------------
describe('RailSystem', () => {
  it('should build stations', () => {
    const rail = new RailSystem();
    const st = rail.buildStation(0, 0);
    expect(st.type).toBe(TransportType.RAIL);
    expect(rail.getStations()).toHaveLength(1);
  });

  it('should create passenger lines', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    const line = rail.createLine([st1, st2], RailServiceType.PASSENGER);
    expect(rail.getLineServiceType(line.id)).toBe(RailServiceType.PASSENGER);
    expect(rail.getTrains()[0]!.capacity).toBe(300);
  });

  it('should create freight lines', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    const line = rail.createLine([st1, st2], RailServiceType.FREIGHT);
    expect(rail.getLineServiceType(line.id)).toBe(RailServiceType.FREIGHT);
    expect(rail.getTrains()[0]!.capacity).toBe(500);
  });

  it('should advance trains via tick', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    rail.createLine([st1, st2]);

    rail.tick();
    const train = rail.getTrains()[0]!;
    expect(train.atStop).toBe(true);
  });

  it('should support external connections', () => {
    const rail = new RailSystem();
    rail.hasExternalConnection = true;
    rail.externalConnection = { populationIn: 10, goodsIn: 50, goodsOut: 30 };
    expect(rail.externalConnection.populationIn).toBe(10);
    expect(rail.externalConnection.goodsIn).toBe(50);
    expect(rail.externalConnection.goodsOut).toBe(30);
  });

  it('should calculate operating cost', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    rail.createLine([st1, st2], RailServiceType.PASSENGER, 2);
    // 2 * 400 = 800
    expect(rail.getOperatingCost()).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// FerrySystem
// ---------------------------------------------------------------------------
describe('FerrySystem', () => {
  it('should add docks on water', () => {
    const ferry = new FerrySystem();
    const waterChecker = { isWater: () => true };
    const dock = ferry.addDock(0, 0, waterChecker);
    expect(dock).not.toBeNull();
    expect(dock!.type).toBe(TransportType.FERRY);
    expect(ferry.getDocks()).toHaveLength(1);
  });

  it('should reject docks NOT on water', () => {
    const ferry = new FerrySystem();
    const landChecker = { isWater: () => false };
    const dock = ferry.addDock(5, 5, landChecker);
    expect(dock).toBeNull();
    expect(ferry.getDocks()).toHaveLength(0);
  });

  it('should allow docks without water checker (no validation)', () => {
    const ferry = new FerrySystem();
    const dock = ferry.addDock(5, 5);
    expect(dock).not.toBeNull();
  });

  it('should create a route between docks', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 10)!;
    const route = ferry.createRoute([d1, d2]);
    expect(route.type).toBe(TransportType.FERRY);
    expect(route.stops).toHaveLength(2);
  });

  it('should advance vessels via tick', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 10)!;
    ferry.createRoute([d1, d2]);

    ferry.tick();
    const vessel = ferry.getVessels()[0]!;
    expect(vessel.atStop).toBe(true);
    expect(vessel.position.x).toBe(0);
  });

  it('should calculate operating cost', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 10)!;
    ferry.createRoute([d1, d2], 2);
    // 2 * 200 = 400
    expect(ferry.getOperatingCost()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AirportSystem
// ---------------------------------------------------------------------------
describe('AirportSystem', () => {
  it('should require population milestone to build', () => {
    const airports = new AirportSystem();
    const result = airports.build(10, 10, 'SMALL', 5000);
    expect(result).toBeNull();
    expect(airports.getAirports()).toHaveLength(0);
  });

  it('should build when population requirement is met', () => {
    const airports = new AirportSystem();
    const airport = airports.build(10, 10, 'MEDIUM', 15000);
    expect(airport).not.toBeNull();
    expect(airport!.size).toBe('MEDIUM');
    expect(airports.getAirports()).toHaveLength(1);
  });

  it('should report population required as 10000', () => {
    const airports = new AirportSystem();
    expect(airports.getPopulationRequired()).toBe(10000);
  });

  it('should generate noise pollution', () => {
    const airports = new AirportSystem();
    const airport = airports.build(10, 10, 'LARGE', 50000)!;
    expect(airports.getNoisePollution(airport.id)).toBe(50);
    expect(airport.noisePollution).toBeGreaterThan(0);
  });

  it('should bring tourists and cargo', () => {
    const airports = new AirportSystem();
    const airport = airports.build(10, 10, 'LARGE', 50000)!;
    expect(airport.touristsPerTick).toBeGreaterThan(0);
    expect(airport.cargoPerTick).toBeGreaterThan(0);
  });

  it('should require larger area for bigger airports', () => {
    const airports = new AirportSystem();
    const small = airports.build(0, 0, 'SMALL', 10000)!;
    const large = airports.build(20, 20, 'LARGE', 10000)!;
    expect(large.area).toBeGreaterThan(small.area);
  });

  it('should calculate operating cost', () => {
    const airports = new AirportSystem();
    airports.build(0, 0, 'SMALL', 10000);
    airports.build(20, 20, 'LARGE', 10000);
    // 500 + 4000 = 4500
    expect(airports.getOperatingCost()).toBe(4500);
  });
});

// ---------------------------------------------------------------------------
// TaxiSystem
// ---------------------------------------------------------------------------
describe('TaxiSystem', () => {
  it('should add stands with taxis', () => {
    const taxi = new TaxiSystem();
    const stand = taxi.addStand(5, 5, 3);
    expect(stand.type).toBe(TransportType.TAXI);
    expect(taxi.getStands()).toHaveLength(1);
    expect(taxi.getVehicles()).toHaveLength(3);
  });

  it('should dispatch a taxi trip', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 2);
    const trip = taxi.dispatch({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(trip).not.toBeNull();
    expect(trip!.from).toEqual({ x: 0, y: 0 });
    expect(trip!.to).toEqual({ x: 10, y: 5 });
    expect(trip!.completed).toBe(false);
    expect(trip!.ticks).toBe(15); // Manhattan distance 10+5
  });

  it('should return null if no taxis available', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 1);
    taxi.dispatch({ x: 0, y: 0 }, { x: 10, y: 0 }); // uses the only taxi
    const second = taxi.dispatch({ x: 0, y: 0 }, { x: 5, y: 0 });
    expect(second).toBeNull();
  });

  it('should complete trip after ticks elapse', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 1);
    const trip = taxi.dispatch({ x: 0, y: 0 }, { x: 3, y: 0 })!;
    expect(trip.ticks).toBe(3);

    taxi.tick(); // ticks = 2
    expect(trip.completed).toBe(false);
    taxi.tick(); // ticks = 1
    expect(trip.completed).toBe(false);
    taxi.tick(); // ticks = 0, completed
    expect(trip.completed).toBe(true);
  });

  it('should free taxi after trip completion', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 1);
    taxi.dispatch({ x: 0, y: 0 }, { x: 2, y: 0 });

    taxi.tick(); // ticks = 1
    taxi.tick(); // ticks = 0, completed

    // Taxi should be available again
    const second = taxi.dispatch({ x: 2, y: 0 }, { x: 5, y: 0 });
    expect(second).not.toBeNull();
  });

  it('should calculate operating cost based on stands', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0);
    taxi.addStand(10, 10);
    // 2 * 50 = 100
    expect(taxi.getOperatingCost()).toBe(100);
  });

  it('should track active trips', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 3);
    taxi.dispatch({ x: 0, y: 0 }, { x: 1, y: 0 });
    taxi.dispatch({ x: 0, y: 0 }, { x: 2, y: 0 });
    expect(taxi.getActiveTrips()).toHaveLength(2);

    taxi.tick(); // first trip completes (1 tick)
    expect(taxi.getActiveTrips()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ModeChoice
// ---------------------------------------------------------------------------
describe('ModeChoice', () => {
  it('should walk for short distances (distance <= 3)', () => {
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      [],
      0,
    );
    expect(mode).toBe(TransportMode.WALK);
  });

  it('should walk at exactly distance 3', () => {
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      [],
      0,
    );
    expect(mode).toBe(TransportMode.WALK);
  });

  it('should drive if no transit available', () => {
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      [],
      0,
    );
    expect(mode).toBe(TransportMode.DRIVE);
  });

  it('should choose transit if faster than 1.5x drive time', () => {
    // distance = 10, driveTime = 10 * (1 + 0) = 10
    // transit time = 8, threshold = 10 * 1.5 = 15, 8 < 15 => transit
    const available: AvailableTransport[] = [
      { type: TransportType.METRO, estimatedTime: 8 },
    ];
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      available,
      0,
    );
    expect(mode).toBe(TransportMode.METRO);
  });

  it('should drive when transit is too slow', () => {
    // distance = 10, driveTime = 10 * (1 + 0) = 10
    // transit time = 20, threshold = 10 * 1.5 = 15, 20 >= 15 => drive
    const available: AvailableTransport[] = [
      { type: TransportType.BUS, estimatedTime: 20 },
    ];
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      available,
      0,
    );
    expect(mode).toBe(TransportMode.DRIVE);
  });

  it('should factor in congestion when comparing drive vs transit', () => {
    // distance = 10, congestion = 0.8
    // driveTime = 10 * (1 + 0.8) = 18
    // transit time = 12, threshold = 18 * 1.5 = 27, 12 < 27 => transit
    const available: AvailableTransport[] = [
      { type: TransportType.BUS, estimatedTime: 12 },
    ];
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      available,
      0.8,
    );
    expect(mode).toBe(TransportMode.BUS);
  });

  it('should choose the best transit option among multiple', () => {
    const available: AvailableTransport[] = [
      { type: TransportType.BUS, estimatedTime: 12 },
      { type: TransportType.METRO, estimatedTime: 6 },
      { type: TransportType.TRAM, estimatedTime: 10 },
    ];
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      available,
      0,
    );
    expect(mode).toBe(TransportMode.METRO);
  });

  it('should prefer walking over transit for short distance', () => {
    const available: AvailableTransport[] = [
      { type: TransportType.BUS, estimatedTime: 1 },
    ];
    const mode = chooseMode(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      available,
      0,
    );
    expect(mode).toBe(TransportMode.WALK);
  });
});
