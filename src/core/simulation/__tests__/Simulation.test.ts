import { describe, it, expect } from 'vitest';
import { GameClock } from '../GameClock';
import { createGameState } from '../GameState';
import { SimulationLoop, countResidentialCapacity, countWorkplaceJobs } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

describe('GameClock', () => {
  it('should advance tick', () => {
    const clock = new GameClock();
    clock.advance();
    expect(clock.tick).toBe(1);
  });

  it('should not advance when paused', () => {
    const clock = new GameClock();
    clock.pause();
    clock.advance();
    expect(clock.tick).toBe(0);
  });

  it('should support speed control', () => {
    const clock = new GameClock();
    clock.setSpeed(3);
    expect(clock.getTickInterval()).toBe(83);
    clock.setSpeed(1);
    expect(clock.getTickInterval()).toBe(250);
  });

  it('should calculate game time', () => {
    const clock = new GameClock();
    // ticksPerDay = 24 (1 tick = 1 hour), so 720 ticks = 30 days
    for (let i = 0; i < 720; i++) clock.advance();
    expect(clock.getDay()).toBe(30);
    expect(clock.getMonth()).toBe(1);
  });

  it('should have ticksPerDay of 24', () => {
    const clock = new GameClock();
    // 24 ticks = 1 day
    for (let i = 0; i < 24; i++) clock.advance();
    expect(clock.getDay()).toBe(1);
  });

  it('getHourOfDay should return 0-23 based on tick within the day', () => {
    const clock = new GameClock();
    expect(clock.getHourOfDay()).toBe(0); // tick 0 → hour 0
    clock.advance(); // tick 1
    expect(clock.getHourOfDay()).toBe(1);
    for (let i = 0; i < 5; i++) clock.advance(); // tick 6
    expect(clock.getHourOfDay()).toBe(6);
    for (let i = 0; i < 17; i++) clock.advance(); // tick 23
    expect(clock.getHourOfDay()).toBe(23);
    clock.advance(); // tick 24 → next day, hour 0
    expect(clock.getHourOfDay()).toBe(0);
  });

  it('getTimeOfDay should return correct period for each hour range', () => {
    const clock = new GameClock();
    // night: 22-5
    expect(clock.getTimeOfDay()).toBe('night'); // hour 0
    for (let i = 0; i < 5; i++) clock.advance();
    expect(clock.getTimeOfDay()).toBe('night'); // hour 5

    clock.advance(); // hour 6
    expect(clock.getTimeOfDay()).toBe('morning_rush');
    for (let i = 0; i < 3; i++) clock.advance(); // hour 9
    expect(clock.getTimeOfDay()).toBe('morning_rush');

    clock.advance(); // hour 10
    expect(clock.getTimeOfDay()).toBe('midday');
    for (let i = 0; i < 6; i++) clock.advance(); // hour 16
    expect(clock.getTimeOfDay()).toBe('midday');

    clock.advance(); // hour 17
    expect(clock.getTimeOfDay()).toBe('evening_rush');
    for (let i = 0; i < 4; i++) clock.advance(); // hour 21
    expect(clock.getTimeOfDay()).toBe('evening_rush');

    clock.advance(); // hour 22
    expect(clock.getTimeOfDay()).toBe('night');
  });

  it('getDay/getMonth/getYear should still work correctly with 24 ticksPerDay', () => {
    const clock = new GameClock();
    // 1 day = 24 ticks, 1 month = 30 days = 720 ticks, 1 year = 12 months = 8640 ticks
    for (let i = 0; i < 8640; i++) clock.advance();
    expect(clock.getDay()).toBe(360);
    expect(clock.getMonth()).toBe(12);
    expect(clock.getYear()).toBe(1);
  });
});

describe('GameState', () => {
  it('should create with default values', () => {
    const state = createGameState(50, 50);
    expect(state.grid.width).toBe(50);
    expect(state.budget.funds).toBe(50000);
    expect(state.citizens.getPopulation()).toBe(0);
  });
});

describe('SimulationLoop', () => {
  // Note: getAvgPollution() now only averages pollution over residential zone cells
  // (zoneType 1=RESIDENTIAL_LOW, 2=RESIDENTIAL_HIGH) so that industrial pollution
  // far from homes doesn't unfairly reduce citizen happiness. If no residential
  // cells exist, it returns 0.

  it('should run ticks without crashing', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 100; i++) {
      loop.tick();
    }
    expect(state.clock.tick).toBe(100);
  });

  it('should not tick when paused', () => {
    const state = createGameState(20, 20);
    state.clock.pause();
    const loop = new SimulationLoop(state);
    loop.tick();
    expect(state.clock.tick).toBe(0);
  });

  it('should run 1000 ticks without NaN or crash', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 1000; i++) {
      loop.tick();
    }
    expect(state.clock.tick).toBe(1000);
    expect(Number.isFinite(state.budget.funds)).toBe(true);
  });
});

describe('countResidentialCapacity', () => {
  it('should return 0 for empty grid', () => {
    const state = createGameState(10, 10);
    expect(countResidentialCapacity(state.grid)).toBe(0);
  });

  it('should use BuildingType residents for Small House (id=1, 4 residents)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    expect(countResidentialCapacity(state.grid)).toBe(4);
  });

  it('should use BuildingType residents for High Rise (id=6, 80 residents)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    expect(countResidentialCapacity(state.grid)).toBe(80);
  });

  it('should sum capacity across multiple residential buildings', () => {
    const state = createGameState(10, 10);
    // Small House (4) + Small Apartment (20) = 24
    state.grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    expect(countResidentialCapacity(state.grid)).toBe(24);
  });

  it('should ignore non-residential buildings', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    expect(countResidentialCapacity(state.grid)).toBe(0);
  });
});

describe('countWorkplaceJobs', () => {
  it('should return 0 for empty grid', () => {
    const state = createGameState(10, 10);
    expect(countWorkplaceJobs(state.grid)).toBe(0);
  });

  it('should use BuildingType workers for Small Shop (id=7, 4 workers)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(2, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    expect(countWorkplaceJobs(state.grid)).toBe(4);
  });

  it('should use BuildingType workers for Office Tower (id=21, 150 workers)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(3, 3, { zoneType: ZoneType.OFFICE, buildingId: 21 });
    expect(countWorkplaceJobs(state.grid)).toBe(150);
  });

  it('should sum jobs across commercial, industrial, office', () => {
    const state = createGameState(10, 10);
    // Small Shop (4) + Small Factory (10) + Small Office (15) = 29
    state.grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    state.grid.setCell(3, 3, { zoneType: ZoneType.OFFICE, buildingId: 16 });
    expect(countWorkplaceJobs(state.grid)).toBe(29);
  });

  it('should ignore residential buildings', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    expect(countWorkplaceJobs(state.grid)).toBe(0);
  });
});
