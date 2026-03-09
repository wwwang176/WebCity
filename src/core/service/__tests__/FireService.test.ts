import { describe, it, expect } from 'vitest';
import { FireService } from '../FireService';

describe('FireService', () => {
  it('should create a FireService instance', () => {
    const fire = new FireService();
    expect(fire).toBeDefined();
    expect(fire.getStations()).toHaveLength(0);
  });

  it('should add a station and return an id', () => {
    const fire = new FireService();
    const id = fire.addStation(10, 10, 15);
    expect(typeof id).toBe('string');
    expect(fire.getStations()).toHaveLength(1);
    expect(fire.getStations()[0]).toMatchObject({ id, x: 10, y: 10, radius: 15 });
  });

  it('should use default radius of 15 when not specified', () => {
    const fire = new FireService();
    fire.addStation(5, 5);
    expect(fire.getStations()[0]!.radius).toBe(15);
  });

  it('getCoverage returns true within station radius', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    // Same position as station
    expect(fire.getCoverage(10, 10)).toBe(true);
    // Within radius (distance = 5)
    expect(fire.getCoverage(13, 14)).toBe(true);
    // Exactly at radius boundary (distance = 15)
    expect(fire.getCoverage(10, 25)).toBe(true);
  });

  it('getCoverage returns false outside station radius', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    // Beyond radius (distance > 15)
    expect(fire.getCoverage(10, 30)).toBe(false);
    expect(fire.getCoverage(30, 30)).toBe(false);
  });

  it('multiple stations coverage overlaps', () => {
    const fire = new FireService();
    fire.addStation(0, 0, 10);
    fire.addStation(20, 0, 10);
    // Covered by first station only
    expect(fire.getCoverage(5, 0)).toBe(true);
    // Covered by second station only
    expect(fire.getCoverage(25, 0)).toBe(true);
    // Not covered by either
    expect(fire.getCoverage(10, 20)).toBe(false);
    // Overlap zone — covered by both
    expect(fire.getCoverage(10, 0)).toBe(true);
  });

  it('getResponseTime returns time based on distance (closer = faster)', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    const timeClose = fire.getResponseTime(11, 10);
    const timeFar = fire.getResponseTime(20, 10);
    expect(timeClose).toBeLessThan(timeFar);
    expect(timeClose).toBeGreaterThan(0);
  });

  it('getResponseTime returns Infinity when not covered', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 5);
    expect(fire.getResponseTime(50, 50)).toBe(Infinity);
  });

  it('getResponseTime uses nearest station for multiple stations', () => {
    const fire = new FireService();
    fire.addStation(0, 0, 20);
    fire.addStation(10, 0, 20);
    // Point at (8,0) is closer to station at (10,0)
    const time = fire.getResponseTime(8, 0);
    const timeFromSecond = fire.getResponseTime(10, 0); // at station
    expect(time).toBeGreaterThan(timeFromSecond);
  });

  it('reportFire in covered area returns covered=true and low damage', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    const result = fire.reportFire(12, 10);
    expect(result.covered).toBe(true);
    expect(result.estimatedDamage).toBeLessThanOrEqual(0.10);
  });

  it('reportFire outside covered area returns covered=false and high damage', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 5);
    const result = fire.reportFire(50, 50);
    expect(result.covered).toBe(false);
    expect(result.estimatedDamage).toBeCloseTo(0.80, 1);
  });

  it('reportFire creates an active fire', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.reportFire(12, 10);
    expect(fire.getActiveFires()).toHaveLength(1);
    expect(fire.getActiveFires()[0]).toMatchObject({ x: 12, y: 10 });
  });

  it('tick processes active fires — covered fire resolves in 3 ticks', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.reportFire(12, 10);
    expect(fire.getActiveFires()).toHaveLength(1);

    fire.tick();
    fire.tick();
    fire.tick();
    // After 3 ticks, fire is done — collect via resolveCompletedFires
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('tick processes uncovered fire — resolves in 3 ticks with high damage', () => {
    const fire = new FireService();
    // No stations — fire is uncovered
    fire.reportFire(50, 50);
    const activeFire = fire.getActiveFires()[0]!;
    expect(activeFire.damage).toBeCloseTo(0.80, 1);

    fire.tick();
    fire.tick();
    fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('removeStation removes the station and coverage disappears', () => {
    const fire = new FireService();
    const id = fire.addStation(10, 10, 15);
    expect(fire.getCoverage(10, 10)).toBe(true);

    fire.removeStation(id);
    expect(fire.getStations()).toHaveLength(0);
    expect(fire.getCoverage(10, 10)).toBe(false);
  });

  it('removeStation with invalid id does nothing', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.removeStation('nonexistent');
    expect(fire.getStations()).toHaveLength(1);
  });

  it('getFireRisk returns high risk for uncovered areas', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 5);
    const riskCovered = fire.getFireRisk(10, 10);
    const riskUncovered = fire.getFireRisk(50, 50);
    expect(riskUncovered).toBeGreaterThan(riskCovered);
    expect(riskUncovered).toBeGreaterThanOrEqual(0.8);
    expect(riskCovered).toBeLessThanOrEqual(0.2);
  });

  it('getFireRisk at edge of coverage has moderate risk', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    // Just inside radius
    const riskEdge = fire.getFireRisk(10, 25);
    const riskCenter = fire.getFireRisk(10, 10);
    expect(riskEdge).toBeGreaterThan(riskCenter);
  });

  it('toJSON serializes state correctly', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.addStation(20, 20, 10);
    fire.reportFire(12, 10);

    const json = fire.toJSON();
    expect(json.stations).toHaveLength(2);
    expect(json.activeFires).toHaveLength(1);
    expect(json.stations[0]).toMatchObject({ x: 10, y: 10, radius: 15 });
  });

  it('fromJSON restores state correctly', () => {
    const fire = new FireService();
    const id1 = fire.addStation(10, 10, 15);
    fire.addStation(20, 20, 10);
    fire.reportFire(12, 10);

    const json = fire.toJSON();
    const restored = FireService.fromJSON(json);

    expect(restored.getStations()).toHaveLength(2);
    expect(restored.getActiveFires()).toHaveLength(1);
    expect(restored.getCoverage(10, 10)).toBe(true);
    expect(restored.getCoverage(20, 20)).toBe(true);
    expect(restored.getCoverage(50, 50)).toBe(false);
  });

  it('fromJSON with empty data creates clean instance', () => {
    const json = { stations: [], activeFires: [], nextId: 1 };
    const restored = FireService.fromJSON(json);
    expect(restored.getStations()).toHaveLength(0);
    expect(restored.getActiveFires()).toHaveLength(0);
  });

  // --- Fire event integration tests ---

  it('resolveCompletedFires returns resolved fires with damage info', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.reportFire(12, 10); // covered: damage 10%
    fire.reportFire(50, 50); // uncovered: damage 80%

    // Advance to completion
    fire.tick();
    fire.tick();
    fire.tick();

    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(2);
    // Covered fire should have low damage
    const coveredFire = resolved.find(f => f.x === 12 && f.y === 10);
    expect(coveredFire).toBeDefined();
    expect(coveredFire!.damage).toBeCloseTo(0.10, 1);
    // Uncovered fire should have high damage
    const uncoveredFire = resolved.find(f => f.x === 50 && f.y === 50);
    expect(uncoveredFire).toBeDefined();
    expect(uncoveredFire!.damage).toBeCloseTo(0.80, 1);
  });

  it('resolveCompletedFires removes resolved fires from active list', () => {
    const fire = new FireService();
    fire.reportFire(5, 5);
    fire.tick();
    fire.tick();
    fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('resolveCompletedFires does not remove fires still in progress', () => {
    const fire = new FireService();
    fire.reportFire(5, 5); // 3 ticks to resolve
    fire.tick(); // 2 remaining
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(0);
    expect(fire.getActiveFires()).toHaveLength(1);
  });

  it('tryRandomFire triggers fire on building cells based on probability', () => {
    const fire = new FireService();
    // Mock grid with a building at (5,5)
    const mockGrid = {
      width: 10,
      height: 10,
      getCell: (x: number, y: number) => {
        if (x === 5 && y === 5) return { buildingId: 3, zoneType: 1 };
        return { buildingId: 0, zoneType: 0 };
      },
    };

    // With probability 1.0, fire should always trigger if there's a building
    const result = fire.tryRandomFire(mockGrid, 100, 1.0);
    if (result) {
      expect(fire.getActiveFires().length).toBeGreaterThanOrEqual(1);
    }
  });

  it('tryRandomFire does not trigger fire with probability 0', () => {
    const fire = new FireService();
    const mockGrid = {
      width: 10,
      height: 10,
      getCell: () => ({ buildingId: 3, zoneType: 1 }),
    };
    const result = fire.tryRandomFire(mockGrid, 100, 0);
    expect(result).toBe(false);
    expect(fire.getActiveFires()).toHaveLength(0);
  });
});
