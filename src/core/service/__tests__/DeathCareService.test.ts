import { describe, it, expect } from 'vitest';
import { DeathCareService } from '../DeathCareService';

describe('DeathCareService', () => {
  it('should create instance with no facilities', () => {
    const dc = new DeathCareService();
    expect(dc.getCemeteries()).toHaveLength(0);
    expect(dc.getCrematoria()).toHaveLength(0);
    expect(dc.getUnprocessed()).toBe(0);
  });

  it('should add a cemetery with default capacity', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 10);
    expect(id).toBeTruthy();
    const cemeteries = dc.getCemeteries();
    expect(cemeteries).toHaveLength(1);
    expect(cemeteries[0]!.x).toBe(5);
    expect(cemeteries[0]!.y).toBe(10);
    expect(cemeteries[0]!.capacity).toBe(500);
    expect(cemeteries[0]!.used).toBe(0);
  });

  it('should add a cemetery with custom capacity', () => {
    const dc = new DeathCareService();
    dc.addCemetery(3, 7, 200);
    expect(dc.getCemeteries()[0]!.capacity).toBe(200);
  });

  it('should add a crematorium with default capacity and processRate', () => {
    const dc = new DeathCareService();
    const id = dc.addCrematorium(2, 4);
    expect(id).toBeTruthy();
    const crematoria = dc.getCrematoria();
    expect(crematoria).toHaveLength(1);
    expect(crematoria[0]!.x).toBe(2);
    expect(crematoria[0]!.y).toBe(4);
    expect(crematoria[0]!.capacity).toBe(100);
    expect(crematoria[0]!.processRate).toBe(5);
  });

  it('should add a crematorium with custom capacity and processRate', () => {
    const dc = new DeathCareService();
    dc.addCrematorium(1, 1, 50, 10);
    const c = dc.getCrematoria()[0]!;
    expect(c.capacity).toBe(50);
    expect(c.processRate).toBe(10);
  });

  it('should register deaths via reportDeath()', () => {
    const dc = new DeathCareService();
    dc.reportDeath();
    dc.reportDeath();
    dc.reportDeath();
    expect(dc.getUnprocessed()).toBe(3);
  });

  it('should process deaths in tick() using crematorium processRate', () => {
    const dc = new DeathCareService();
    dc.addCrematorium(0, 0, 100, 5);
    for (let i = 0; i < 10; i++) dc.reportDeath();
    expect(dc.getUnprocessed()).toBe(10);

    dc.tick(); // should process 5
    expect(dc.getUnprocessed()).toBe(5);

    dc.tick(); // should process remaining 5
    expect(dc.getUnprocessed()).toBe(0);
  });

  it('should bury in cemetery when crematorium is at capacity', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 10);
    dc.addCrematorium(1, 1, 100, 3);
    for (let i = 0; i < 8; i++) dc.reportDeath();

    dc.tick(); // crematorium processes 3, cemetery buries remaining 5
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.used).toBe(5);
  });

  it('should not exceed cemetery capacity', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 3);
    // No crematorium
    for (let i = 0; i < 5; i++) dc.reportDeath();

    dc.tick(); // cemetery can bury 3, 2 remain unprocessed
    expect(dc.getUnprocessed()).toBe(2);
    expect(dc.getCemeteries()[0]!.used).toBe(3);
  });

  it('should return happiness penalty of -20 when unprocessed deaths exist', () => {
    const dc = new DeathCareService();
    expect(dc.getHappinessPenalty()).toBe(0);

    dc.reportDeath();
    expect(dc.getHappinessPenalty()).toBe(-20);
  });

  it('should return 0 penalty when all deaths are processed', () => {
    const dc = new DeathCareService();
    dc.addCrematorium(0, 0, 100, 10);
    dc.reportDeath();
    dc.tick();
    expect(dc.getHappinessPenalty()).toBe(0);
  });

  it('should indicate when cemetery is full (needs more facilities)', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 2);
    dc.reportDeath();
    dc.reportDeath();
    dc.tick(); // fills cemetery to 2/2
    expect(dc.getCemeteries()[0]!.used).toBe(2);

    // More deaths arrive, no crematorium, cemetery full
    dc.reportDeath();
    dc.tick();
    expect(dc.getUnprocessed()).toBe(1); // cannot bury, remains unprocessed
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

  it('should remove a crematorium by id', () => {
    const dc = new DeathCareService();
    const id = dc.addCrematorium(3, 3);
    expect(dc.getCrematoria()).toHaveLength(1);
    const removed = dc.removeCrematorium(id);
    expect(removed).toBe(true);
    expect(dc.getCrematoria()).toHaveLength(0);
  });

  it('should return false when removing non-existent crematorium', () => {
    const dc = new DeathCareService();
    expect(dc.removeCrematorium('nonexistent')).toBe(false);
  });

  it('should serialize to JSON and deserialize back', () => {
    const dc = new DeathCareService();
    dc.addCemetery(1, 2, 300);
    dc.addCrematorium(3, 4, 80, 7);
    dc.reportDeath();
    dc.reportDeath();
    dc.reportDeath();
    dc.tick(); // process some deaths

    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);

    expect(restored.getCemeteries()).toEqual(dc.getCemeteries());
    expect(restored.getCrematoria()).toEqual(dc.getCrematoria());
    expect(restored.getUnprocessed()).toBe(dc.getUnprocessed());
  });

  it('should handle multiple cemeteries and crematoriums', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 5);
    dc.addCemetery(1, 1, 5);
    dc.addCrematorium(2, 2, 100, 2);
    dc.addCrematorium(3, 3, 100, 3);

    for (let i = 0; i < 20; i++) dc.reportDeath();

    dc.tick(); // crematoriums process 2+3=5, cemeteries bury up to 5+5=10, total=15 processed
    expect(dc.getUnprocessed()).toBe(5);
  });

  it('should process across multiple ticks correctly', () => {
    const dc = new DeathCareService();
    dc.addCrematorium(0, 0, 100, 3);
    for (let i = 0; i < 10; i++) dc.reportDeath();

    dc.tick(); // process 3, remaining 7 buried? no cemetery, so 7 unprocessed
    expect(dc.getUnprocessed()).toBe(7);
    dc.tick(); // process 3 more, remaining 4
    expect(dc.getUnprocessed()).toBe(4);
    dc.tick(); // process 3 more, remaining 1
    expect(dc.getUnprocessed()).toBe(1);
    dc.tick(); // process 1
    expect(dc.getUnprocessed()).toBe(0);
  });
});
