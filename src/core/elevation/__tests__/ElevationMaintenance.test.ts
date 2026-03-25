import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { calculateElevatedMaintenance } from '../ElevationMaintenance';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { RAIL } from '../../rail/types';
import { ELEVATION_COST } from '../types';

describe('calculateElevatedMaintenance', () => {
  it('returns 0 for empty manager', () => {
    const em = new ElevationManager();
    expect(calculateElevatedMaintenance(em)).toBe(0);
  });

  it('calculates maintenance for elevated road segments', () => {
    const em = new ElevationManager();
    em.set(0, 0, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    em.set(1, 0, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    const cost = calculateElevatedMaintenance(em);
    // 2 highway cells × highway base maintenance × ELEVATION_COST.MAINTENANCE
    expect(cost).toBeGreaterThan(0);
  });

  it('applies MAINTENANCE multiplier', () => {
    const em = new ElevationManager();
    em.set(0, 0, 1, { roadType: RoadType.TWO_LANE, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    const cost = calculateElevatedMaintenance(em);
    // Base road maintenance per tile × 2 (ELEVATION_COST.MAINTENANCE)
    expect(cost).toBe(ROAD_CONFIGS[RoadType.TWO_LANE].cost * 0.01 * ELEVATION_COST.MAINTENANCE);
  });

  it('includes rail maintenance', () => {
    const em = new ElevationManager();
    em.set(0, 0, 1, { roadType: 0, roadFlags: 0, railType: 1, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    const cost = calculateElevatedMaintenance(em);
    expect(cost).toBe(RAIL.COST_PER_CELL * 0.01 * ELEVATION_COST.MAINTENANCE);
  });
});
