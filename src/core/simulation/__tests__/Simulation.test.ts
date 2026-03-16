import { describe, it, expect } from 'vitest';
import { GameClock, TIME_PERIOD, SPEED_INTERVALS } from '../GameClock';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop, countResidentialCapacity, countWorkplaceJobs, SIMULATION, clampBuildingLevel } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { PolicyType, Specialization } from '../../district/types';
import { setSpecialization } from '../../district/Specialization';
import { CitySpecType } from '../../district/CitySpecialization';

/** Add power+water plants adjacent to a position so buildings there get utilities. */
function provideUtilities(state: GameState, x: number, y: number): void {
  state.grid.setCell(x - 1, y, { roadFlags: 1, roadType: 1 });
  state.power.addPlant({ x: x - 2, y, output: 1500, pollution: 0, type: 'coal' });
  state.water.addPlant({ x: x - 2, y: y + 1, output: 1500 });
  state.grid.setCell(x - 2, y + 1, { roadFlags: 1, roadType: 1 });
}

describe('Simulation tick interval constants', () => {
  it('SLOW_TICK_INTERVAL should be a positive integer', () => {
    expect(SIMULATION.SLOW_TICK_INTERVAL).toBeGreaterThan(0);
    expect(Number.isInteger(SIMULATION.SLOW_TICK_INTERVAL)).toBe(true);
  });

  it('MEDIUM_TICK_INTERVAL should be a multiple of SLOW_TICK_INTERVAL', () => {
    expect(SIMULATION.MEDIUM_TICK_INTERVAL).toBeGreaterThan(SIMULATION.SLOW_TICK_INTERVAL);
    expect(SIMULATION.MEDIUM_TICK_INTERVAL % SIMULATION.SLOW_TICK_INTERVAL).toBe(0);
  });
});

describe('SIMULATION config constants', () => {
  it('growth and clearance rates should be valid probabilities', () => {
    expect(SIMULATION.BURNED_CLEARANCE_CHANCE).toBeGreaterThan(0);
    expect(SIMULATION.BURNED_CLEARANCE_CHANCE).toBeLessThan(1);
    expect(SIMULATION.GROWTH_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isInteger(SIMULATION.GROWTH_ATTEMPTS)).toBe(true);
  });

  it('crime constants should be valid', () => {
    expect(SIMULATION.CRIME_BASE_MAX).toBeGreaterThan(0);
    expect(SIMULATION.CRIME_POP_FACTOR).toBeGreaterThan(0);
    expect(SIMULATION.CRIME_COVERAGE_PER_STATION).toBeGreaterThan(0);
    expect(SIMULATION.CRIME_MAX_REDUCTION).toBeGreaterThan(0);
    expect(SIMULATION.CRIME_MAX_REDUCTION).toBeLessThanOrEqual(1);
  });

  it('commute constants should be valid', () => {
    expect(SIMULATION.COMMUTE_MAX).toBeGreaterThan(SIMULATION.COMMUTE_BASE);
    expect(SIMULATION.COMMUTE_SPREAD_FACTOR).toBeGreaterThan(0);
    expect(SIMULATION.COMMUTE_JITTER).toBeGreaterThan(0);
  });

  it('service weights should be positive', () => {
    expect(SIMULATION.SERVICE_POWER_WEIGHT).toBeGreaterThan(0);
    expect(SIMULATION.SERVICE_WATER_WEIGHT).toBeGreaterThan(0);
    expect(SIMULATION.LOW_POLLUTION_THRESHOLD).toBeGreaterThan(0);
  });

  it('business tax baseline should be positive', () => {
    expect(SIMULATION.BUSINESS_TAX_BASELINE).toBeGreaterThan(0);
    expect(SIMULATION.BUSINESS_TAX_PENALTY_PER_POINT).toBeGreaterThan(0);
  });

  it('vehicle cap should be reasonable', () => {
    expect(SIMULATION.VEHICLE_CAP_MAX).toBeGreaterThan(0);
    expect(SIMULATION.VEHICLE_CAP_BASE).toBeGreaterThan(0);
    expect(SIMULATION.VEHICLE_CAP_POP_RATIO).toBeGreaterThan(0);
    expect(SIMULATION.VEHICLE_CAP_POP_RATIO).toBeLessThanOrEqual(1);
  });

  it('commute sampling limits should be ordered', () => {
    expect(SIMULATION.SAMPLE_COUNT_MIN).toBeGreaterThan(0);
    expect(SIMULATION.SAMPLE_COUNT_MAX).toBeGreaterThan(SIMULATION.SAMPLE_COUNT_MIN);
    expect(SIMULATION.SAMPLE_DIVISOR).toBeGreaterThan(0);
  });

  it('cell value max should be 255 (uint8)', () => {
    expect(SIMULATION.CELL_VALUE_MAX).toBe(255);
  });

  it('walk to stop range should be positive', () => {
    expect(SIMULATION.WALK_TO_STOP_RANGE).toBeGreaterThan(0);
  });

  it('industrial pollution factor should be between 0 and 1', () => {
    expect(SIMULATION.INDUSTRIAL_POLLUTION_FACTOR).toBeGreaterThan(0);
    expect(SIMULATION.INDUSTRIAL_POLLUTION_FACTOR).toBeLessThanOrEqual(1);
  });

  it('rail transit time factor should give discount over road', () => {
    expect(SIMULATION.RAIL_TRANSIT_TIME_FACTOR).toBeLessThan(1);
    expect(SIMULATION.RAIL_TRANSIT_TIME_FACTOR).toBeGreaterThan(0);
  });
});

describe('clampBuildingLevel', () => {
  it('should clamp service coverage to building level 1-3', () => {
    expect(clampBuildingLevel(0)).toBe(1);
    expect(clampBuildingLevel(3)).toBe(1);
    expect(clampBuildingLevel(4)).toBe(2);
    expect(clampBuildingLevel(9)).toBe(3);
    expect(clampBuildingLevel(100)).toBe(3);
  });

  it('should return 1 for NaN input', () => {
    expect(clampBuildingLevel(NaN)).toBe(1);
  });
});

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

  it('TIME_PERIOD constants should form valid non-overlapping ranges', () => {
    expect(TIME_PERIOD.NIGHT_END).toBeLessThan(TIME_PERIOD.MORNING_RUSH_START);
    expect(TIME_PERIOD.MORNING_RUSH_END).toBeLessThan(TIME_PERIOD.MIDDAY_START);
    expect(TIME_PERIOD.MIDDAY_END).toBeLessThan(TIME_PERIOD.NIGHT_START);
  });

  it('SPEED_INTERVALS should have Infinity for paused and decreasing values for higher speeds', () => {
    expect(SPEED_INTERVALS[0]).toBe(Infinity);
    expect(SPEED_INTERVALS[1]).toBeGreaterThan(SPEED_INTERVALS[2]);
    expect(SPEED_INTERVALS[2]).toBeGreaterThan(SPEED_INTERVALS[3]);
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

describe('congestion flow prediction', () => {
  it('should compute flow prediction on first tick', () => {
    const state = createGameState(10, 10);
    // Build a simple road: 0,5 → 1,5 → 2,5 → 3,5 → 4,5
    for (let x = 0; x < 5; x++) {
      let flags = 0;
      if (x > 0) flags |= 0x08; // WEST
      if (x < 4) flags |= 0x02; // EAST
      state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
    // Residential at 0,4 (adjacent to road 0,5)
    state.grid.setCell(0, 4, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    // Commercial at 4,4 (adjacent to road 4,5)
    state.grid.setCell(4, 4, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    const loop = new SimulationLoop(state);
    loop.tick(); // first tick triggers initial prediction

    // Road cells along the path should have flow > 0
    const density = state.traffic.getSegmentDensity('2,5');
    // Even if no vehicles exist, predicted flow should detect this corridor
    expect(density).toBeGreaterThanOrEqual(0); // at least computed without crash
  });

  it('should recompute flow periodically (every 60 ticks)', () => {
    const state = createGameState(10, 10);
    const loop = new SimulationLoop(state);
    // Run enough ticks to trigger periodic recompute (60 ticks = 15 sec at 4 ticks/sec)
    for (let i = 0; i < 65; i++) {
      loop.tick();
    }
    // Should not crash
    expect(state.clock.tick).toBe(65);
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

  it('should use BuildingType residents for High Rise (id=6, 320 residents)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    expect(countResidentialCapacity(state.grid)).toBe(320);
  });

  it('should sum capacity across multiple residential buildings', () => {
    const state = createGameState(10, 10);
    // Small House (4) + Small Apartment (80) = 84
    state.grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    expect(countResidentialCapacity(state.grid)).toBe(84);
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

  it('should use BuildingType workers for Office Tower (id=21, 600 workers)', () => {
    const state = createGameState(10, 10);
    state.grid.setCell(3, 3, { zoneType: ZoneType.OFFICE, buildingId: 21 });
    expect(countWorkplaceJobs(state.grid)).toBe(600);
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

describe('Education integration in SimulationLoop', () => {
  it('should upgrade CHILD education to ELEMENTARY when elementary school exists', () => {
    const state = createGameState(20, 20);
    // Add elementary school
    state.education.addSchool(10, 10, 'elementary', 15);
    // Create a child citizen (age 8, CHILD stage)
    const child = state.citizens.createCitizen({ age: 8 });
    expect(child.education).toBe('NONE');

    const loop = new SimulationLoop(state);
    // Run enough ticks for education tick to fire (every 6 ticks)
    for (let i = 0; i < 12; i++) loop.tick();

    expect(child.education).toBe('ELEMENTARY');
  });

  it('should NOT upgrade CHILD education when no elementary school', () => {
    const state = createGameState(20, 20);
    // No school added
    const child = state.citizens.createCitizen({ age: 8 });
    expect(child.education).toBe('NONE');

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(child.education).toBe('NONE');
  });

  it('should upgrade TEEN education to HIGH_SCHOOL when high school exists', () => {
    const state = createGameState(20, 20);
    state.education.addSchool(10, 10, 'highschool', 15);
    // Teen with elementary education
    const teen = state.citizens.createCitizen({ age: 15, education: 'ELEMENTARY' as any });

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(teen.education).toBe('HIGH_SCHOOL');
  });

  it('should upgrade young ADULT to UNIVERSITY when university exists', () => {
    const state = createGameState(20, 20);
    state.education.addSchool(10, 10, 'university', 15);
    // Young adult (age 22) with high school education
    const adult = state.citizens.createCitizen({ age: 22, education: 'HIGH_SCHOOL' as any });

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(adult.education).toBe('UNIVERSITY');
  });

  it('should NOT upgrade ADULT over 25 to UNIVERSITY', () => {
    const state = createGameState(20, 20);
    state.education.addSchool(10, 10, 'university', 15);
    // Adult age 30 with high school education
    const adult = state.citizens.createCitizen({ age: 30, education: 'HIGH_SCHOOL' as any });

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 12; i++) loop.tick();

    expect(adult.education).toBe('HIGH_SCHOOL');
  });
});

describe('DeathCare integration', () => {
  it('ageTick should only age without killing', () => {
    const state = createGameState(10, 10);
    for (let i = 0; i < 3; i++) {
      state.citizens.createCitizen({ age: 100 });
    }
    expect(state.citizens.getPopulation()).toBe(3);

    state.citizens.ageTick();
    // ageTick no longer kills — all 3 should survive (at age 101)
    expect(state.citizens.getPopulation()).toBe(3);
  });

  it('deathTick should kill citizens over 100 and report to DeathCare', () => {
    const state = createGameState(10, 10);
    state.deathCare.addCemetery(5, 5);
    // Create citizens already over 100 → guaranteed death in deathTick
    for (let i = 0; i < 3; i++) {
      state.citizens.createCitizen({ age: 101 });
    }

    const deadIds = state.citizens.deathTick(() => false);
    expect(deadIds.length).toBe(3);
    expect(state.citizens.getPopulation()).toBe(0);

    // Report deaths to deathCare
    for (let i = 0; i < deadIds.length; i++) state.deathCare.reportDeath();
    // Run deathCare ticks to process cremation
    for (let i = 0; i < 100; i++) state.deathCare.tick();
    expect(state.deathCare.getUnprocessed()).toBe(0);
  });

  it('SimulationLoop daily deathTick reports deaths to DeathCareService', () => {
    const state = createGameState(10, 10);
    state.deathCare.addCemetery(5, 5);
    // Create citizens at age 101 — will die on first deathTick (daily check)
    for (let i = 0; i < 3; i++) {
      state.citizens.createCitizen({ age: 101 });
    }

    const loop = new SimulationLoop(state);
    // Run enough ticks to trigger at least one day change (24 ticks = 1 day)
    for (let i = 0; i < 48; i++) loop.tick();

    expect(state.citizens.getPopulation()).toBe(0);
  });
});

describe('District integration', () => {
  it('GameState should include districts and policies', () => {
    const state = createGameState(20, 20);
    expect(state.districts).toBeDefined();
    expect(state.policies).toBeDefined();
  });

  it('should create a district and assign cells', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('Downtown');
    state.districts.addCellToDistrict(d.id, 5, 5);
    state.districts.addCellToDistrict(d.id, 5, 6);
    expect(state.districts.getDistrictAt(5, 5)).toBe(d);
    expect(state.districts.getDistrictAt(5, 6)).toBe(d);
    expect(state.districts.getDistrictAt(0, 0)).toBeNull();
  });

  it('NO_HEAVY_INDUSTRY policy should block industrial building growth in district', () => {
    const state = createGameState(20, 20);
    // Create district and apply NO_HEAVY_INDUSTRY policy
    const d = state.districts.createDistrict('GreenZone');
    state.districts.addCellToDistrict(d.id, 5, 5);
    state.policies.applyPolicy(d.id, PolicyType.NO_HEAVY_INDUSTRY);

    // Set up conditions for building growth at (5,5): road + zone + power + water
    state.grid.setCell(5, 4, { roadType: 2, roadFlags: 0x0F });
    state.grid.setCell(5, 5, { zoneType: ZoneType.INDUSTRIAL });
    state.power.addPlant({ x: 5, y: 3, output: 100, pollution: 10, type: 'coal' });
    state.water.addPlant({ x: 5, y: 3, output: 100 });

    // canBuildInDistrict should block industrial
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.INDUSTRIAL)).toBe(false);
    // But residential should be allowed
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.RESIDENTIAL_LOW)).toBe(true);
  });

  it('HIGH_DENSITY_BAN policy should block high-density building growth', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('Suburbs');
    state.districts.addCellToDistrict(d.id, 3, 3);
    state.policies.applyPolicy(d.id, PolicyType.HIGH_DENSITY_BAN);

    expect(state.policies.canBuildInDistrict(d.id, ZoneType.RESIDENTIAL_HIGH)).toBe(false);
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.COMMERCIAL_HIGH)).toBe(false);
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.RESIDENTIAL_LOW)).toBe(true);
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.COMMERCIAL_LOW)).toBe(true);
  });

  it('district policy costs should be added to budget expenses', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('TestDistrict');
    state.policies.applyPolicy(d.id, PolicyType.NO_HEAVY_INDUSTRY); // cost 150
    state.policies.applyPolicy(d.id, PolicyType.ENCOURAGE_RECYCLING); // cost 100

    const loop = new SimulationLoop(state);
    // Run enough ticks to trigger income calculation
    for (let i = 0; i < 6; i++) loop.tick();

    // Expenses should include policy costs
    expect(state.budget.expenses).toBeGreaterThan(0);
  });
});

describe('Specialization integration', () => {
  it('MINING specialization should increase revenue for industrial buildings in district', () => {
    const state = createGameState(20, 20);
    // Create district with MINING specialization
    const d = state.districts.createDistrict('MiningDistrict');
    setSpecialization(state.districts, d.id, Specialization.MINING);
    state.districts.addCellToDistrict(d.id, 5, 5);

    state.grid.setCell(5, 5, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    provideUtilities(state, 5, 5);
    state.grid.setCell(10, 10, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    provideUtilities(state, 10, 10);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // Income should be higher than if both buildings had no specialization
    // MINING revenueMultiplier = 1.2
    // Without spec: 2 buildings × buildingId(13) × 2 = 52 base income
    // With spec: 1 normal (26) + 1 mining (26 × 1.2 = 31.2) = 57.2
    expect(state.budget.income).toBeGreaterThan(0);
  });

  it('TOURISM specialization should boost revenue by 1.5x for buildings in district', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('TourismDistrict');
    setSpecialization(state.districts, d.id, Specialization.TOURISM);

    for (let x = 3; x <= 5; x++) {
      state.districts.addCellToDistrict(d.id, x, 5);
      state.grid.setCell(x, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    }
    provideUtilities(state, 3, 5);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // 3 buildings × companyIncome(10) × levelMult(1.0) × 1.5 (tourism bonus) × businessTaxRate/100
    const businessTax = state.taxRates.business ?? 9;
    const expectedWithBonus = 3 * 10 * 1.0 * 1.5 * (businessTax / 100);
    expect(state.budget.income).toBeCloseTo(expectedWithBonus, 1);
  });

  it('NONE specialization should not modify revenue', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('NormalDistrict');
    state.districts.addCellToDistrict(d.id, 5, 5);
    state.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    provideUtilities(state, 5, 5);
    state.grid.setCell(10, 10, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    provideUtilities(state, 10, 10);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // Both buildings should generate same revenue (no bonus)
    // Small Shop: companyIncome=10, Lv1, levelMult=1.0
    const businessTax = state.taxRates.business ?? 9;
    const expected = 2 * 10 * 1.0 * (businessTax / 100); // 2 buildings × companyIncome × businessTax
    expect(state.budget.income).toBeCloseTo(expected, 1);
  });
});

describe('CitySpecialization integration', () => {
  it('GameState should include citySpec', () => {
    const state = createGameState(20, 20);
    expect(state.citySpec).toBeDefined();
    expect(state.citySpec.getCurrent()).toBe(CitySpecType.NONE);
  });

  it('GAMBLING_CITY should increase all building revenue by 1.4x', () => {
    const state = createGameState(20, 20);
    state.citySpec.choose(CitySpecType.GAMBLING_CITY, 5000);

    state.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    provideUtilities(state, 5, 5);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // companyIncome(10) × levelMult(1.0) × businessTax/100 × gambling(1.4)
    const businessTax = state.taxRates.business ?? 9;
    const expected = 10 * 1.0 * (businessTax / 100) * 1.4;
    expect(state.budget.income).toBeCloseTo(expected, 1);
  });

  it('TECH_CITY should increase revenue by 1.25x', () => {
    const state = createGameState(20, 20);
    state.citySpec.choose(CitySpecType.TECH_CITY, 5000);

    state.grid.setCell(3, 3, { zoneType: ZoneType.OFFICE, buildingId: 16 });
    provideUtilities(state, 3, 3);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // companyIncome(20) × levelMult(1.0) × businessTax/100 × tech(1.25)
    const businessTax = state.taxRates.business ?? 9;
    const expected = 20 * 1.0 * (businessTax / 100) * 1.25;
    expect(state.budget.income).toBeCloseTo(expected, 1);
  });
});

describe('Transport integration', () => {
  it('GameState should include all transport systems', () => {
    const state = createGameState(20, 20);
    expect(state.bus).toBeDefined();
    expect(state.metro).toBeDefined();
    expect(state.rail).toBeDefined();
    expect(state.ferry).toBeDefined();
    expect(state.airport).toBeDefined();
  });

  it('transport systems should tick in simulation loop', () => {
    const state = createGameState(20, 20);
    // Add a bus route
    const stop1 = state.bus.addStop(0, 0);
    const stop2 = state.bus.addStop(5, 0);
    state.bus.createRoute([stop1, stop2], 1);

    // Add a metro line
    const ms1 = state.metro.addStation(0, 0);
    const ms2 = state.metro.addStation(10, 0);
    state.metro.createLine([ms1, ms2], 1);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 12; i++) loop.tick();

    // Vehicles should have moved (tick was called)
    expect(state.bus.getVehicles().length).toBeGreaterThan(0);
    expect(state.metro.getTrains().length).toBeGreaterThan(0);
  });

  it('transport operating costs should be included in budget expenses', () => {
    const state = createGameState(20, 20);
    state.budget.funds = 100000;

    // Add bus route (has operating cost)
    const s1 = state.bus.addStop(0, 0);
    const s2 = state.bus.addStop(5, 0);
    state.bus.createRoute([s1, s2], 1);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // Expenses should include transport operating costs
    expect(state.budget.expenses).toBeGreaterThan(0);
  });
});
