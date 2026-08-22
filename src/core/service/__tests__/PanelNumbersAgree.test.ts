import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { GarbageService } from '../GarbageService';
import { SewageService } from '../SewageService';

/**
 * BUG-138 filtered the capacity getters so a facility that has stopped no
 * longer advertises places it cannot provide. It did not filter the loads that
 * divide into them, and two panels were left dividing a whole-city numerator by
 * a subset denominator.
 *
 * These are the core-side getters the panels need in order to compare like with
 * like. The arithmetic that consumes them is tested in
 * core/stats/__tests__/facilityLoad.test.ts; what is pinned here is
 * that "active" means the same thing on both sides of the division.
 */
function roadCity(): Grid {
  const grid = new Grid(24, 24);
  for (let x = 1; x <= 10; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  return grid;
}

describe('the landfill panel divides like by like', () => {
  it('should count stored garbage only in landfills it counts capacity for', () => {
    const grid = roadCity();
    const garbage = new GarbageService();
    const reachable = garbage.addFacility(3, 2);
    const marooned = garbage.addFacility(18, 18);
    garbage.recalculateCoverage(grid);

    const facilities = garbage.getFacilities();
    const byId = new Map(facilities.map(f => [f.id, f]));
    byId.get(reachable)!.currentLoad = 400;
    byId.get(marooned)!.currentLoad = 1800;

    // The defect: 2200 stored over only the reachable landfill's capacity.
    expect(garbage.getCurrentLoad()).toBe(2200);
    expect(garbage.getActiveLoad()).toBe(400);
    expect(garbage.getActiveLoad()).toBeLessThanOrEqual(garbage.getTotalCapacity());
  });

  it('should never report a load with no capacity behind it', () => {
    // The exact "1800 / 0" the panel printed, with the bar back at 0%.
    const grid = roadCity();
    const garbage = new GarbageService();
    const marooned = garbage.addFacility(18, 18);
    garbage.recalculateCoverage(grid);
    garbage.getFacilities().find(f => f.id === marooned)!.currentLoad = 1800;

    expect(garbage.getTotalCapacity()).toBe(0);
    expect(garbage.getActiveLoad()).toBe(0);
  });

  it('should say how much capacity is stranded rather than hiding it', () => {
    const grid = roadCity();
    const garbage = new GarbageService();
    garbage.addFacility(3, 2);
    garbage.addFacility(18, 18);
    garbage.recalculateCoverage(grid);

    const stranded = garbage.getStrandedCapacity();
    expect(stranded).toBeGreaterThan(0);
    expect(stranded + garbage.getTotalCapacity()).toBe(
      garbage.getFacilities().reduce((s, f) => s + f.capacity, 0),
    );
  });

  it('should report nothing stranded when every landfill is reachable', () => {
    const grid = roadCity();
    const garbage = new GarbageService();
    garbage.addFacility(3, 2);
    garbage.addFacility(6, 2);
    garbage.recalculateCoverage(grid);
    expect(garbage.getStrandedCapacity()).toBe(0);
    expect(garbage.getActiveLoad()).toBe(garbage.getCurrentLoad());
  });
});

describe('the sewage panel can tell which plants are treating anything', () => {
  it('should call a connected, powered plant active', () => {
    const grid = roadCity();
    const sewage = new SewageService();
    const p = sewage.addTreatmentPlant(3, 2);
    sewage.updateConnectedPlants(grid);
    sewage.calculateCoverage(grid);
    sewage.updateOperationalStatus(() => true, () => true);
    expect(sewage.isPlantActive(p)).toBe(true);
  });

  it('should not call a blacked-out plant active', () => {
    // This is the plant that took a full share of the city's sewage and
    // rendered "Load 3000 / 2250 · Over capacity" while treating nothing.
    const grid = roadCity();
    const sewage = new SewageService();
    const p = sewage.addTreatmentPlant(3, 2);
    sewage.updateConnectedPlants(grid);
    sewage.calculateCoverage(grid);
    sewage.updateOperationalStatus(() => false, () => true);
    expect(sewage.isPlantActive(p)).toBe(false);
  });

  it('should not call an unreachable plant active', () => {
    const grid = roadCity();
    const sewage = new SewageService();
    const p = sewage.addTreatmentPlant(20, 20);
    sewage.updateConnectedPlants(grid);
    sewage.calculateCoverage(grid);
    sewage.updateOperationalStatus(() => true, () => true);
    expect(sewage.isPlantActive(p)).toBe(false);
  });

  it('should agree with the capacity the simulation settles against', () => {
    // getTreatmentCapacity is what tick() uses to decide how much sewage is
    // treated. If the panel's notion of "active" drifts from it, the rows and
    // the untreated figure describe different cities.
    const grid = roadCity();
    const sewage = new SewageService();
    const near = sewage.addTreatmentPlant(3, 2);
    const far = sewage.addTreatmentPlant(20, 20);
    sewage.updateConnectedPlants(grid);
    sewage.calculateCoverage(grid);

    for (const powered of [true, false]) {
      sewage.updateOperationalStatus(() => powered, () => true);
      const fromActive = sewage.getTreatmentPlants()
        .filter(p => sewage.isPlantActive(p.id))
        .reduce((s, p) => s + p.capacity, 0);
      expect(fromActive, `powered=${powered}`).toBe(sewage.getTreatmentCapacity());
    }

    expect(sewage.isPlantActive(near)).toBe(false);
    expect(sewage.isPlantActive(far)).toBe(false);
  });
});
