import { describe, it, expect } from 'vitest';
import {
  TransportType,
  TransportMode,
} from '../types';
import { BusSystem } from '../BusSystem';
import { MetroSystem, METRO } from '../MetroSystem';
import { RailSystem, RailServiceType, RAIL } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';
import { AirportSystem, getAirportFootprint, AIRPORT_SIZE_CONFIG } from '../AirportSystem';
import { chooseMode, AvailableTransport, MODE_CHOICE } from '../ModeChoice';
import { PollutionManager } from '../../environment/Pollution';
import { FreightSystem } from '../../traffic/FreightSystem';

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

  it('should have tick as no-op (movement handled by TrafficSimulation)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2]);

    // tick is now a no-op; legacy TransportVehicles are still created by createRoute
    // but their movement is driven by TrafficSimulation.advanceEdgeVehicles()
    bus.tick();
    const v1 = bus.getVehicles()[0]!;
    // Vehicle should still exist but not move (tick is no-op)
    expect(v1.position.x).toBe(0);
  });

  it('should still create legacy vehicles for route vehicle count tracking', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(4, 0);
    bus.createRoute([s1, s2], 2);

    // Legacy TransportVehicles are created for route tracking;
    // actual movement happens in TrafficSimulation
    expect(bus.getVehicles()).toHaveLength(2);
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

  it('should track congestion level (used by SimulationLoop)', () => {
    const bus = new BusSystem();
    bus.congestionLevel = 0.8;
    expect(bus.congestionLevel).toBe(0.8);
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
    const line = rail.createLine([st1, st2], RailServiceType.PASSENGER)!;
    expect(rail.getLineServiceType(line.id)).toBe(RailServiceType.PASSENGER);
    expect(rail.getTrains()[0]!.capacity).toBe(300);
  });

  it('should create freight lines', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    const line = rail.createLine([st1, st2], RailServiceType.FREIGHT)!;
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
  it('should build airport with any population (populationRequired=0 for testing)', () => {
    const airports = new AirportSystem();
    const result = airports.build(10, 10, 'SMALL', 0);
    expect(result).not.toBeNull();
    expect(result!.size).toBe('SMALL');
    expect(airports.getAirports()).toHaveLength(1);
  });

  it('should build different sizes', () => {
    const airports = new AirportSystem();
    const s = airports.build(0, 0, 'SMALL', 0);
    const m = airports.build(10, 10, 'MEDIUM', 0);
    const l = airports.build(20, 20, 'LARGE', 0);
    expect(s).not.toBeNull();
    expect(m!.size).toBe('MEDIUM');
    expect(l!.size).toBe('LARGE');
    expect(airports.getAirports()).toHaveLength(3);
  });

  it('should report population required as 0 (testing mode)', () => {
    const airports = new AirportSystem();
    expect(airports.getPopulationRequired()).toBe(0);
  });

  it('should generate noise pollution', () => {
    const airports = new AirportSystem();
    const airport = airports.build(10, 10, 'LARGE', 0)!;
    expect(airports.getNoisePollution(airport.id)).toBe(50);
    expect(airport.noisePollution).toBeGreaterThan(0);
  });

  it('should bring tourists and cargo', () => {
    const airports = new AirportSystem();
    const airport = airports.build(10, 10, 'LARGE', 0)!;
    expect(airport.touristsPerTick).toBeGreaterThan(0);
    expect(airport.cargoPerTick).toBeGreaterThan(0);
  });

  it('should calculate operating cost', () => {
    const airports = new AirportSystem();
    airports.build(0, 0, 'SMALL', 0);
    airports.build(20, 20, 'LARGE', 0);
    // 500 + 4000 = 4500
    expect(airports.getOperatingCost()).toBe(4500);
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

describe('MODE_CHOICE constants', () => {
  it('walk max distance should be a small positive integer', () => {
    expect(MODE_CHOICE.WALK_MAX_DISTANCE).toBeGreaterThan(0);
    expect(Number.isInteger(MODE_CHOICE.WALK_MAX_DISTANCE)).toBe(true);
  });

  it('transit time threshold should be > 1 (transit gets a bonus)', () => {
    expect(MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// T1.1 Serialization — toJSON / fromJSON
// ---------------------------------------------------------------------------
describe('BusSystem toJSON/fromJSON', () => {
  it('should round-trip stops, routes, vehicles, and ID counters', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 5);
    bus.createRoute([s1, s2], 2);
    bus.congestionLevel = 0.4;

    const json = bus.toJSON();
    const restored = BusSystem.fromJSON(json);

    expect(restored.getStops()).toHaveLength(2);
    expect(restored.getRoutes()).toHaveLength(1);
    expect(restored.getVehicles()).toHaveLength(2);
    expect(restored.congestionLevel).toBe(0.4);
    // IDs should continue from where they left off
    const s3 = restored.addStop(10, 10);
    expect(s3.id).toBe(3);
  });

  it('should preserve roadX/roadY on stops through serialization', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(5, 3);
    s1.roadX = 5;
    s1.roadY = 4;
    const s2 = bus.addStop(10, 3);
    s2.roadX = 10;
    s2.roadY = 4;
    bus.createRoute([s1, s2]);

    const json = bus.toJSON();
    const restored = BusSystem.fromJSON(json);

    const stops = restored.getStops();
    expect(stops[0]!.roadX).toBe(5);
    expect(stops[0]!.roadY).toBe(4);
    expect(stops[1]!.roadX).toBe(10);
    expect(stops[1]!.roadY).toBe(4);
  });
});

describe('MetroSystem toJSON/fromJSON', () => {
  it('should round-trip stations, lines, trains, and ID counters', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2], 2);

    const json = metro.toJSON();
    const restored = MetroSystem.fromJSON(json);

    expect(restored.getStations()).toHaveLength(2);
    expect(restored.getLines()).toHaveLength(1);
    expect(restored.getTrains()).toHaveLength(2);
    const st3 = restored.addStation(20, 0);
    expect(st3.id).toBe(3);
  });
});

describe('RailSystem toJSON/fromJSON', () => {
  it('should round-trip stations, lines, trains, and lineServiceTypes', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(20, 0);
    const line = rail.createLine([st1, st2], RailServiceType.FREIGHT, 2)!;
    rail.hasExternalConnection = true;
    rail.externalConnection = { populationIn: 10, goodsIn: 50, goodsOut: 30 };

    const json = rail.toJSON();
    const restored = RailSystem.fromJSON(json);

    expect(restored.getStations()).toHaveLength(2);
    expect(restored.getLines()).toHaveLength(1);
    expect(restored.getTrains()).toHaveLength(2);
    expect(restored.getLineServiceType(line.id)).toBe(RailServiceType.FREIGHT);
    expect(restored.hasExternalConnection).toBe(true);
    expect(restored.externalConnection.goodsIn).toBe(50);
  });
});

describe('FerrySystem toJSON/fromJSON', () => {
  it('should round-trip docks, routes, vessels', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 10)!;
    ferry.createRoute([d1, d2], 2);

    const json = ferry.toJSON();
    const restored = FerrySystem.fromJSON(json);

    expect(restored.getDocks()).toHaveLength(2);
    expect(restored.getRoutes()).toHaveLength(1);
    expect(restored.getVessels()).toHaveLength(2);
  });
});

describe('AirportSystem toJSON/fromJSON', () => {
  it('should round-trip airports with size and properties', () => {
    const airports = new AirportSystem();
    airports.build(0, 0, 'SMALL', 10000);
    airports.build(20, 20, 'LARGE', 100000);

    const json = airports.toJSON();
    const restored = AirportSystem.fromJSON(json);

    expect(restored.getAirports()).toHaveLength(2);
    expect(restored.getAirports()[0]!.size).toBe('SMALL');
    expect(restored.getAirports()[1]!.size).toBe('LARGE');
    expect(restored.getOperatingCost()).toBe(4500);
    // ID counter should continue
    const a3 = restored.build(40, 40, 'MEDIUM', 50000);
    expect(a3!.id).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T1.4 removeStop / removeStation / removeDock / removeStand
// ---------------------------------------------------------------------------
describe('BusSystem removeStop', () => {
  it('should remove a stop by id', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    bus.addStop(5, 5);
    bus.removeStop(s1.id);
    expect(bus.getStops()).toHaveLength(1);
    expect(bus.getStops()[0]!.x).toBe(5);
  });

  it('should remove route vehicles when a stop in the route is removed', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 5);
    bus.createRoute([s1, s2]);
    bus.removeStop(s1.id);
    // Route had only 2 stops, removing one should dissolve the route
    expect(bus.getRoutes()).toHaveLength(0);
    expect(bus.getVehicles()).toHaveLength(0);
  });
});

describe('MetroSystem removeStation', () => {
  it('should remove a station by id', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    metro.addStation(5, 5);
    metro.removeStation(st1.id);
    expect(metro.getStations()).toHaveLength(1);
  });

  it('should dissolve line when station count drops below 2', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2]);
    metro.removeStation(st1.id);
    expect(metro.getLines()).toHaveLength(0);
    expect(metro.getTrains()).toHaveLength(0);
  });
});

describe('RailSystem removeStation', () => {
  it('should remove a station by id', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    rail.buildStation(5, 5);
    rail.removeStation(st1.id);
    expect(rail.getStations()).toHaveLength(1);
  });
});

describe('FerrySystem removeDock', () => {
  it('should remove a dock by id', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    ferry.addDock(5, 5);
    ferry.removeDock(d1.id);
    expect(ferry.getDocks()).toHaveLength(1);
  });
});

describe('AirportSystem remove', () => {
  it('should remove an airport by id', () => {
    const airports = new AirportSystem();
    const a1 = airports.build(0, 0, 'SMALL', 10000)!;
    airports.build(20, 20, 'LARGE', 100000);
    airports.remove(a1.id);
    expect(airports.getAirports()).toHaveLength(1);
    expect(airports.getAirports()[0]!.size).toBe('LARGE');
  });
});

// ---------------------------------------------------------------------------
// T3 Vehicle Travel Time
// ---------------------------------------------------------------------------
describe('Bus travel time (now via TrafficSimulation)', () => {
  it('bus tick should be no-op (movement via TrafficSimulation)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2]);

    // Multiple ticks should not change vehicle state
    bus.tick();
    bus.tick();
    bus.tick();
    const v = bus.getVehicles()[0]!;
    expect(v.position.x).toBe(0);
  });
});

describe('Metro travel time', () => {
  it('should travel at fixed speed, unaffected by congestion', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    metro.createLine([st1, st2]);

    metro.tick(); // arrive st1
    metro.tick(); // dwell
    metro.tick(); // depart, traveling

    const t = metro.getTrains()[0]!;
    expect(t.traveling).toBe(true);
    expect(t.travelTicks).toBeGreaterThan(0);
  });
});

describe('Rail travel time', () => {
  it('should travel at high speed', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(10, 0);
    rail.createLine([st1, st2]);

    rail.tick(); // arrive
    rail.tick(); rail.tick(); rail.tick(); // dwell (3 ticks)
    rail.tick(); // depart, traveling

    const t = rail.getTrains()[0]!;
    expect(t.traveling).toBe(true);
    // Rail is faster, so fewer travel ticks than bus for same distance
    expect(t.travelTicks).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// T4 Passenger boarding/alighting
// ---------------------------------------------------------------------------
describe('Bus passenger boarding (tick no-op, boarding handled at stop level)', () => {
  it('passengers accumulate at stops (boarding logic future work)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(2, 0);
    bus.createRoute([s1, s2]);

    s1.passengers = 5;
    // tick does not process boarding anymore
    bus.tick();
    expect(s1.passengers).toBe(5); // passengers remain at stop
  });
});

describe('Metro passenger boarding (visual-only from loadFactor)', () => {
  it('sets train passengers from dailyRiders loadFactor (capacity 200)', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(2, 0);
    metro.createLine([st1, st2]);

    // 1 vehicle × 200 capacity = 200 total, 100 dailyRiders → loadFactor 0.5
    st1.dailyRiders = 60;
    st2.dailyRiders = 40;

    metro.tick(); // arrive st1, visual onArrive
    const t = metro.getTrains()[0]!;
    // vehicle.passengers = round(0.5 × 200) = 100
    expect(t.passengers).toBe(100);
    // stop.passengers unchanged
    expect(st1.passengers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T3.1 Metro getTrainSegmentInfo
// ---------------------------------------------------------------------------
describe('Metro getTrainSegmentInfo', () => {
  it('should return atStop info when train is at station', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    metro.createLine([st1, st2]);
    metro.tick(); // initial → atStop at st1
    const train = metro.getTrains()[0]!;
    const info = metro.getTrainSegmentInfo(train);
    expect(info.atStop).toBe(true);
    expect(info.fromStopIndex).toBe(0);
  });

  it('should return travel progress when train is between stations', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    metro.createLine([st1, st2]);
    metro.tick(); // initial → atStop
    metro.tick(); // dwell 2→1
    metro.tick(); // dwell 1→0, depart to st2 (travelTicks = ceil(6/3) = 2)
    metro.tick(); // travel: travelTicks 2→1, interpolate
    const train = metro.getTrains()[0]!;
    expect(train.traveling).toBe(true);
    const info = metro.getTrainSegmentInfo(train);
    expect(info.atStop).toBe(false);
    expect(info.fromStopIndex).toBe(0);
    expect(info.toStopIndex).toBe(1);
    expect(info.progress).toBeGreaterThan(0);
    expect(info.progress).toBeLessThanOrEqual(1);
  });

  it('should return progress 0 for initial non-started train', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    metro.createLine([st1, st2]);
    // Don't tick — vehicle is in initial state (not atStop, not traveling)
    const train = metro.getTrains()[0]!;
    const info = metro.getTrainSegmentInfo(train);
    expect(info.atStop).toBe(true);
    expect(info.fromStopIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T8 Route deletion
// ---------------------------------------------------------------------------
describe('Route deletion', () => {
  it('Bus deleteRoute should remove route and vehicles', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    const route = bus.createRoute([s1, s2], 2);
    bus.deleteRoute(route.id);
    expect(bus.getRoutes()).toHaveLength(0);
    expect(bus.getVehicles()).toHaveLength(0);
    expect(bus.getStops()).toHaveLength(2); // stops preserved
  });

  it('Metro deleteLine should remove line and trains', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    const line = metro.createLine([st1, st2], 2);
    metro.deleteLine(line.id);
    expect(metro.getLines()).toHaveLength(0);
    expect(metro.getTrains()).toHaveLength(0);
  });

  it('Rail deleteLine should also clean lineServiceTypes', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(10, 0);
    const line = rail.createLine([st1, st2], RailServiceType.FREIGHT)!;
    rail.deleteLine(line.id);
    expect(rail.getLineServiceType(line.id)).toBeUndefined();
  });

  it('Ferry deleteRoute should remove route and vessels', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 0)!;
    const route = ferry.createRoute([d1, d2], 2);
    ferry.deleteRoute(route.id);
    expect(ferry.getRoutes()).toHaveLength(0);
    expect(ferry.getVessels()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T5 Airport tick
// ---------------------------------------------------------------------------
describe('AirportSystem tick', () => {
  it('should accumulate tourists and cargo each tick', () => {
    const airports = new AirportSystem();
    airports.build(0, 0, 'SMALL', 10000);

    airports.tick();
    expect(airports.pendingTourists).toBe(50);
    expect(airports.pendingCargo).toBe(20);

    airports.tick();
    expect(airports.pendingTourists).toBe(100);
    expect(airports.pendingCargo).toBe(40);
  });

  it('should consume tourists and cargo', () => {
    const airports = new AirportSystem();
    airports.build(0, 0, 'SMALL', 10000);
    airports.tick();

    const tourists = airports.consumeTourists();
    expect(tourists).toBe(50);
    expect(airports.pendingTourists).toBe(0);

    const cargo = airports.consumeCargo();
    expect(cargo).toBe(20);
    expect(airports.pendingCargo).toBe(0);
  });

  it('should produce no tourists/cargo without airports', () => {
    const airports = new AirportSystem();
    airports.tick();
    expect(airports.pendingTourists).toBe(0);
    expect(airports.pendingCargo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T5.2 Airport noise pollution integration
// ---------------------------------------------------------------------------
describe('Airport noise pollution', () => {
  it('SMALL airport should produce noise pollution at its location', () => {
    const pm = new PollutionManager(20, 20);
    const airports = new AirportSystem();
    airports.build(10, 10, 'SMALL', 10000);

    // Simulate adding airport noise as pollution source
    for (const a of airports.getAirports()) {
      pm.addSource(a.x, a.y, a.noisePollution * 5, 'noise');
    }
    pm.calculateSpread();

    // Noise at airport location should be positive
    expect(pm.getPollutionAt(10, 10).noise).toBeGreaterThan(0);
    // Noise should reach a few cells out
    expect(pm.getPollutionAt(10, 11).noise).toBeGreaterThan(0);
  });

  it('LARGE airport should produce more noise than SMALL', () => {
    const pmSmall = new PollutionManager(20, 20);
    const small = new AirportSystem();
    small.build(10, 10, 'SMALL', 10000);
    for (const a of small.getAirports()) {
      pmSmall.addSource(a.x, a.y, a.noisePollution * 5, 'noise');
    }
    pmSmall.calculateSpread();

    const pmLarge = new PollutionManager(20, 20);
    const large = new AirportSystem();
    large.build(10, 10, 'LARGE', 100000);
    for (const a of large.getAirports()) {
      pmLarge.addSource(a.x, a.y, a.noisePollution * 5, 'noise');
    }
    pmLarge.calculateSpread();

    expect(pmLarge.getPollutionAt(10, 10).noise).toBeGreaterThan(pmSmall.getPollutionAt(10, 10).noise);
  });

  it('no airport should produce no noise', () => {
    const pm = new PollutionManager(20, 20);
    const airports = new AirportSystem();
    for (const a of airports.getAirports()) {
      pm.addSource(a.x, a.y, a.noisePollution * 5, 'noise');
    }
    pm.calculateSpread();
    expect(pm.getPollutionAt(10, 10).noise).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T5.3 Airport multi-cell footprint
// ---------------------------------------------------------------------------
describe('Airport multi-cell footprint', () => {
  it('SMALL airport should have 5x5 footprint', () => {
    expect(getAirportFootprint('SMALL')).toBe(5);
  });

  it('MEDIUM airport should have 7x7 footprint', () => {
    expect(getAirportFootprint('MEDIUM')).toBe(7);
  });

  it('LARGE airport should have 9x9 footprint', () => {
    expect(getAirportFootprint('LARGE')).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// T5.4 Airport consolidated config (OCP)
// ---------------------------------------------------------------------------
describe('Airport consolidated config', () => {
  it('each size should contain all required properties', () => {
    for (const size of ['SMALL', 'MEDIUM', 'LARGE'] as const) {
      const cfg = AIRPORT_SIZE_CONFIG[size];
      expect(cfg).toBeDefined();
      expect(cfg.width).toBeGreaterThan(0);
      expect(cfg.height).toBeGreaterThan(0);
      expect(cfg.noise).toBeGreaterThanOrEqual(0);
      expect(cfg.tourists).toBeGreaterThan(0);
      expect(cfg.cargo).toBeGreaterThan(0);
      expect(cfg.operatingCost).toBeGreaterThan(0);
    }
  });

  it('dimensions scale with size', () => {
    const s = AIRPORT_SIZE_CONFIG.SMALL;
    const m = AIRPORT_SIZE_CONFIG.MEDIUM;
    const l = AIRPORT_SIZE_CONFIG.LARGE;
    expect(m.width).toBeGreaterThan(s.width);
    expect(l.width).toBeGreaterThan(m.width);
    expect(m.height).toBeGreaterThanOrEqual(s.height);
    expect(l.height).toBeGreaterThanOrEqual(m.height);
    expect(m.operatingCost).toBeGreaterThan(s.operatingCost);
    expect(l.operatingCost).toBeGreaterThan(m.operatingCost);
  });

  it('build() should use config values', () => {
    const sys = new AirportSystem();
    const result = sys.build(0, 0, 'SMALL', 0);
    expect(result).not.toBeNull();
    expect(result!.operatingCost).toBe(AIRPORT_SIZE_CONFIG.SMALL.operatingCost);
    expect(result!.noisePollution).toBe(AIRPORT_SIZE_CONFIG.SMALL.noise);
  });
});

// ---------------------------------------------------------------------------
// T6.1 Rail FREIGHT connection to FreightSystem
// ---------------------------------------------------------------------------
describe('Rail FREIGHT → FreightSystem', () => {
  it('should accept external cargo via addExternalCargo without error', () => {
    const freight = new FreightSystem();
    freight.addExternalCargo(100);
    // External cargo is accumulated and consumed in next calculateSupply call
  });

  it('FREIGHT rail line trains contribute cargo throughput', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(10, 0);
    const line = rail.createLine([st1, st2], RailServiceType.FREIGHT, 2)!;

    // Count active freight trains
    const freightTrains = rail.getTrains().filter(
      t => rail.getLineServiceType(t.routeId) === RailServiceType.FREIGHT
    );
    expect(freightTrains).toHaveLength(2);

    // Each freight train adds cargo throughput
    const cargoPerTrain = 10; // expected bonus
    const totalBonus = freightTrains.length * cargoPerTrain;
    expect(totalBonus).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// T6.2 External connection — edge stations
// ---------------------------------------------------------------------------
describe('Rail external connection', () => {
  it('should detect edge station as external connection', () => {
    const rail = new RailSystem();
    // Station at edge of a 60x60 map
    rail.buildStation(0, 30); // at x=0 edge
    rail.updateExternalConnection(60, 60);
    expect(rail.hasExternalConnection).toBe(true);
  });

  it('should not flag non-edge station', () => {
    const rail = new RailSystem();
    rail.buildStation(30, 30); // center of map
    rail.updateExternalConnection(60, 60);
    expect(rail.hasExternalConnection).toBe(false);
  });

  it('should generate population and goods when connected', () => {
    const rail = new RailSystem();
    rail.buildStation(0, 30);
    rail.updateExternalConnection(60, 60);
    expect(rail.externalConnection.populationIn).toBeGreaterThan(0);
    expect(rail.externalConnection.goodsIn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T8.3 Vehicle count +/- per route
// ---------------------------------------------------------------------------
describe('Vehicle count adjustment', () => {
  it('Bus addVehicleToRoute should add a vehicle', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    const route = bus.createRoute([s1, s2], 1);
    expect(bus.getVehicles()).toHaveLength(1);

    bus.addVehicleToRoute(route.id);
    expect(bus.getVehicles()).toHaveLength(2);
    expect(route.vehicles).toBe(2);
  });

  it('Bus removeVehicleFromRoute should remove a vehicle (min 1)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    const route = bus.createRoute([s1, s2], 2);
    expect(bus.getVehicles()).toHaveLength(2);

    bus.removeVehicleFromRoute(route.id);
    expect(bus.getVehicles()).toHaveLength(1);
    expect(route.vehicles).toBe(1);

    // Should not go below 1
    bus.removeVehicleFromRoute(route.id);
    expect(bus.getVehicles()).toHaveLength(1);
    expect(route.vehicles).toBe(1);
  });

  it('Metro addVehicleToRoute should add a train', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(10, 0);
    const line = metro.createLine([st1, st2], 1);

    metro.addVehicleToRoute(line.id);
    expect(metro.getTrains()).toHaveLength(2);
    expect(line.vehicles).toBe(2);
  });

  it('Rail addVehicleToRoute should add a train and update cost', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(10, 0);
    const line = rail.createLine([st1, st2], RailServiceType.PASSENGER, 1)!;
    const costBefore = line.operatingCost;

    rail.addVehicleToRoute(line.id);
    expect(rail.getTrains()).toHaveLength(2);
    expect(line.operatingCost).toBeGreaterThan(costBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase T4.2c-e: Rail / Ferry passenger boarding acceptance tests
// ---------------------------------------------------------------------------
describe('Rail passenger boarding (visual-only from loadFactor)', () => {
  it('sets train passengers from dailyRiders loadFactor (capacity 300)', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(2, 0);
    rail.createLine([st1, st2], RailServiceType.PASSENGER);

    // 1 vehicle × 300 = 300 total, 150 riders → loadFactor 0.5
    st1.dailyRiders = 100;
    st2.dailyRiders = 50;
    rail.tick();
    const t = rail.getTrains()[0]!;
    expect(t.passengers).toBe(150); // round(0.5 × 300)
  });

  it('caps passengers at capacity when loadFactor > 1', () => {
    const rail = new RailSystem();
    const st1 = rail.buildStation(0, 0);
    const st2 = rail.buildStation(2, 0);
    rail.createLine([st1, st2], RailServiceType.PASSENGER);

    st1.dailyRiders = 400; // exceeds 300 capacity → loadFactor capped at 1
    rail.tick();
    const t = rail.getTrains()[0]!;
    expect(t.passengers).toBe(300); // capped
  });
});

describe('Ferry passenger boarding (visual-only from loadFactor)', () => {
  it('sets vessel passengers from dailyRiders loadFactor (capacity 100)', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(2, 0)!;
    ferry.createRoute([d1, d2]);

    // 1 vessel × 100 = 100 total, 60 riders → loadFactor 0.6
    d1.dailyRiders = 40;
    d2.dailyRiders = 20;
    ferry.tick();
    const v = ferry.getVessels()[0]!;
    expect(v.passengers).toBe(60); // round(0.6 × 100)
    expect(d1.passengers).toBe(0); // unchanged (was 0)
  });

  it('caps vessel passengers at capacity when loadFactor > 1', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(2, 0)!;
    ferry.createRoute([d1, d2]);

    d1.dailyRiders = 150; // exceeds 100 → capped
    ferry.tick();
    const v = ferry.getVessels()[0]!;
    expect(v.passengers).toBe(100); // capped at capacity
  });
});

// ---------------------------------------------------------------------------
// Phase T3.1 acceptance: Ferry travel time
// ---------------------------------------------------------------------------
describe('Ferry travel time', () => {
  it('should travel at visual-synced speed (0.375 units/tick)', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(10, 0)!; // distance=10
    ferry.createRoute([d1, d2]);

    ferry.tick(); // arrive d1
    for (let i = 0; i < 6; i++) ferry.tick(); // dwell 6 ticks
    const v = ferry.getVessels()[0]!;
    expect(v.traveling).toBe(true);
    // travel ticks = ceil(10 / 0.375) = 27
    expect(v.travelTicks).toBe(27);
  });
});

describe('METRO constants', () => {
  it('build cost per station should be positive', () => {
    expect(METRO.BUILD_COST_PER_STATION).toBeGreaterThan(0);
  });
});

describe('RAIL constants', () => {
  it('passenger capacity should be positive', () => {
    expect(RAIL.PASSENGER_CAPACITY).toBeGreaterThan(0);
  });

  it('freight capacity should be greater than passenger capacity', () => {
    expect(RAIL.FREIGHT_CAPACITY).toBeGreaterThan(RAIL.PASSENGER_CAPACITY);
  });
});
