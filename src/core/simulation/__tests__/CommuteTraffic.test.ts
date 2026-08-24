import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { getInfraBuildingId } from '../../building/InfraConfig';
import { SIMULATION } from '../SimulationConstants';

/**
 * Helper: set up a minimal city with residential + commercial buildings
 * connected by a long road (>= 8 cells so vehicles don't arrive in 1 tick
 * with BASE_SPEED=3.5). Layout (20x20 grid):
 *
 *   (1,1) residential [buildingId=1, Small House, 4 residents]
 *   (2,1)...(14,1) road (13 cells of road)
 *   (15,1) commercial [buildingId=7, Small Shop, 4 workers]
 */
function setupMinimalCity(state: GameState): void {
  // Residential building at (1,1)
  state.grid.setCell(1, 1, {
    zoneType: ZoneType.RESIDENTIAL_LOW,
    buildingId: 1, // Small House, 4 residents
  });
  // Road from (2,1) to (14,1) — 13 road cells, with roadFlags for lane graph
  for (let x = 2; x <= 14; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;   // start: only connects east
    if (x === 14) flags = RoadDirection.WEST;  // end: only connects west
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  // Commercial building at (15,1)
  state.grid.setCell(15, 1, {
    zoneType: ZoneType.COMMERCIAL_LOW,
    buildingId: 7, // Small Shop, 4 workers
  });
}

/**
 * Advance clock to a specific hour of the current day.
 * This resets to the next occurrence of `targetHour`.
 */
function advanceToHour(state: GameState, targetHour: number): void {
  const currentHour = state.clock.getHourOfDay();
  let ticksNeeded = targetHour - currentHour;
  if (ticksNeeded < 0) ticksNeeded += 24;
  // Directly set the tick to avoid running simulation ticks
  state.clock.tick += ticksNeeded;
}

describe('Commute Traffic System', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupMinimalCity(state);
  });

  it('should spawn home→work vehicles during morning rush (hours 6-9)', () => {
    // Create adult citizens with home and workplace assigned (position strings)
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',     // residential building at (1,1)
      workplaceId: '15,1', // commercial building at (15,1)
    })!;

    // Advance to hour 7 (morning rush)
    advanceToHour(state, 7);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick(); // enqueue + flush (Worker responds synchronously)
    loop.tick(); // spawn using cached variants

    // Should have spawned at least 1 commute vehicle
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should spawn work→home vehicles during evening rush (hours 17-21)', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    // Advance to hour 18 (evening rush)
    advanceToHour(state, 18);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should spawn vehicles at any hour (time-of-day independent)', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    // Advance to hour 2 (previously "night" — now should still spawn)
    advanceToHour(state, 2);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // Vehicles are cosmetic and spawn uniformly regardless of time-of-day
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should not spawn vehicles for citizens without workplace', () => {
    // Citizen has home but no workplace
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: null,
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    // No commute should happen
    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn vehicles for citizens without home', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: null,
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn commute vehicles for children (age < 53)', () => {
    state.citizens.createCitizen({
      age: 10,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn commute vehicles for seniors (age > 200)', () => {
    state.citizens.createCitizen({
      age: 210,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should scale vehicle count with working population', () => {
    // Homes and workplaces must be spread out. Packed into one building, the second vehicle
    // is blocked at the spawn point by the first (`isSpawnBlocked`) and only one or two are
    // ever on the road; departure direction is random, so whether two collide at the same
    // doorway is luck, making this flaky for reasons unrelated to population scaling.
    const homes: string[] = [];
    for (let x = 2; x <= 11; x++) {
      state.grid.setCell(x, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      homes.push(`${x},0`);
    }
    const works: string[] = [];
    for (let x = 5; x <= 14; x++) {
      state.grid.setCell(x, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      works.push(`${x},2`);
    }
    for (let i = 0; i < 10; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: homes[i % homes.length]!,
        workplaceId: works[(i * 3) % works.length]!,
      })!;
    }

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // With 10 working citizens, should spawn multiple vehicles
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(1);
  });

  it('should spawn commute vehicles during midday hours too', () => {
    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: '1,1',
        workplaceId: '15,1',
      })!;
    }

    advanceToHour(state, 12);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // Vehicles spawn uniformly — midday should also have traffic
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should keep spawning vehicles across multiple ticks up to vehicle cap', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());

    // Tick 1: enqueue + flush, tick 2+: spawn vehicles
    loop.tick();
    loop.tick();
    loop.tick();
    loop.tick();
    // With random sampling, vehicle count should grow (bounded by vehicleCap)
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should count every kind of vehicle against the spawn cap', () => {
    // The cap limits how many vehicles can run on screen at once before the frame rate
    // suffers. Through traffic and freight occupy road just as commuters do, so the cap
    // counts everything: counting only commute vehicles lets the other two stack past it.
    //
    // The panel card asks a different question (how many residents are driving) and uses
    // `getCommuteVehicleCount`. The two numbers are not interchangeable.
    //
    // There have to be enough residents that somebody is still waiting to leave once others
    // are on the road; with one resident, nobody remains to spawn after they depart and
    // whether the cap is respected is unobservable.
    //
    // Homes and workplaces must be spread out too. Packed into one building, the second
    // vehicle is blocked at the spawn point by the first (`isSpawnBlocked`) and only two or
    // three are ever on the road — a different mechanism that would keep this case from ever
    // reaching the cap.
    const homes: string[] = [];
    for (let x = 2; x <= 11; x++) {
      state.grid.setCell(x, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      homes.push(`${x},0`);
    }
    const works: string[] = [];
    for (let x = 5; x <= 14; x++) {
      state.grid.setCell(x, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      works.push(`${x},2`);
    }
    const POP = 40;
    for (let i = 0; i < POP; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: homes[i % homes.length]!,
        workplaceId: works[(i * 3) % works.length]!,
      })!;
    }
    advanceToHour(state, 7);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick(); // build the lane graph first

    const cap = SIMULATION.VEHICLE_CAP_BASE
      + Math.floor(POP * SIMULATION.VEHICLE_CAP_POP_RATIO);
    const edges = loop.laneGraph.getAllEdges();
    expect(edges.length, '沒有車道就填不滿上限，這個案例會失去意義')
      .toBeGreaterThan(0);
    // Fill to the cap with through traffic, which carries no citizenId.
    //
    // All of it goes onto the middle edge and is pushed halfway along it: a vehicle blocking
    // the spawn point would stop the trip anyway (`isSpawnBlocked`), which is a different
    // mechanism. Placing the filler far away leaves the cap as the only possible reason for
    // no further growth.
    const mid = edges[Math.floor(edges.length / 2)]!;
    while (state.traffic.getVehicleCount() < cap) {
      const v = state.traffic.addVehicleOnEdges([mid]);
      v.edgeProgress = mid.length * 0.5;
    }
    expect(state.traffic.getVehicleCount()).toBeGreaterThanOrEqual(cap);

    // Citizens are still waiting to leave, so no further growth can only be the cap.
    const before = state.traffic.getCommuteVehicleCount();
    expect(before, '所有居民都已經在路上了，這個案例會失去意義').toBeLessThan(POP);
    loop.tick();
    loop.tick();

    expect(state.traffic.getVehicleCount(), '車輛總數衝破上限 —— 畫面會開始卡')
      .toBeLessThanOrEqual(cap);
    expect(state.traffic.getCommuteVehicleCount(), '上限已經被過境車流佔滿，還放通勤車上路')
      .toBe(before);
  });

  it('should stop mid-tick instead of overshooting the cap', () => {
    // Checking the cap once per tick is not enough: a tick can spawn several vehicles, and
    // starting one short of the cap would overshoot. The check runs before each spawn.
    const homes: string[] = [];
    for (let x = 2; x <= 11; x++) {
      state.grid.setCell(x, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      homes.push(`${x},0`);
    }
    const works: string[] = [];
    for (let x = 5; x <= 14; x++) {
      state.grid.setCell(x, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      works.push(`${x},2`);
    }
    const POP = 40;
    for (let i = 0; i < POP; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: homes[i % homes.length]!,
        workplaceId: works[(i * 3) % works.length]!,
      })!;
    }
    advanceToHour(state, 7);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();

    const cap = SIMULATION.VEHICLE_CAP_BASE
      + Math.floor(POP * SIMULATION.VEHICLE_CAP_POP_RATIO);
    const edges = loop.laneGraph.getAllEdges();
    const mid = edges[Math.floor(edges.length / 2)]!;
    // Filled to one below the cap. The check at the start of the tick lets it through, so
    // whatever stops it must be the per-vehicle check.
    while (state.traffic.getVehicleCount() < cap - 1) {
      const v = state.traffic.addVehicleOnEdges([mid]);
      v.edgeProgress = mid.length * 0.5;
    }
    expect(state.traffic.getVehicleCount()).toBe(cap - 1);

    loop.tick();

    expect(state.traffic.getVehicleCount(), '一個 tick 之內就衝過上限了')
      .toBeLessThanOrEqual(cap);
  });
});

describe('Transport Mode Choice Integration', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupMinimalCity(state);
  });

  it('should skip car spawn when bus route covers commute', () => {
    // Add bus stops near home (1,1) and workplace (15,1)
    const stopA = state.bus.addStop(2, 1); // near residential
    const stopB = state.bus.addStop(14, 1); // near commercial
    state.bus.createRoute([stopA, stopB], 1);

    // Create one commuting citizen
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    // With bus route covering commute, citizen should take bus → no car spawned
    // (bus vehicles may exist from route segment rebuild, so count only non-bus vehicles)
    const carCount = state.traffic.vehicles.filter(v => !v.busState).length;
    expect(carCount).toBe(0);
  });

  it('should spawn car when no transit is available', () => {
    // No bus stops or routes set up — citizen must drive
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // No transit → citizen drives → car spawned
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should not spawn car when citizen walks (distance <= 3)', () => {
    // Place workplace close to home (within walk distance)
    state.grid.setCell(3, 1, {
      zoneType: ZoneType.COMMERCIAL_LOW,
      buildingId: 7,
    });
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '3,1', // Manhattan distance = 2
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    // Walking distance → no car
    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should skip car spawn when metro station covers commute', () => {
    // Add metro stations near home and workplace.
    //
    // The stations must actually be written to the grid. Reachability is measured along the
    // sidewalk graph, where a station exists as a building's door node; calling addStation
    // alone leaves nothing at that coordinate in the graph and it serves nobody. Building a
    // station in the game always writes the grid too (placeTransportStop), so this aligns the
    // fixture with real behaviour rather than accommodating the implementation.
    state.grid.setCell(1, 2, { buildingId: getInfraBuildingId('metro_station') });
    state.grid.setCell(15, 2, { buildingId: getInfraBuildingId('metro_station') });
    const stationA = state.metro.addStation(1, 2); // near residential
    const stationB = state.metro.addStation(15, 2); // near commercial
    state.metro.createLine([stationA, stationB], 1);

    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    })!;

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    // Metro covers commute → no car spawned
    expect(state.traffic.getVehicleCount()).toBe(0);
  });
});

describe('Citizen Home/Workplace Assignment', () => {
  it('should assign homeId to new citizens from migration', () => {
    const state = createGameState(20, 20);
    // Set up residential building with capacity
    state.grid.setCell(1, 1, {
      zoneType: ZoneType.RESIDENTIAL_LOW,
      buildingId: 1, // Small House, 4 residents
    });
    // Set up commercial building
    state.grid.setCell(15, 1, {
      zoneType: ZoneType.COMMERCIAL_LOW,
      buildingId: 7, // Small Shop, 4 workers
    });
    // Connect with road
    for (let x = 2; x <= 14; x++) {
      state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE });
    }

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    // Run enough ticks for migration to add citizens
    for (let i = 0; i < 100; i++) loop.tick();

    const citizensWithHome = state.citizens.getCitizens().filter(c => c.homeId !== null);
    const citizensWithWork = state.citizens.getCitizens().filter(c => c.workplaceId !== null);

    if (state.citizens.getPopulation() > 0) {
      // Citizens who migrated in should have home and workplace assigned as position strings
      expect(citizensWithHome.length).toBeGreaterThan(0);
      expect(citizensWithWork.length).toBeGreaterThan(0);
      // homeId should be a position string like "1,1"
      expect(citizensWithHome[0]!.homeId).toMatch(/^\d+,\d+$/);
    }
  });
});
