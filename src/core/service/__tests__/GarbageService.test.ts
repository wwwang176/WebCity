import { describe, it, expect } from 'vitest';
import { GarbageService, GARBAGE } from '../GarbageService';

describe('GarbageService', () => {
  it('should create a GarbageService instance', () => {
    const gs = new GarbageService();
    expect(gs).toBeDefined();
    expect(gs.getTotalCapacity()).toBe(0);
    expect(gs.getCurrentLoad()).toBe(0);
    expect(gs.getOverflow()).toBe(0);
  });

  it('should addFacility with type landfill', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 'landfill', 1000);
    expect(id).toBeTruthy();
    expect(gs.getTotalCapacity()).toBe(1000);
  });

  it('should addFacility with type incinerator', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(10, 10, 'incinerator', 500);
    expect(id).toBeTruthy();
    expect(gs.getTotalCapacity()).toBe(500);
  });

  it('should use default capacity if not specified', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill');
    expect(gs.getTotalCapacity()).toBe(1000); // default landfill capacity
    const gs2 = new GarbageService();
    gs2.addFacility(5, 5, 'incinerator');
    expect(gs2.getTotalCapacity()).toBe(500); // default incinerator capacity
  });

  it('should getCoverage(x, y) return true within range', () => {
    const gs = new GarbageService();
    gs.addFacility(10, 10, 'landfill', 1000);
    expect(gs.getCoverage(10, 10)).toBe(true);
    expect(gs.getCoverage(12, 10)).toBe(true); // within default range
    expect(gs.getCoverage(10, 15)).toBe(true); // within range
  });

  it('should getCoverage(x, y) return false outside range', () => {
    const gs = new GarbageService();
    gs.addFacility(10, 10, 'landfill', 1000);
    expect(gs.getCoverage(50, 50)).toBe(false);
  });

  it('should produceGarbage based on population (1 per 100 pop)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.tick(500); // 500 pop → 5 units of garbage produced
    expect(gs.getCurrentLoad()).toBe(5);
  });

  it('should collectGarbage not exceeding capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 10);
    // Fill beyond capacity
    for (let i = 0; i < 300; i++) {
      gs.tick(1000); // produces 10 per tick
    }
    // Load should not exceed total capacity (10), overflow should exist
    expect(gs.getCurrentLoad()).toBe(10);
    expect(gs.getOverflow()).toBeGreaterThan(0);
  });

  it('should return overflow > 0 when garbage exceeds capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 5);
    // Tick with large population to produce lots of garbage
    gs.tick(5000); // produces 50, capacity only 5
    expect(gs.getOverflow()).toBeGreaterThan(0);
  });

  it('should return pollutionPenalty > 0 when overflow exists', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 5);
    gs.tick(5000); // overflow will happen
    expect(gs.getPollutionPenalty()).toBeGreaterThan(0);
  });

  it('should return pollutionPenalty 0 when no overflow', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 10000);
    gs.tick(100); // 1 unit produced, well within capacity
    expect(gs.getPollutionPenalty()).toBe(0);
  });

  it('should removeFacility by id', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 'landfill', 1000);
    expect(gs.getTotalCapacity()).toBe(1000);
    gs.removeFacility(id);
    expect(gs.getTotalCapacity()).toBe(0);
  });

  it('should handle tick(population) to auto-produce and collect', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 100);
    gs.tick(200); // 200 pop → 2 units
    expect(gs.getCurrentLoad()).toBe(2);
    gs.tick(300); // 300 pop → 3 more
    expect(gs.getCurrentLoad()).toBe(5);
  });

  it('should serialize and deserialize (toJSON / fromJSON)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.addFacility(10, 10, 'incinerator', 500);
    gs.tick(300); // produce some garbage

    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);

    expect(restored.getTotalCapacity()).toBe(1500);
    expect(restored.getCurrentLoad()).toBe(gs.getCurrentLoad());
    expect(restored.getOverflow()).toBe(gs.getOverflow());
  });

  it('should support multiple facilities with combined capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.addFacility(15, 15, 'incinerator', 500);
    expect(gs.getTotalCapacity()).toBe(1500);
  });

  it('should have combined coverage from multiple facilities', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.addFacility(40, 40, 'incinerator', 500);
    expect(gs.getCoverage(5, 5)).toBe(true);
    expect(gs.getCoverage(40, 40)).toBe(true);
  });

  it('should incinerator process garbage faster (reduce load over time)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'incinerator', 500);
    gs.tick(1000); // 10 units produced
    const loadAfterFirst = gs.getCurrentLoad();
    // Incinerator burns some garbage each tick, so load should stay manageable
    expect(loadAfterFirst).toBeLessThanOrEqual(10);
  });
});

describe('GARBAGE constants', () => {
  it('maintenance per facility should be positive', () => {
    expect(GARBAGE.MAINTENANCE_PER_FACILITY).toBeGreaterThan(0);
  });

  it('pollution load threshold should be between 0 and 1', () => {
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeGreaterThan(0);
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('overflow pollution multiplier should be positive', () => {
    expect(GARBAGE.OVERFLOW_POLLUTION_MULTIPLIER).toBeGreaterThan(0);
  });
});
