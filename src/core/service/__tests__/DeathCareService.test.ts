import { describe, it, expect } from 'vitest';
import { DeathCareService } from '../DeathCareService';

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

  it('should serialize to JSON and deserialize back', () => {
    const dc = new DeathCareService();
    dc.addCemetery(1, 2, 300, 7);
    dc.reportDeath();
    dc.reportDeath();
    dc.reportDeath();
    dc.tick();

    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);

    expect(restored.getCemeteries()).toEqual(dc.getCemeteries());
    expect(restored.getUnprocessed()).toBe(dc.getUnprocessed());
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
