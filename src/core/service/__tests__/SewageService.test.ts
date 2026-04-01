import { describe, it, expect } from 'vitest';
import { SewageService, SEWAGE } from '../SewageService';

describe('SewageService', () => {
  it('should create an instance with default state', () => {
    const sewage = new SewageService();
    expect(sewage.getUntreated()).toBe(0);
    expect(sewage.getWaterPollution()).toBe(0);
    expect(sewage.getTreatmentCapacity()).toBe(0);
  });

  it('should add an outlet and return an id', () => {
    const sewage = new SewageService();
    const id = sewage.addOutlet(5, 10);
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('should add a treatment plant with default capacity', () => {
    const sewage = new SewageService();
    const id = sewage.addTreatmentPlant(3, 4);
    expect(id).toBeTruthy();
    expect(sewage.getTreatmentCapacity()).toBe(SEWAGE.DEFAULT_CAPACITY);
  });

  it('should add a treatment plant with custom capacity', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 500);
    expect(sewage.getTreatmentCapacity()).toBe(500);
  });

  it('should accumulate sewage from produceSewage', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.produceSewage(10);
    expect(sewage.getUntreated()).toBe(10);
  });

  it('should treat sewage when treatment plant exists', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(5); // 5 units produced, capacity 200 > 5
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should have untreated sewage when no treatment plant', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(5); // 5 units, no treatment
    expect(sewage.getUntreated()).toBe(5);
  });

  it('should cause water pollution when sewage is untreated', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(10);
    expect(sewage.getWaterPollution()).toBe(10 * SEWAGE.WATER_POLLUTION_MULTIPLIER);
  });

  it('should have zero water pollution when all sewage is treated', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(5);
    expect(sewage.getWaterPollution()).toBe(0);
  });

  it('should partially treat sewage when capacity is insufficient', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 5); // capacity 5
    sewage.addOutlet(0, 0);
    sewage.tick(10); // 10 produced, only 5 treated
    expect(sewage.getUntreated()).toBe(5);
    expect(sewage.getWaterPollution()).toBeGreaterThan(0);
  });

  it('should aggregate capacity from multiple treatment plants', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(0, 0, 100);
    sewage.addTreatmentPlant(5, 5, 100);
    expect(sewage.getTreatmentCapacity()).toBe(200);
    sewage.tick(15); // 15 units, capacity 200 > 15
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should remove an outlet by id', () => {
    const sewage = new SewageService();
    const id = sewage.addOutlet(5, 5);
    expect(sewage.removeOutlet(id)).toBe(true);
    expect(sewage.removeOutlet(id)).toBe(false);
  });

  it('should remove a treatment plant by id', () => {
    const sewage = new SewageService();
    const id = sewage.addTreatmentPlant(3, 4, 200);
    expect(sewage.removeTreatmentPlant(id)).toBe(true);
    expect(sewage.getTreatmentCapacity()).toBe(0);
    expect(sewage.removeTreatmentPlant(id)).toBe(false);
  });

  it('tick should process sewage against capacity', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(0, 0, 10);
    sewage.tick(3); // 3 produced, capacity 10 > 3
    expect(sewage.getUntreated()).toBe(0);
    expect(sewage.getWaterPollution()).toBe(0);
  });

  it('should serialize and deserialize correctly', () => {
    const sewage = new SewageService();
    sewage.addOutlet(1, 2);
    sewage.addTreatmentPlant(3, 4, 300);
    sewage.tick(5);

    const json = sewage.toJSON();
    const restored = SewageService.fromJSON(json);

    expect(restored.getTreatmentCapacity()).toBe(300);
    expect(restored.getUntreated()).toBe(sewage.getUntreated());
    expect(restored.getWaterPollution()).toBe(sewage.getWaterPollution());
  });

  it('should reset untreated sewage each tick', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(10); // 10 produced, no treatment
    expect(sewage.getUntreated()).toBe(10);
    sewage.addTreatmentPlant(0, 0, 200);
    sewage.tick(10); // 10 produced, capacity 200 > 10
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should generate pollution sources from outlets', () => {
    const sewage = new SewageService();
    sewage.addOutlet(5, 10);
    sewage.tick(10); // untreated
    const sources = sewage.getPollutionSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.x).toBe(5);
    expect(sources[0]!.y).toBe(10);
    expect(sources[0]!.type).toBe('water');
    expect(sources[0]!.amount).toBeGreaterThan(0);
  });

  it('should generate no pollution sources when sewage is treated', () => {
    const sewage = new SewageService();
    sewage.addOutlet(5, 10);
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(5);
    const sources = sewage.getPollutionSources();
    expect(sources).toHaveLength(0);
  });

  it('should cap pollution per outlet', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(1000); // massive sewage
    const sources = sewage.getPollutionSources();
    expect(sources[0]!.amount).toBeLessThanOrEqual(SEWAGE.MAX_POLLUTION_PER_OUTLET);
  });

  it('SEWAGE_RATE constants should be between 0 and 1', () => {
    for (const rate of Object.values(SEWAGE.SEWAGE_RATE)) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});
