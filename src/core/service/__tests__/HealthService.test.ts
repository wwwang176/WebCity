import { describe, it, expect } from 'vitest';
import { HealthService } from '../HealthService';

describe('HealthService', () => {
  it('should create an instance', () => {
    const health = new HealthService();
    expect(health).toBeDefined();
  });

  it('should add a hospital and return an id', () => {
    const health = new HealthService();
    const id = health.addHospital(10, 10);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should add a hospital with default radius=12 and capacity=100', () => {
    const health = new HealthService();
    health.addHospital(10, 10);
    const hospitals = health.getHospitals();
    expect(hospitals).toHaveLength(1);
    expect(hospitals[0]!.x).toBe(10);
    expect(hospitals[0]!.y).toBe(10);
    expect(hospitals[0]!.radius).toBe(12);
    expect(hospitals[0]!.capacity).toBe(100);
  });

  it('should add a hospital with custom radius and capacity', () => {
    const health = new HealthService();
    health.addHospital(5, 5, 20, 200);
    const hospitals = health.getHospitals();
    expect(hospitals[0]!.radius).toBe(20);
    expect(hospitals[0]!.capacity).toBe(200);
  });

  it('getCoverage should return true for positions within hospital radius', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getCoverage(10, 10)).toBe(true); // at hospital
    expect(health.getCoverage(15, 10)).toBe(true); // 5 away (< 12)
    expect(health.getCoverage(10, 20)).toBe(true); // 10 away (< 12)
  });

  it('getCoverage should return false for positions outside hospital radius', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getCoverage(10, 30)).toBe(false); // 20 away (> 12)
    expect(health.getCoverage(30, 30)).toBe(false); // far away
  });

  it('getHealthBonus should return +20 for positions within coverage', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getHealthBonus(10, 10)).toBe(20);
    expect(health.getHealthBonus(15, 10)).toBe(20);
  });

  it('getHealthBonus should return 0 for positions outside coverage', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getHealthBonus(50, 50)).toBe(0);
  });

  it('multiple hospitals should stack health bonus up to cap of 35', () => {
    const health = new HealthService();
    // Place two hospitals with overlapping coverage
    health.addHospital(10, 10, 12);
    health.addHospital(12, 10, 12);
    health.tick();
    // Position (11, 10) is within range of both hospitals
    expect(health.getCoverage(11, 10)).toBe(true);
    expect(health.getHealthBonus(11, 10)).toBe(35); // 20+20=40 capped at 35
  });

  it('multiple hospitals with non-overlapping coverage give +20 each independently', () => {
    const health = new HealthService();
    health.addHospital(0, 0, 5);
    health.addHospital(50, 50, 5);
    health.tick();
    expect(health.getHealthBonus(0, 0)).toBe(20);
    expect(health.getHealthBonus(50, 50)).toBe(20);
    expect(health.getHealthBonus(25, 25)).toBe(0); // not covered by either
  });

  it('removeHospital should remove coverage', () => {
    const health = new HealthService();
    const id = health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getCoverage(10, 10)).toBe(true);
    health.removeHospital(id);
    health.tick();
    expect(health.getCoverage(10, 10)).toBe(false);
    expect(health.getHealthBonus(10, 10)).toBe(0);
  });

  it('tick() should update coverage', () => {
    const health = new HealthService();
    // Before tick, no coverage yet
    const id = health.addHospital(10, 10, 12);
    health.tick();
    expect(health.getCoverage(10, 10)).toBe(true);
    // Remove and tick again
    health.removeHospital(id);
    health.tick();
    expect(health.getCoverage(10, 10)).toBe(false);
  });

  it('toJSON() should serialize state', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12, 100);
    health.addHospital(20, 20, 15, 200);
    const json = health.toJSON();
    expect(json.hospitals).toHaveLength(2);
    expect(json.hospitals[0]!.x).toBe(10);
    expect(json.hospitals[0]!.y).toBe(10);
    expect(json.hospitals[0]!.radius).toBe(12);
    expect(json.hospitals[0]!.capacity).toBe(100);
    expect(json.hospitals[1]!.x).toBe(20);
    expect(json.hospitals[1]!.y).toBe(20);
  });

  it('fromJSON() should restore state', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12, 100);
    health.addHospital(50, 50, 15, 200);
    const json = health.toJSON();

    const restored = HealthService.fromJSON(json);
    expect(restored.getHospitals()).toHaveLength(2);
    restored.tick();
    expect(restored.getCoverage(10, 10)).toBe(true);
    expect(restored.getCoverage(50, 50)).toBe(true);
    expect(restored.getHealthBonus(10, 10)).toBe(20);
  });
});
