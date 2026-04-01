import { describe, it, expect } from 'vitest';
import { DeathCareService, DEATH_CARE } from '../DeathCareService';

describe('DeathCareService', () => {
  it('should create instance with no facilities', () => {
    const dc = new DeathCareService();
    expect(dc.getCemeteries()).toHaveLength(0);
    expect(dc.getUnprocessed()).toBe(0);
  });

  it('should add a cemetery with default capacity and processRate', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 10);
    expect(id).toBeTruthy();
    const cemeteries = dc.getCemeteries();
    expect(cemeteries).toHaveLength(1);
    expect(cemeteries[0]!.x).toBe(5);
    expect(cemeteries[0]!.y).toBe(10);
    expect(cemeteries[0]!.capacity).toBe(500);
    expect(cemeteries[0]!.processRate).toBe(5);
    expect(cemeteries[0]!.used).toBe(0);
  });

  it('should add a cemetery with custom capacity and processRate', () => {
    const dc = new DeathCareService();
    dc.addCemetery(3, 7, 200, 10);
    const cem = dc.getCemeteries()[0]!;
    expect(cem.capacity).toBe(200);
    expect(cem.processRate).toBe(10);
  });

  it('should register deaths via reportDeath()', () => {
    const dc = new DeathCareService();
    dc.reportDeath();
    dc.reportDeath();
    dc.reportDeath();
    expect(dc.getUnprocessed()).toBe(3);
  });

  // Cemetery tick: first cremate (processRate), then store remainder in used slots
  it('should cremate deaths first up to processRate per tick', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 3);
    for (let i = 0; i < 8; i++) dc.reportDeath();

    dc.tick(); // cremate 3, store remaining 5 in cemetery
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.used).toBe(5);
  });

  it('should cremate stored bodies over time (used decreases)', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 3);
    for (let i = 0; i < 8; i++) dc.reportDeath();

    dc.tick(); // cremate 3 from pending, store 5
    expect(dc.getCemeteries()[0]!.used).toBe(5);

    dc.tick(); // cremate 3 from stored, used = 2
    expect(dc.getCemeteries()[0]!.used).toBe(2);

    dc.tick(); // cremate 2 from stored, used = 0
    expect(dc.getCemeteries()[0]!.used).toBe(0);
  });

  it('should overflow when cemetery storage is full', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 3, 1); // capacity 3, processRate 1
    for (let i = 0; i < 6; i++) dc.reportDeath();

    dc.tick(); // cremate 1 from pending, store 3 (full), 2 remain unprocessed
    expect(dc.getCemeteries()[0]!.used).toBe(3);
    expect(dc.getUnprocessed()).toBe(2);
  });

  it('should process across multiple ticks correctly', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 3);
    for (let i = 0; i < 10; i++) dc.reportDeath();

    dc.tick(); // cremate 3, store 7
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.used).toBe(7);

    dc.tick(); // cremate 3 from stored, used = 4
    expect(dc.getCemeteries()[0]!.used).toBe(4);

    dc.tick(); // cremate 3, used = 1
    expect(dc.getCemeteries()[0]!.used).toBe(1);

    dc.tick(); // cremate 1, used = 0
    expect(dc.getCemeteries()[0]!.used).toBe(0);
  });

  it('should handle multiple cemeteries', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 5, 2);
    dc.addCemetery(1, 1, 5, 3);

    for (let i = 0; i < 20; i++) dc.reportDeath();

    // cremate 2+3=5 from pending, store up to 5+5=10, 5 remain unprocessed
    dc.tick();
    expect(dc.getUnprocessed()).toBe(5);
    const cems = dc.getCemeteries();
    expect(cems[0]!.used + cems[1]!.used).toBe(10);
  });

  it('should return happiness penalty of -20 when unprocessed deaths exist', () => {
    const dc = new DeathCareService();
    expect(dc.getHappinessPenalty()).toBe(0);

    dc.reportDeath();
    expect(dc.getHappinessPenalty()).toBe(-20);
  });

  it('should return 0 penalty when all deaths are processed', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 10);
    dc.reportDeath();
    dc.tick();
    expect(dc.getHappinessPenalty()).toBe(0);
  });

  it('should remove a cemetery by id', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 5);
    expect(dc.getCemeteries()).toHaveLength(1);
    const removed = dc.removeCemetery(id);
    expect(removed).toBe(true);
    expect(dc.getCemeteries()).toHaveLength(0);
  });

  it('should return false when removing non-existent cemetery', () => {
    const dc = new DeathCareService();
    expect(dc.removeCemetery('nonexistent')).toBe(false);
  });

  it('should serialize to JSON and deserialize back including ring buffer', () => {
    const dc = new DeathCareService();
    dc.addCemetery(1, 2, 300, 7);
    dc.reportDeath();
    dc.reportDeath();
    dc.reportDeath();
    dc.tick();
    dc.advanceDay();

    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);

    // fromJSON preserves saved values (migration handles constant updates)
    const cem = restored.getCemeteries()[0]!;
    expect(cem.capacity).toBe(300);
    expect(cem.processRate).toBe(7);
    expect(cem.x).toBe(1);
    expect(cem.y).toBe(2);
    expect(restored.getUnprocessed()).toBe(dc.getUnprocessed());
    // Ring buffer should survive serialization
    expect(cem.recentDaily).toHaveLength(30);
    expect(cem.recentDaily[0]).toBe(3);
  });

  it('fromJSON should handle legacy saves missing ring buffer fields', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 3, processRate: 5 }],
      pendingDeaths: 1,
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    const cem = restored.getCemeteries()[0]!;
    expect(cem.recentDaily).toHaveLength(30);
    expect(cem.recentDaily.every(v => v === 0)).toBe(true);
    expect(cem.recentIndex).toBe(0);
    expect(cem.todayCremated).toBe(0);
    // Should not throw on advanceDay
    restored.advanceDay();
  });

  it('should recover nextId correctly after deserialization', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0);
    dc.addCemetery(1, 1);
    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);
    const newId = restored.addCemetery(2, 2);
    expect(newId).toBe('cem-3');
  });

  it('should track todayCremated during tick', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 3);
    for (let i = 0; i < 5; i++) dc.reportDeath();

    dc.tick(); // cremate 3 from pending, store 2
    expect(dc.getCemeteries()[0]!.todayCremated).toBe(3);

    dc.tick(); // cremate 2 from stored
    expect(dc.getCemeteries()[0]!.todayCremated).toBe(5); // accumulated within same day
  });

  it('advanceDay should rotate ring buffer and reset todayCremated', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 5);
    for (let i = 0; i < 3; i++) dc.reportDeath();
    dc.tick(); // cremate 3, todayCremated=3

    dc.advanceDay(); // flush to ring buffer
    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBe(0);
    expect(cem.recentDaily[0]).toBe(3);
  });

  it('getRecentMonthly should sum last 30 days of cremations', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 10);

    // Simulate 5 days with 2 cremations each
    for (let day = 0; day < 5; day++) {
      dc.reportDeath();
      dc.reportDeath();
      dc.tick();
      dc.advanceDay();
    }

    const cem = dc.getCemeteries()[0]!;
    const recent = cem.recentDaily.reduce((a, b) => a + b, 0);
    expect(recent).toBe(10); // 5 days × 2
  });

  it('ring buffer should roll over after 30 days', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 10);

    // Fill 30 days with 1 cremation each
    for (let day = 0; day < 30; day++) {
      dc.reportDeath();
      dc.tick();
      dc.advanceDay();
    }
    const cem = dc.getCemeteries()[0]!;
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(30);

    // Day 31: 1 more cremation — oldest day (day 0) gets overwritten
    dc.reportDeath();
    dc.tick();
    dc.advanceDay();
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(30); // still 30, not 31
  });

  it('should not tick when pendingDeaths is 0 and no stored bodies', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 5);
    dc.tick(); // no-op
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.used).toBe(0);
  });

  it('should calculate maintenance cost per cemetery', () => {
    const dc = new DeathCareService();
    expect(dc.getMaintenanceCost()).toBe(0);
    dc.addCemetery(5, 5);
    expect(dc.getMaintenanceCost()).toBe(2);
    dc.addCemetery(10, 10);
    expect(dc.getMaintenanceCost()).toBe(4);
  });
});
