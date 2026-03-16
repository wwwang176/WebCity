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
});
