import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { SchoolService } from '../SchoolService';
import { HealthService } from '../HealthService';
import { GarbageService } from '../GarbageService';

/**
 * "Places the city can actually offer" has two conditions — the facility must
 * have power, and it must be reachable by road — and the services disagreed
 * about which ones counted.
 *
 * GarbageService asks both (getActiveFacilities). SchoolService and
 * HealthService asked only about power (getOperationalFacilities), so a school
 * or hospital marooned with no road kept contributing its full capacity. Its
 * coverage is already zero — recalculateCoverage spreads along roads — so it
 * served nobody while the education gate and the hospital load ratio both
 * counted its places. That is BUG-100's shape exactly, one condition over.
 *
 * The load ratio is the sharper end: SimulationLoop multiplies the death rate
 * by HealthService.getLoadRatio(), so an unreachable hospital suppressed deaths
 * across the whole city.
 */
function city(): Grid {
  const grid = new Grid(30, 30);
  for (let x = 0; x < 12; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  return grid;
}

/** Everything is powered, so power can never be the reason a case passes. */
const allPowered = () => true;

describe('a facility with no road offers no places', () => {
  it('should not count a marooned school', () => {
    const grid = city();
    const schools = new SchoolService('elementary');
    const connected = schools.addSchool(3, 0);
    const marooned = schools.addSchool(25, 25);
    schools.recalculateCoverage(grid);
    schools.updateOperationalStatus(allPowered);

    const one = schools.getSchools().find(s => s.id === connected)!;
    expect(schools.isFacilityConnected(marooned),
      'the fixture must actually have a disconnected school').toBe(false);
    expect(schools.getTotalCapacity()).toBe(one.capacity);
  });

  it('should count it again once a road reaches it', () => {
    // The control. Without it, "exclude the marooned one" is satisfiable by
    // reporting zero capacity for every school in the city.
    const grid = city();
    const schools = new SchoolService('elementary');
    schools.addSchool(3, 0);
    const far = schools.addSchool(25, 25);
    schools.recalculateCoverage(grid);
    schools.updateOperationalStatus(allPowered);
    const withoutRoad = schools.getTotalCapacity();

    grid.setCell(25, 24, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    schools.recalculateCoverage(grid);
    schools.updateOperationalStatus(allPowered);

    expect(schools.isFacilityConnected(far)).toBe(true);
    expect(schools.getTotalCapacity()).toBeGreaterThan(withoutRoad);
  });

  it('should not count a marooned hospital', () => {
    const grid = city();
    const health = new HealthService();
    const connected = health.addHospital(3, 0);
    health.addHospital(25, 25);
    health.recalculateCoverage(grid);
    health.updateOperationalStatus(allPowered);

    const one = health.getHospitals().find(h => h.id === connected)!;
    expect(health.getTotalCapacity()).toBe(one.capacity);
  });

  it('should not let a marooned hospital suppress the death rate', () => {
    // getLoadRatio is load / capacity, and SimulationLoop multiplies the death
    // rate by it. Capacity that serves nobody made the city look healthier than
    // it was, exactly when it was failing.
    const grid = city();
    const withOnlyReachable = new HealthService();
    withOnlyReachable.addHospital(3, 0);
    withOnlyReachable.recalculateCoverage(grid);
    withOnlyReachable.updateOperationalStatus(allPowered);

    const withAMarooned = new HealthService();
    withAMarooned.addHospital(3, 0);
    withAMarooned.addHospital(25, 25);
    withAMarooned.recalculateCoverage(grid);
    withAMarooned.updateOperationalStatus(allPowered);

    expect(withAMarooned.getTotalCapacity()).toBe(withOnlyReachable.getTotalCapacity());
  });

  it('should still exclude an unpowered but connected facility', () => {
    // The other half of the condition must not have been lost.
    const grid = city();
    const schools = new SchoolService('elementary');
    schools.addSchool(3, 0);
    schools.recalculateCoverage(grid);
    schools.updateOperationalStatus(() => false);

    expect(schools.getTotalCapacity()).toBe(0);
  });

  it('should agree with the service that already got this right', () => {
    // GarbageService has asked both questions since BUG-101; the point of this
    // file is that the others now do too.
    const grid = city();
    const garbage = new GarbageService();
    garbage.addFacility(3, 0);
    garbage.addFacility(25, 25);
    garbage.recalculateCoverage(grid);
    garbage.updateOperationalStatus(allPowered);

    const facilities = garbage.getFacilities();
    expect(garbage.getTotalCapacity()).toBe(facilities[0]!.capacity);
  });
});
