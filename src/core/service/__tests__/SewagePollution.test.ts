import { describe, it, expect } from 'vitest';
import { SewageService, SEWAGE } from '../SewageService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';

describe('Sewage building-based pollution', () => {
  it('reportSewage should track per-cell sewage production', () => {
    const svc = new SewageService();
    svc.reportSewage(3, 1, 5);
    svc.reportSewage(5, 1, 3);
    expect(svc.getSewageCells().length).toBe(2);
  });

  it('clearSewageCells should reset per-cell tracking', () => {
    const svc = new SewageService();
    svc.reportSewage(3, 1, 5);
    svc.clearSewageCells();
    expect(svc.getSewageCells().length).toBe(0);
  });

  it('getPollutionSources should emit water pollution at unsupplied buildings', () => {
    const svc = new SewageService();
    // No treatment plant → nothing is supplied
    svc.reportSewage(3, 1, 10);
    svc.reportSewage(5, 1, 8);
    svc.tick(18); // total produced = 18, no capacity → untreated = 18

    const sources = svc.getPollutionSources();
    expect(sources.length).toBe(2);
    expect(sources.every(s => s.type === 'water')).toBe(true);
    expect(sources.find(s => s.x === 3 && s.y === 1)!.amount).toBeGreaterThan(0);
    expect(sources.find(s => s.x === 5 && s.y === 1)!.amount).toBeGreaterThan(0);
  });

  it('getPollutionSources should NOT emit pollution at supplied buildings', () => {
    const grid = new Grid(10, 10);
    // Road at y=2
    for (let x = 0; x <= 6; x++) grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    // Sewage plant at (0,1), building at (3,1) connected, building at (8,1) disconnected
    grid.setCell(0, 1, { buildingId: 246 });
    grid.setCell(0, 2, { buildingId: 246 });
    grid.setCell(3, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });
    grid.setCell(8, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });

    const svc = new SewageService();
    svc.addTreatmentPlant(0, 1, 5000);
    svc.calculateCoverage(grid);

    // Report sewage at both buildings
    svc.reportSewage(3, 1, 10); // supplied
    svc.reportSewage(8, 1, 10); // NOT supplied
    svc.tick(20);

    const sources = svc.getPollutionSources();
    // Only unsupplied building should emit pollution
    expect(sources.length).toBe(1);
    expect(sources[0]!.x).toBe(8);
    expect(sources[0]!.y).toBe(1);
    expect(sources[0]!.type).toBe('water');
  });

  it('getPollutionSources should return empty when all buildings are supplied', () => {
    const grid = new Grid(10, 10);
    for (let x = 0; x <= 6; x++) grid.setCell(x, 2, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { buildingId: 246 });
    grid.setCell(0, 2, { buildingId: 246 });
    grid.setCell(3, 1, { buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW });

    const svc = new SewageService();
    svc.addTreatmentPlant(0, 1, 5000);
    svc.calculateCoverage(grid);

    svc.reportSewage(3, 1, 10);
    svc.tick(10);

    const sources = svc.getPollutionSources();
    expect(sources.length).toBe(0);
  });

  it('pollution amount should use WATER_POLLUTION_MULTIPLIER', () => {
    const svc = new SewageService();
    svc.reportSewage(5, 5, 10);
    svc.tick(10);

    const sources = svc.getPollutionSources();
    expect(sources[0]!.amount).toBe(10 * SEWAGE.WATER_POLLUTION_MULTIPLIER);
  });

  it('pollution amount should be capped', () => {
    const svc = new SewageService();
    svc.reportSewage(5, 5, 1000);
    svc.tick(1000);

    const sources = svc.getPollutionSources();
    expect(sources[0]!.amount).toBeLessThanOrEqual(SEWAGE.MAX_POLLUTION_PER_CELL);
  });

  it('getPollutionSources should return empty when no sewage is produced', () => {
    const svc = new SewageService();
    svc.tick(0);
    expect(svc.getPollutionSources()).toEqual([]);
  });

  it('outlets should no longer exist', () => {
    const svc = new SewageService();
    // addOutlet should not exist
    expect((svc as any).addOutlet).toBeUndefined();
  });

  it('fromJSON should handle legacy saves with outlets field gracefully', () => {
    const legacyJson = {
      outlets: [{ id: 'outlet-1', x: 5, y: 5 }],
      treatmentPlants: [{ id: 'plant-1', x: 0, y: 0, capacity: 2250 }],
      untreatedSewage: 10,
      nextId: 3,
    };
    const svc = SewageService.fromJSON(legacyJson as any);
    expect(svc.getTreatmentPlants().length).toBe(1);
    expect(svc.getUntreated()).toBe(10);
  });
});
