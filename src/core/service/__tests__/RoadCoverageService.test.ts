import { describe, it, expect } from 'vitest';
import { RoadCoverageService } from '../RoadCoverageService';
import { ROAD_COVERAGE } from '../RoadCoverageFlood';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

interface TestFacility {
  id: string;
  x: number;
  y: number;
}

class TestService extends RoadCoverageService<TestFacility> {
  protected coverageBudget = ROAD_COVERAGE.POLICE_BUDGET;
  protected defaultFacilityWidth = 2;
  protected defaultFacilityHeight = 2;
  protected idPrefix = 'test_';
  protected maintenanceCostPerFacility = 5;

  addFacility(x: number, y: number): string {
    const id = this.generateId();
    this.facilities.push({ id, x, y });
    return id;
  }

  removeFacility(id: string): void {
    this.facilities = this.facilities.filter(f => f.id !== id);
  }

  toJSON() {
    return { facilities: this.facilities.map(f => ({ ...f })) };
  }
}

function makeCrossGrid(size: number, cx: number, cy: number): SizedGrid {
  return {
    width: size,
    height: size,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const isRoad = x === cx || y === cy;
      return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('RoadCoverageService', () => {
  it('getCoverage returns false when no facilities', () => {
    const svc = new TestService();
    expect(svc.getCoverage(5, 5)).toBe(false);
  });

  it('getCoverage returns true after adding facility and ticking with grid', () => {
    const grid = makeCrossGrid(30, 15, 15);
    const svc = new TestService();
    svc.addFacility(14, 15);
    svc.recalculateCoverage(grid);
    expect(svc.getCoverage(15, 15)).toBe(true);
  });

  it('getCostRatio returns -1 when uncovered', () => {
    const svc = new TestService();
    expect(svc.getCostRatio(5, 5)).toBe(-1);
  });

  it('getCoveredCellsWithCost returns a map', () => {
    const grid = makeCrossGrid(30, 15, 15);
    const svc = new TestService();
    svc.addFacility(14, 15);
    svc.recalculateCoverage(grid);
    const cells = svc.getCoveredCellsWithCost();
    expect(cells.size).toBeGreaterThan(0);
  });

  it('previewCoverage returns map for potential placement', () => {
    const grid = makeCrossGrid(30, 15, 15);
    const svc = new TestService();
    const preview = svc.previewCoverage({ x: 14, y: 15 }, grid);
    expect(preview.size).toBeGreaterThan(0);
  });

  it('generateId creates unique ids with correct prefix', () => {
    const svc = new TestService();
    const id1 = svc.addFacility(1, 1);
    const id2 = svc.addFacility(2, 2);
    expect(id1).toMatch(/^test_/);
    expect(id2).toMatch(/^test_/);
    expect(id1).not.toBe(id2);
  });

  it('restoreNextId recovers correct counter', () => {
    const svc = new TestService();
    svc.addFacility(1, 1);
    svc.addFacility(2, 2);
    const json = svc.toJSON();

    const restored = new TestService();
    for (const f of json.facilities) restored.addFacility(f.x, f.y);
    expect(restored.getFacilities()).toHaveLength(2);
  });

  it('getMaintenanceCost returns count * costPerFacility', () => {
    const svc = new TestService();
    expect(svc.getMaintenanceCost()).toBe(0);
    svc.addFacility(1, 1);
    expect(svc.getMaintenanceCost()).toBe(5);
    svc.addFacility(2, 2);
    expect(svc.getMaintenanceCost()).toBe(10);
  });

  it('getFacilities returns all added facilities', () => {
    const svc = new TestService();
    svc.addFacility(3, 4);
    svc.addFacility(5, 6);
    const facilities = svc.getFacilities();
    expect(facilities).toHaveLength(2);
    expect(facilities[0]!.x).toBe(3);
    expect(facilities[1]!.x).toBe(5);
  });

  describe('inner-ring coverage (all facilities adjacent, coverage expansion reaches Chebyshev 2)', () => {
    function makeHorizontalRoadGrid(size: number, roadY: number): SizedGrid {
      return {
        width: size,
        height: size,
        getCell(x: number, y: number) {
          if (x < 0 || y < 0 || x >= size || y >= size) return null;
          return { roadType: y === roadY ? RoadType.TWO_LANE : RoadType.NONE };
        },
      };
    }

    it('facility placed adjacent to road covers inner-ring zone buildings (2 tiles from road)', () => {
      // Road along y=10, facility at (5, 8) — 2x2 footprint (5,8)-(6,9), adjacent to road.
      // Zone building at (3,8) is 2 tiles above road → inner ring → must be covered.
      const grid = makeHorizontalRoadGrid(20, 10);
      const svc = new TestService();
      svc.addFacility(5, 8);
      svc.recalculateCoverage(grid);
      expect(svc.isFacilityConnected('test_1')).toBe(true);
      expect(svc.getCoverage(3, 9)).toBe(true);  // 1 tile from road
      expect(svc.getCoverage(3, 8)).toBe(true);  // 2 tiles from road (inner ring)
      expect(svc.getCoverage(3, 7)).toBe(false); // 3 tiles from road (outside)
    });

    it('facility NOT adjacent to road is disconnected and produces no coverage', () => {
      // Road along y=10. 2x2 facility at (5, 7)-(6, 8). Gap row at y=9.
      // All infra requires strict adjacency → not connected → no coverage.
      const grid = makeHorizontalRoadGrid(20, 10);
      const svc = new TestService();
      svc.addFacility(5, 7);
      svc.recalculateCoverage(grid);
      expect(svc.isFacilityConnected('test_1')).toBe(false);
      expect(svc.getCoverage(10, 10)).toBe(false);
    });
  });
});
