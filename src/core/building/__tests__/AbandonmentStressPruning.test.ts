import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { abandonmentStressTick, type AbandonmentStressTickDeps } from '../AbandonmentStressTick';
import { isZoneBuilding } from '../InfraConfig';
import { getBuildingType } from '../types';
import { BURNED, placeInfraOnGrid } from '../InfraPlacement';

/**
 * abandonmentStress is keyed by POSITION, not by building identity, and the
 * tick only visits live zone buildings — so an entry for a cell that no longer
 * holds one is never touched again. Whatever grows there next inherits the
 * pressure that killed its predecessor and is abandoned almost immediately.
 *
 * Two paths cleared it explicitly (demolish and, since BUG-087, rezone) and
 * three did not: applyDisasterDamage, the auto-demolition of buildings under a
 * newly placed facility footprint, and a building burning down. Rather than add
 * a fourth and fifth call site to a list nobody can see, the tick prunes:
 * anything not answerable as a live zone building is dropped.
 */
function deps(grid: Grid, stressMap: Map<string, number>): AbandonmentStressTickDeps {
  return {
    forEachCell: (fn) => grid.forEachCell(fn),
    getCell: (x, y) => grid.getCell(x, y),
    isZoneBuilding,
    getBuildingLevel: (bid) => getBuildingType(bid)?.level ?? 0,
    getPollution: () => ({ ground: 0, water: 0 }),
    getCrimeReduction: () => 0,
    getServiceScore: () => 10,
    isPowered: () => true,
    isWatered: () => true,
    getFreightSupplyRatio: () => 1,
    getFreightSurplusRatio: () => 1,
    baseCrime: 0,
    businessTax: 9,
    residentialTax: 9,
    stressMap,
  };
}

describe('abandonment stress does not outlive its building', () => {
  it('should drop stress recorded for a cell that is now empty', () => {
    const grid = new Grid(8, 8);
    const stress = new Map([['3,3', 80]]);

    abandonmentStressTick(deps(grid, stress));

    expect(stress.has('3,3')).toBe(false);
  });

  it('should drop stress for a building that burned down', () => {
    const grid = new Grid(8, 8);
    grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    const stress = new Map([['3,3', 80]]);

    abandonmentStressTick(deps(grid, stress));

    expect(stress.has('3,3')).toBe(false);
  });

  it('should drop stress for a cell now covered by a facility footprint', () => {
    // A facility placed over zoned land auto-demolishes the buildings under it.
    const grid = new Grid(10, 10);
    placeInfraOnGrid(grid, 3, 3, 'police', 0);
    const stress = new Map([['3,3', 80], ['4,4', 60]]);

    abandonmentStressTick(deps(grid, stress));

    expect(stress.has('3,3')).toBe(false);
    expect(stress.has('4,4')).toBe(false);
  });

  it('should keep stress for a building that is still standing', () => {
    // Negative control: pruning must not simply empty the map every tick.
    const grid = new Grid(8, 8);
    grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    const stress = new Map([['3,3', 80]]);

    abandonmentStressTick(deps(grid, stress));

    expect(stress.get('3,3')).toBeGreaterThan(0);
  });

  it('should not let a replacement building inherit the old pressure', () => {
    // End to end: a building at 80 stress burns down, the tick runs, a
    // developer rebuilds on the cell — and starts from zero.
    const grid = new Grid(8, 8);
    grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    const stress = new Map([['3,3', 80]]);

    abandonmentStressTick(deps(grid, stress));
    grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    abandonmentStressTick(deps(grid, stress));

    expect(stress.get('3,3') ?? 0).toBeLessThan(80);
  });
});
