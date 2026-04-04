import { describe, it, expect } from 'vitest';
import { SewageService, SEWAGE } from '../SewageService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * Helper: build a small grid with a road corridor and residential buildings.
 *
 * Layout (10×10):
 *   Row 2: road from x=0..6
 *   (1,1) sewage plant (2×2 occupies 1,1 / 2,1 / 1,2 / 2,2) — adjacent to road row 2
 *   (3,1) residential building (above road)
 *   (5,1) residential building (above road)
 *   (8,1) residential building — NOT adjacent to road → unreachable
 */
function buildTestGrid() {
  const grid = new Grid(10, 10);
  // Road corridor at y=2, x=0..6
  for (let x = 0; x <= 6; x++) {
    grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
  }
  // Residential buildings adjacent to road
  grid.setCell(3, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
  grid.setCell(5, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
  // Residential building NOT connected to road
  grid.setCell(8, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
  return grid;
}

describe('SewageService BFS coverage', () => {
  it('should calculate coverage via BFS from treatment plant', () => {
    const svc = new SewageService();
    svc.addTreatmentPlant(1, 1, 5000);
    const grid = buildTestGrid();
    // Place sewage plant building on grid (2×2)
    grid.setCell(1, 1, { buildingId: 246 });
    grid.setCell(2, 1, { buildingId: 246 });
    grid.setCell(1, 2, { buildingId: 246 });
    grid.setCell(2, 2, { buildingId: 246 });

    svc.calculateCoverage(grid);

    // Buildings adjacent to road reachable from plant should be supplied
    expect(svc.isSupplied(3, 1)).toBe(true);
    expect(svc.isSupplied(5, 1)).toBe(true);
    // Building NOT connected to road should NOT be supplied
    expect(svc.isSupplied(8, 1)).toBe(false);
  });

  it('should not supply any cell when no treatment plant exists', () => {
    const svc = new SewageService();
    const grid = buildTestGrid();

    svc.calculateCoverage(grid);

    expect(svc.isSupplied(3, 1)).toBe(false);
    expect(svc.isSupplied(5, 1)).toBe(false);
  });

  it('should respect budget drain — limited capacity covers fewer cells', () => {
    const grid = new Grid(10, 10);
    // Road corridor
    for (let x = 0; x <= 8; x++) {
      grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    }
    // Place sewage plant at (0,1) — 2×2
    grid.setCell(0, 1, { buildingId: 246 });
    grid.setCell(1, 1, { buildingId: 246 });
    grid.setCell(0, 2, { buildingId: 246 });
    grid.setCell(1, 2, { buildingId: 246 });
    // Residential buildings along the road
    grid.setCell(3, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
    grid.setCell(5, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
    grid.setCell(7, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });

    // Very small capacity — should not cover all buildings
    const svc = new SewageService();
    svc.addTreatmentPlant(0, 1, 0.5); // tiny capacity

    svc.calculateDemand(grid);
    svc.calculateCoverage(grid);

    // At least the closest building should not be supplied (budget too small)
    const supplied = [svc.isSupplied(3, 1), svc.isSupplied(5, 1), svc.isSupplied(7, 1)];
    const suppliedCount = supplied.filter(Boolean).length;
    expect(suppliedCount).toBeLessThan(3);
  });

  it('calculateDemand should sum sewage demand across all buildings', () => {
    const svc = new SewageService();
    const grid = buildTestGrid();

    svc.calculateDemand(grid);

    // Should have non-zero demand (3 residential buildings)
    expect(svc.getDemand()).toBeGreaterThan(0);
  });

  it('isSupplied returns false for empty cells', () => {
    const svc = new SewageService();
    const grid = new Grid(5, 5);
    svc.addTreatmentPlant(0, 0, 1000);
    svc.calculateCoverage(grid);

    expect(svc.isSupplied(2, 2)).toBe(false);
  });

  it('multiple treatment plants should extend coverage', () => {
    const grid = new Grid(20, 5);
    // Road spanning the grid
    for (let x = 0; x < 20; x++) {
      grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    }
    // Buildings at far ends
    grid.setCell(1, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
    grid.setCell(18, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });

    // Plant 1 at left
    grid.setCell(0, 1, { buildingId: 246 });
    grid.setCell(0, 2, { buildingId: 246 });

    // Plant 2 at right
    grid.setCell(19, 1, { buildingId: 246 });
    grid.setCell(19, 2, { buildingId: 246 });

    const svc = new SewageService();
    svc.addTreatmentPlant(0, 1, 5000);
    svc.addTreatmentPlant(19, 1, 5000);

    svc.calculateCoverage(grid);

    expect(svc.isSupplied(1, 1)).toBe(true);
    expect(svc.isSupplied(18, 1)).toBe(true);
  });

  it('coverage should respect road connectivity — isolated area not covered', () => {
    const grid = new Grid(10, 10);
    // Road segment 1: x=0..3, y=2
    for (let x = 0; x <= 3; x++) {
      grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    }
    // Road segment 2: x=7..9, y=2 (disconnected)
    for (let x = 7; x <= 9; x++) {
      grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    }
    // Sewage plant on segment 1
    grid.setCell(0, 1, { buildingId: 246 });
    grid.setCell(0, 2, { buildingId: 246 });

    // Building on segment 1 (connected)
    grid.setCell(3, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
    // Building on segment 2 (disconnected)
    grid.setCell(8, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });

    const svc = new SewageService();
    svc.addTreatmentPlant(0, 1, 5000);
    svc.calculateCoverage(grid);

    expect(svc.isSupplied(3, 1)).toBe(true);
    expect(svc.isSupplied(8, 1)).toBe(false);
  });

  it('toJSON/fromJSON should preserve coverage state after recalculation', () => {
    const svc = new SewageService();
    svc.addTreatmentPlant(1, 1, 5000);

    const json = svc.toJSON();
    const restored = SewageService.fromJSON(json);

    const grid = buildTestGrid();
    grid.setCell(1, 1, { buildingId: 246 });
    grid.setCell(2, 1, { buildingId: 246 });
    grid.setCell(1, 2, { buildingId: 246 });
    grid.setCell(2, 2, { buildingId: 246 });

    restored.calculateCoverage(grid);
    expect(restored.isSupplied(3, 1)).toBe(true);
  });
});
