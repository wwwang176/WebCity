import { describe, it, expect } from 'vitest';
import { ParkService, PARK } from '../ParkService';

describe('ParkService', () => {
  it('should create an instance with no parks', () => {
    const ps = new ParkService();
    expect(ps.getParks()).toHaveLength(0);
  });

  it('addPark should add a park and return an id', () => {
    const ps = new ParkService();
    const id = ps.addPark(10, 10, 5);
    expect(typeof id).toBe('string');
    expect(ps.getParks()).toHaveLength(1);
    expect(ps.getParks()[0]).toEqual({ id, x: 10, y: 10, radius: 5 });
  });

  it('addPark should use default radius 5', () => {
    const ps = new ParkService();
    const id = ps.addPark(10, 10);
    expect(ps.getParks()[0]!.radius).toBe(5);
  });

  describe('getCoverage', () => {
    it('should return true for cells within park radius', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getCoverage(10, 10)).toBe(true); // center
      expect(ps.getCoverage(10, 14)).toBe(true); // 4 tiles away (within 5)
      expect(ps.getCoverage(13, 10)).toBe(true); // 3 tiles away
    });

    it('should return false for cells outside park radius', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getCoverage(10, 16)).toBe(false); // 6 tiles away
      expect(ps.getCoverage(20, 20)).toBe(false); // far away
    });

    it('should use Euclidean distance for coverage', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      // distance = sqrt(3^2 + 4^2) = 5, exactly at boundary → covered
      expect(ps.getCoverage(13, 14)).toBe(true);
      // distance = sqrt(4^2 + 4^2) = ~5.66, outside
      expect(ps.getCoverage(14, 14)).toBe(false);
    });
  });

  describe('getLandValueBonus', () => {
    it('should return +15 within a single park', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getLandValueBonus(10, 10)).toBe(15);
      expect(ps.getLandValueBonus(12, 10)).toBe(15);
    });

    it('should return 0 outside park coverage', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getLandValueBonus(20, 20)).toBe(0);
    });

    it('should stack for overlapping parks with cap of +30', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      ps.addPark(12, 10, 5); // overlapping
      // Cell (11, 10) is within both parks
      expect(ps.getLandValueBonus(11, 10)).toBe(30); // 15 + 15, capped at 30

      // Add a third overlapping park
      ps.addPark(11, 10, 5);
      // Should still be capped at 30
      expect(ps.getLandValueBonus(11, 10)).toBe(30);
    });
  });

  describe('getPollutionReduction', () => {
    it('should return -20 within a single park', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getPollutionReduction(10, 10)).toBe(-20);
    });

    it('should return 0 outside park coverage', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getPollutionReduction(20, 20)).toBe(0);
    });

    it('should stack for overlapping parks with cap of -40', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      ps.addPark(12, 10, 5);
      expect(ps.getPollutionReduction(11, 10)).toBe(-40);

      // Third park, still capped
      ps.addPark(11, 10, 5);
      expect(ps.getPollutionReduction(11, 10)).toBe(-40);
    });
  });

  describe('getHappinessBonus', () => {
    it('should return +5 within a single park', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getHappinessBonus(10, 10)).toBe(5);
    });

    it('should return 0 outside park coverage', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(ps.getHappinessBonus(20, 20)).toBe(0);
    });

    it('should stack for overlapping parks with cap of +10', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      ps.addPark(12, 10, 5);
      expect(ps.getHappinessBonus(11, 10)).toBe(10);

      // Third park, still capped
      ps.addPark(11, 10, 5);
      expect(ps.getHappinessBonus(11, 10)).toBe(10);
    });
  });

  describe('removePark', () => {
    it('should remove a park by id', () => {
      const ps = new ParkService();
      const id = ps.addPark(10, 10, 5);
      expect(ps.getParks()).toHaveLength(1);
      ps.removePark(id);
      expect(ps.getParks()).toHaveLength(0);
    });

    it('should remove coverage effect after park is removed', () => {
      const ps = new ParkService();
      const id = ps.addPark(10, 10, 5);
      expect(ps.getCoverage(10, 10)).toBe(true);
      expect(ps.getLandValueBonus(10, 10)).toBe(15);
      expect(ps.getPollutionReduction(10, 10)).toBe(-20);
      expect(ps.getHappinessBonus(10, 10)).toBe(5);

      ps.removePark(id);

      expect(ps.getCoverage(10, 10)).toBe(false);
      expect(ps.getLandValueBonus(10, 10)).toBe(0);
      expect(ps.getPollutionReduction(10, 10)).toBe(0);
      expect(ps.getHappinessBonus(10, 10)).toBe(0);
    });

    it('should not affect other parks when one is removed', () => {
      const ps = new ParkService();
      const id1 = ps.addPark(10, 10, 5);
      ps.addPark(30, 30, 5);

      ps.removePark(id1);

      expect(ps.getCoverage(10, 10)).toBe(false);
      expect(ps.getCoverage(30, 30)).toBe(true);
    });

    it('should be a no-op for non-existent id', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      ps.removePark('nonexistent');
      expect(ps.getParks()).toHaveLength(1);
    });
  });

  describe('tick', () => {
    it('should not throw when called', () => {
      const ps = new ParkService();
      ps.addPark(10, 10, 5);
      expect(() => ps.tick()).not.toThrow();
    });
  });

  describe('serialization', () => {
    it('toJSON should serialize park data', () => {
      const ps = new ParkService();
      const id1 = ps.addPark(10, 10, 5);
      const id2 = ps.addPark(20, 20, 8);
      const json = ps.toJSON();

      expect(json).toEqual([
        { id: id1, x: 10, y: 10, radius: 5 },
        { id: id2, x: 20, y: 20, radius: 8 },
      ]);
    });

    it('fromJSON should restore park service from data', () => {
      const ps = new ParkService();
      const id1 = ps.addPark(10, 10, 5);
      const id2 = ps.addPark(20, 20, 8);
      const json = ps.toJSON();

      const restored = ParkService.fromJSON(json);

      expect(restored.getParks()).toEqual(ps.getParks());
      expect(restored.getCoverage(10, 10)).toBe(true);
      expect(restored.getCoverage(20, 20)).toBe(true);
      expect(restored.getLandValueBonus(10, 10)).toBe(15);
    });

    it('fromJSON should handle empty data', () => {
      const restored = ParkService.fromJSON([]);
      expect(restored.getParks()).toHaveLength(0);
    });
  });
});

describe('PARK constants', () => {
  it('land value per park should be positive', () => {
    expect(PARK.LAND_VALUE_PER_PARK).toBeGreaterThan(0);
  });

  it('land value cap should be >= land value per park', () => {
    expect(PARK.LAND_VALUE_CAP).toBeGreaterThanOrEqual(PARK.LAND_VALUE_PER_PARK);
  });

  it('pollution per park should be negative (reduction)', () => {
    expect(PARK.POLLUTION_PER_PARK).toBeLessThan(0);
  });

  it('pollution cap should be <= pollution per park', () => {
    expect(PARK.POLLUTION_CAP).toBeLessThanOrEqual(PARK.POLLUTION_PER_PARK);
  });

  it('happiness per park should be positive', () => {
    expect(PARK.HAPPINESS_PER_PARK).toBeGreaterThan(0);
  });

  it('happiness cap should be >= happiness per park', () => {
    expect(PARK.HAPPINESS_CAP).toBeGreaterThanOrEqual(PARK.HAPPINESS_PER_PARK);
  });
});
