import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { HealthService } from '../HealthService';
import { PoliceService } from '../PoliceService';

/**
 * Coverage already excludes non-operational facilities, so the demand side of
 * every load ratio was correctly filtered — but the capacity side summed ALL
 * facilities. A hospital with no power still counted its full capacity in the
 * denominator, so loadRatio was understated exactly when the city was in
 * trouble. For health that is not cosmetic: SimulationLoop multiplies the death
 * rate by health.getLoadRatio() (BUG-100).
 *
 * The same applies to the nearest-facility assignment: a dead station could be
 * the closest one and absorb demand that nothing was serving.
 */
function cityWithHospitals() {
  const grid = new Grid(20, 20);
  new RoadBuilder(grid).buildRoad({ x: 0, y: 10 }, { x: 18, y: 10 }, RoadType.TWO_LANE, 1e6);
  const health = new HealthService();
  const a = health.addHospital(2, 11);
  const b = health.addHospital(14, 11);
  health.recalculateCoverage(grid);
  return { grid, health, a, b };
}

describe('load ratios count only operational facilities', () => {
  it('should halve total capacity when one of two hospitals loses power', () => {
    const { health, a } = cityWithHospitals();
    const full = health.getTotalCapacity();

    health.updateOperationalStatus(f => f.id !== a);

    expect(health.getTotalCapacity()).toBe(full / 2);
  });

  it('should report an infinite load ratio when every hospital is dead', () => {
    const { grid, health } = cityWithHospitals();
    health.updateOperationalStatus(() => false);
    health.recalculateCoverage(grid);

    health.updateLoads([{ x: 4, y: 10, pollution: 0 }]);

    // No capacity at all: either infinite load or no covered citizens, but never
    // a comfortable ratio computed against phantom capacity.
    expect(health.getLoadRatio()).not.toBeLessThan(1);
  });

  it('should still count capacity while everything is powered', () => {
    const { health } = cityWithHospitals();
    const full = health.getTotalCapacity();
    health.updateOperationalStatus(() => true);
    expect(health.getTotalCapacity()).toBe(full);
  });

  it('should not give a dead police station any load', () => {
    const grid = new Grid(20, 20);
    new RoadBuilder(grid).buildRoad({ x: 0, y: 10 }, { x: 18, y: 10 }, RoadType.TWO_LANE, 1e6);
    const police = new PoliceService();
    const dead = police.addStation(4, 11);
    police.addStation(14, 11);
    police.recalculateCoverage(grid);
    police.updateOperationalStatus(f => f.id !== dead);
    police.recalculateCoverage(grid);

    police.updateStationLoads([{ x: 5, y: 10, weight: 10 }]);

    expect(police.getStationLoad(dead)).toBe(0);
  });
});
