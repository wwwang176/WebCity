import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { GarbageService } from '../GarbageService';
import { SewageService } from '../SewageService';
import { produceGarbageAndSewage } from '../GarbageSewageProduction';
import { ABANDONED, BURNED } from '../../building/InfraPlacement';
import { PowerGrid } from '../PowerGrid';

/**
 * BUG-131 established that a ruin consumes nothing: calculateUtilityCellDemand
 * returns 0 for a BURNED or ABANDONED zone cell, and the budget flood settles
 * against that.
 *
 * Production never got the same treatment. Sewage is derived from the building
 * TYPE's resident count rather than from occupancy, so a burnt-out house kept
 * reporting its full pre-fire sewage — and the same p.capacity was then spent
 * against two different definitions of demand: getConnectedTreatmentCapacity in
 * tick() (ruins in) and getCellDemandAt in the coverage flood (ruins out).
 *
 * The visible half: burn twenty houses and the power and water figures drop by
 * twenty houses' worth while the sewage plant's load bar does not move at all.
 * The invisible half is worse — the ruin's sewage cell is now supplied for
 * free, so getPollutionSources skips it, and its sewage counts toward
 * untreatedSewage while emitting no water pollution anywhere.
 */
function city(reserved: number): {
  grid: Grid; garbage: GarbageService; sewage: SewageService;
} {
  const grid = new Grid(16, 16);
  for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  for (let x = 1; x <= 4; x++) {
    grid.setCell(x, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved });
  }
  return { grid, garbage: new GarbageService(), sewage: new SewageService() };
}

/** Four houses, all occupied. */
const OCCUPIED = { residents: () => 4, workers: () => 0 };

function produce(grid: Grid, garbage: GarbageService, sewage: SewageService) {
  return produceGarbageAndSewage(
    fn => grid.forEachCell(fn), garbage, sewage, OCCUPIED.residents, OCCUPIED.workers,
  );
}

describe('a ruin produces no sewage and no rubbish', () => {
  it('should produce sewage from live houses', () => {
    const { grid, garbage, sewage } = city(0);
    expect(produce(grid, garbage, sewage).sewage).toBeGreaterThan(0);
    expect(sewage.getSewageCells().length).toBe(4);
  });

  for (const [name, reserved] of [['burnt out', BURNED], ['abandoned', ABANDONED]] as const) {
    it(`should produce no sewage from a ${name} house`, () => {
      const { grid, garbage, sewage } = city(reserved);
      expect(produce(grid, garbage, sewage).sewage).toBe(0);
      expect(sewage.getSewageCells()).toHaveLength(0);
    });

    it(`should produce no rubbish from a ${name} house`, () => {
      // Garbage already used occupancy, and a ruin is evicted — but nothing
      // stopped a stale occupancy lookup from filling it back in.
      const { grid, garbage, sewage } = city(reserved);
      produce(grid, garbage, sewage);
      expect(garbage.getPendingGarbageQueue()).toHaveLength(0);
    });
  }

  it('should agree with what the utility demand says about the same cell', () => {
    // The binding assertion: one definition of "this building is live". If
    // production says a cell is producing while demand says it consumes
    // nothing, the two halves of the panel describe different cities.
    for (const reserved of [0, BURNED, ABANDONED]) {
      const { grid, garbage, sewage } = city(reserved);
      const power = new PowerGrid();
      const demand = power.getCellDemand(grid, 1, 2);
      const produced = produce(grid, garbage, sewage).sewage;
      expect(produced > 0, `reserved=${reserved}`).toBe(demand > 0);
    }
  });

  it('should keep counting live houses next door to a ruin', () => {
    const grid = new Grid(16, 16);
    for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    grid.setCell(1, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    grid.setCell(3, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const sewage = new SewageService();
    produceGarbageAndSewage(
      fn => grid.forEachCell(fn), new GarbageService(), sewage,
      OCCUPIED.residents, OCCUPIED.workers,
    );
    expect(sewage.getSewageCells().map(c => `${c.x},${c.y}`)).toEqual(['1,2', '3,2']);
  });
});
