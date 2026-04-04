import { describe, it, expect } from 'vitest';
import { SewageService, SEWAGE } from '../SewageService';

describe('SewageService', () => {
  it('should create an instance with default state', () => {
    const sewage = new SewageService();
    expect(sewage.getUntreated()).toBe(0);
    expect(sewage.getWaterPollution()).toBe(0);
    expect(sewage.getTreatmentCapacity()).toBe(0);
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
    sewage.produceSewage(10);
    expect(sewage.getUntreated()).toBe(10);
  });

  it('should treat sewage when treatment plant exists', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(5);
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should have untreated sewage when no treatment plant', () => {
    const sewage = new SewageService();
    sewage.tick(5);
    expect(sewage.getUntreated()).toBe(5);
  });

  it('should cause water pollution when sewage is untreated', () => {
    const sewage = new SewageService();
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
    sewage.addTreatmentPlant(3, 4, 5);
    sewage.tick(10);
    expect(sewage.getUntreated()).toBe(5);
    expect(sewage.getWaterPollution()).toBeGreaterThan(0);
  });

  it('should aggregate capacity from multiple treatment plants', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(0, 0, 100);
    sewage.addTreatmentPlant(5, 5, 100);
    expect(sewage.getTreatmentCapacity()).toBe(200);
    sewage.tick(15);
    expect(sewage.getUntreated()).toBe(0);
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
    sewage.tick(3);
    expect(sewage.getUntreated()).toBe(0);
    expect(sewage.getWaterPollution()).toBe(0);
  });

  it('should serialize and deserialize correctly', () => {
    const sewage = new SewageService();
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
    sewage.tick(10);
    expect(sewage.getUntreated()).toBe(10);
    sewage.addTreatmentPlant(0, 0, 200);
    sewage.tick(10);
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should generate pollution from unsupplied buildings', () => {
    const sewage = new SewageService();
    sewage.reportSewage(5, 10, 10);
    sewage.tick(10);
    const sources = sewage.getPollutionSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.x).toBe(5);
    expect(sources[0]!.y).toBe(10);
    expect(sources[0]!.type).toBe('water');
    expect(sources[0]!.amount).toBeGreaterThan(0);
  });

  it('should generate no pollution sources when sewage is treated', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(5);
    const sources = sewage.getPollutionSources();
    expect(sources).toHaveLength(0);
  });

  it('should cap pollution per cell', () => {
    const sewage = new SewageService();
    sewage.reportSewage(0, 0, 1000);
    sewage.tick(1000);
    const sources = sewage.getPollutionSources();
    expect(sources[0]!.amount).toBeLessThanOrEqual(SEWAGE.MAX_POLLUTION_PER_CELL);
  });

  it('SEWAGE_RATE constants should be between 0 and 1', () => {
    for (const rate of Object.values(SEWAGE.SEWAGE_RATE)) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});
