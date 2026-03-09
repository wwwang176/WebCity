import { describe, it, expect } from 'vitest';
import { PoliceService } from '../PoliceService';

describe('PoliceService', () => {
  it('should create a PoliceService instance', () => {
    const police = new PoliceService();
    expect(police).toBeDefined();
  });

  it('should add a station and return an id', () => {
    const police = new PoliceService();
    const id = police.addStation(10, 10, 15);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should report coverage within station radius', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.tick();
    // Same position as station
    expect(police.getCoverage(10, 10)).toBe(true);
    // Within radius (distance = 5)
    expect(police.getCoverage(15, 10)).toBe(true);
    expect(police.getCoverage(10, 15)).toBe(true);
    // Diagonal within radius (distance ~7.07)
    expect(police.getCoverage(15, 15)).toBe(true);
  });

  it('should NOT report coverage outside station radius', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.tick();
    // Far away (distance = 20)
    expect(police.getCoverage(30, 10)).toBe(false);
    expect(police.getCoverage(10, 30)).toBe(false);
    // Just outside (distance ~15.6)
    expect(police.getCoverage(21, 21)).toBe(false);
  });

  it('should handle multiple stations with overlapping coverage', () => {
    const police = new PoliceService();
    police.addStation(0, 0, 15);
    police.addStation(20, 0, 15);
    police.tick();
    // Covered by first station
    expect(police.getCoverage(5, 0)).toBe(true);
    // Covered by second station
    expect(police.getCoverage(25, 0)).toBe(true);
    // Covered by both (overlap zone)
    expect(police.getCoverage(10, 0)).toBe(true);
    // Not covered by either
    expect(police.getCoverage(50, 50)).toBe(false);
  });

  it('should return crime reduction -30 within coverage', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.tick();
    expect(police.getCrimeReduction(10, 10)).toBe(-30);
    expect(police.getCrimeReduction(15, 10)).toBe(-30);
  });

  it('should return crime reduction 0 outside coverage', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.tick();
    expect(police.getCrimeReduction(50, 50)).toBe(0);
  });

  it('should stack crime reduction from multiple stations up to -60', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.addStation(12, 10, 15);
    police.tick();
    // Covered by both stations → -60
    expect(police.getCrimeReduction(11, 10)).toBe(-60);
  });

  it('should cap crime reduction at -60 even with 3+ stations', () => {
    const police = new PoliceService();
    police.addStation(10, 10, 15);
    police.addStation(12, 10, 15);
    police.addStation(14, 10, 15);
    police.tick();
    // All three cover this point, but cap is -60
    expect(police.getCrimeReduction(12, 10)).toBe(-60);
  });

  it('should remove station and coverage disappears', () => {
    const police = new PoliceService();
    const id = police.addStation(10, 10, 15);
    police.tick();
    expect(police.getCoverage(10, 10)).toBe(true);

    police.removeStation(id);
    police.tick();
    expect(police.getCoverage(10, 10)).toBe(false);
    expect(police.getCrimeReduction(10, 10)).toBe(0);
  });

  it('should update coverage map on tick()', () => {
    const police = new PoliceService();
    // Before adding station, no coverage
    police.tick();
    expect(police.getCoverage(10, 10)).toBe(false);

    // Add station and tick
    police.addStation(10, 10, 15);
    police.tick();
    expect(police.getCoverage(10, 10)).toBe(true);
  });

  it('should serialize to JSON and deserialize back', () => {
    const police = new PoliceService();
    const id1 = police.addStation(10, 10, 15);
    const id2 = police.addStation(20, 20, 10);
    police.tick();

    const json = police.toJSON();
    const restored = PoliceService.fromJSON(json);
    restored.tick();

    // Same coverage
    expect(restored.getCoverage(10, 10)).toBe(true);
    expect(restored.getCoverage(20, 20)).toBe(true);
    expect(restored.getCoverage(50, 50)).toBe(false);

    // Same crime reduction
    expect(restored.getCrimeReduction(10, 10)).toBe(-30);
  });

  it('should use default radius of 15 when not specified', () => {
    const police = new PoliceService();
    police.addStation(10, 10);
    police.tick();
    // Within default radius of 15
    expect(police.getCoverage(20, 10)).toBe(true);
    // Outside default radius (distance = 16)
    expect(police.getCoverage(26, 10)).toBe(false);
  });
});
