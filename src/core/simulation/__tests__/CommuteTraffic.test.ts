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
    // Create 10 adult citizens with commute assignments
    for (let i = 0; i < 10; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: '1,1',
        workplaceId: '15,1',
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
    // 上限管的是畫面上同時能跑幾台 —— 超過就開始卡。過境車流與貨運一樣佔路，
    // 所以上限要看全部，不能只看通勤車:只數通勤車的話，另外兩種可以無視上限
    // 一直往上疊。
    //
    // 面板上那張卡片問的是另一件事（有多少居民在開車），走 `getCommuteVehicleCount`。
    // 兩支數字用途不同，不能互換。
    //
    // 居民要夠多，多到就算已經有人在路上，還是有人排隊等著出門 —— 只放一個居民
    // 的話他上路之後就沒人可生成了，上限有沒有被遵守根本看不出來。
    //
    // 家與工作也要散開。全部擠在同一棟的話，第二台車會被第一台擋在生成點外面
    // （`isSpawnBlocked`），路上永遠只有兩三台 —— 那是另一道機制，會讓這個案例
    // 永遠碰不到上限。
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
    loop.tick(); // 先讓 laneGraph 建起來

    const cap = SIMULATION.VEHICLE_CAP_BASE
      + Math.floor(POP * SIMULATION.VEHICLE_CAP_POP_RATIO);
    const edges = loop.laneGraph.getAllEdges();
    expect(edges.length, '沒有車道就填不滿上限，這個案例會失去意義')
      .toBeGreaterThan(0);
    // 填到上限。過境車流沒有 citizenId。
    //
    // 全部塞在路中間那條邊，而且推到邊的一半 —— 生成點被車擋住的話這一趟本來就
    // 不會出門（`isSpawnBlocked`），那是另一道機制。把填充物放遠一點，「沒有再
    // 長」才只可能是上限造成的。
    const mid = edges[Math.floor(edges.length / 2)]!;
    while (state.traffic.getVehicleCount() < cap) {
      const v = state.traffic.addVehicleOnEdges([mid]);
      v.edgeProgress = mid.length * 0.5;
    }
    expect(state.traffic.getVehicleCount()).toBeGreaterThanOrEqual(cap);

    // 還有人在等著出門，所以「沒有再長」只可能是上限擋下來的。
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
    // 上限每個 tick 檢查一次還不夠 —— 一個 tick 最多可以放好幾台，從「還差一台」
    // 開始跑的話會一路衝過頭。每放一台都要重新問一次。
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
    // 只填到「還差一台」。每個 tick 開頭那道檢查會放行，擋下來的必須是逐台的那道。
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
    // 車站要真的放上 grid。「走得到哪些格子」是沿人行道量的，而車站在人行道圖裡
    // 的身分就是一棟建築的門節點 —— 只呼叫 addStation 的話，那個座標在圖裡什麼
    // 都沒有，服務不到任何人。遊戲裡蓋車站一定會同時寫 grid（placeTransportStop），
    // 所以這是把 fixture 對齊實際行為，不是遷就實作。
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
