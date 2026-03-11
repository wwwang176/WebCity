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

  it('should add a treatment plant with default capacity 200', () => {
    const sewage = new SewageService();
    const id = sewage.addTreatmentPlant(3, 4);
    expect(id).toBeTruthy();
    expect(sewage.getTreatmentCapacity()).toBe(200);
  });

  it('should add a treatment plant with custom capacity', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 500);
    expect(sewage.getTreatmentCapacity()).toBe(500);
  });

  it('should produce 1 unit sewage per 100 population', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.produceSewage(100);
    expect(sewage.getUntreated()).toBe(1);
  });

  it('should produce 0 units for population < 100', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.produceSewage(50);
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should produce multiple units for large population', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.produceSewage(550);
    expect(sewage.getUntreated()).toBe(5);
  });

  it('should treat sewage when treatment plant exists', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(500); // produces 5 units, capacity 200 > 5
    expect(sewage.getUntreated()).toBe(0);
  });

  it('should have untreated sewage when no treatment plant', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(500); // produces 5 units, no treatment
    expect(sewage.getUntreated()).toBe(5);
  });

  it('should cause water pollution when sewage is untreated', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(1000); // produces 10 units untreated
    expect(sewage.getWaterPollution()).toBeGreaterThan(0);
  });

  it('should have zero water pollution when all sewage is treated', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 200);
    sewage.tick(500);
    expect(sewage.getWaterPollution()).toBe(0);
  });

  it('should partially treat sewage when capacity is insufficient', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(3, 4, 5); // capacity 5
    sewage.addOutlet(0, 0);
    sewage.tick(1000); // produces 10 units, only 5 treated
    expect(sewage.getUntreated()).toBe(5);
    expect(sewage.getWaterPollution()).toBeGreaterThan(0);
  });

  it('should aggregate capacity from multiple treatment plants', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(0, 0, 100);
    sewage.addTreatmentPlant(5, 5, 100);
    expect(sewage.getTreatmentCapacity()).toBe(200);
    sewage.tick(1500); // produces 15 units, capacity 200 > 15
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

  it('tick should auto-produce and process sewage', () => {
    const sewage = new SewageService();
    sewage.addTreatmentPlant(0, 0, 10);
    sewage.tick(300); // produces 3, capacity 10 > 3
    expect(sewage.getUntreated()).toBe(0);
    expect(sewage.getWaterPollution()).toBe(0);
  });

  it('should serialize and deserialize correctly', () => {
    const sewage = new SewageService();
    sewage.addOutlet(1, 2);
    sewage.addTreatmentPlant(3, 4, 300);
    sewage.tick(500); // produces 5, capacity 300 > 5

    const json = sewage.toJSON();
    const restored = SewageService.fromJSON(json);

    expect(restored.getTreatmentCapacity()).toBe(300);
    expect(restored.getUntreated()).toBe(sewage.getUntreated());
    expect(restored.getWaterPollution()).toBe(sewage.getWaterPollution());
  });

  it('should reset untreated sewage each tick', () => {
    const sewage = new SewageService();
    sewage.addOutlet(0, 0);
    sewage.tick(1000); // produces 10, no treatment
    expect(sewage.getUntreated()).toBe(10);
    sewage.addTreatmentPlant(0, 0, 200);
    sewage.tick(1000); // produces 10, capacity 200 > 10
    expect(sewage.getUntreated()).toBe(0);
  });
});

describe('SEWAGE constants', () => {
  it('pop per sewage should be positive', () => {
    expect(SEWAGE.POP_PER_SEWAGE).toBeGreaterThan(0);
  });

  it('water pollution multiplier should be positive', () => {
    expect(SEWAGE.WATER_POLLUTION_MULTIPLIER).toBeGreaterThan(0);
  });

  it('maintenance per plant should be positive', () => {
    expect(SEWAGE.MAINTENANCE_PER_PLANT).toBeGreaterThan(0);
  });
});
