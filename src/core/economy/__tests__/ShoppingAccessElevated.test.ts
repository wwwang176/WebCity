import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { ShoppingAccess } from '../ShoppingAccess';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { getBuildingType } from '../../building/types';

/** RoadDirection bits, matching TrackDirection. */
const EAST = 0b1000;
const WEST = 0b0100;

/**
 * ShoppingAccess queues cell KEYS, and UnifiedRoadLookup keys ground cells "x,y"
 * but elevated ones "x,y,level". A position under an elevated road can therefore
 * be reached twice — and, because getCompatibleNeighborKeys never returns a
 * level-1 neighbour for a flat level-0 source, the second visit can happen in a
 * SEPARATE component. Deduplicating per component (BUG-095) left that case
 * counting the building twice, and residentialStatus.set then overwrote the
 * correct entry with the elevated component's, reporting no commercial access
 * for a house with shops next door (BUG-120).
 */
function cityWithViaductOverHouse() {
  const grid = new Grid(12, 12);
  for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  grid.setCell(4, 1, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(4, 2, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(5, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  // A viaduct that passes over the house but connects to nothing on the ground.
  const em = new ElevationManager();
  for (const y of [1, 2, 3]) {
    em.set(5, y, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 3, railType: 0, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });
  }

  const shopping = new ShoppingAccess();
  shopping.setRoadLookup(new UnifiedRoadLookup(grid, em));
  shopping.calculate(grid);
  return shopping;
}

/**
 * Two ground networks that share no ground cell, bridged only by a viaduct with
 * a ramp at each end. Exercises the level-aware relay in the direction that
 * makes a component BIGGER, which the viaduct case above cannot: there, the
 * elevated keys form their own dead-end component.
 */
function cityBridgedByRamps() {
  const grid = new Grid(12, 12);
  // West network: shop at (1,1) on a road stub ending at (2,3).
  grid.setCell(1, 2, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  // East network: house at (9,1) on a road stub starting at (9,3).
  grid.setCell(9, 2, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(9, 3, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  grid.setCell(9, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  const em = new ElevationManager();
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.TWO_LANE, roadFlags: 12, railType: 0, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  // Ramp up at x=2 (ascends east), deck across, ramp down at x=8.
  em.set(2, 3, 1, seg(true, EAST));
  for (let x = 3; x <= 7; x++) em.set(x, 3, 1, seg(false, 0));
  em.set(8, 3, 1, seg(true, WEST));

  const shopping = new ShoppingAccess();
  shopping.setRoadLookup(new UnifiedRoadLookup(grid, em));
  shopping.calculate(grid);
  return shopping;
}

describe('a building under a viaduct is counted once', () => {
  it('should still see the commercial building on its own road network', () => {
    const shopping = cityWithViaductOverHouse();
    expect(shopping.getResidentialAccess(5, 2).hasAccess).toBe(true);
  });

  it('should report customers for the shop', () => {
    const shopping = cityWithViaductOverHouse();
    expect(shopping.getCommercialCustomers(1, 1).hasCustomers).toBe(true);
  });

  it('should not inflate the ratio by counting the house twice', () => {
    // hasAccess is a boolean and survives a double count; the ratio does not.
    // One 1-resident house against one shop's worker capacity, so the numbers
    // are exact and a second count of either side moves them.
    const shopping = cityWithViaductOverHouse();
    const home = getBuildingType(1)!;
    const shop = getBuildingType(7)!;

    expect(shopping.getResidentialAccess(5, 2).ratio)
      .toBeCloseTo(Math.min(1, shop.workers / home.residents), 9);
    expect(shopping.getCommercialCustomers(1, 1).ratio)
      .toBeCloseTo(Math.min(1, home.residents / shop.workers), 9);
  });
});

describe('a viaduct with ramps joins two ground networks', () => {
  it('should give the house access to the shop across the bridge', () => {
    const shopping = cityBridgedByRamps();
    expect(shopping.getResidentialAccess(9, 1).hasAccess).toBe(true);
    expect(shopping.getCommercialCustomers(1, 1).hasCustomers).toBe(true);
  });

  it('should keep them apart when the ramps are removed', () => {
    // Negative control: without the level change the deck is unreachable from
    // the ground, so the two stubs stay separate components. Without this, the
    // case above would pass for an implementation that ignored levels entirely.
    const grid = new Grid(12, 12);
    grid.setCell(1, 2, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
    grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
    grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(9, 2, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
    grid.setCell(9, 3, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
    grid.setCell(9, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const em = new ElevationManager();
    for (let x = 2; x <= 8; x++) {
      em.set(x, 3, 1, {
        roadType: RoadType.TWO_LANE, roadFlags: 12, railType: 0, railFlags: 0,
        isRamp: false, rampAscendDirection: 0,
      });
    }

    const shopping = new ShoppingAccess();
    shopping.setRoadLookup(new UnifiedRoadLookup(grid, em));
    shopping.calculate(grid);

    expect(shopping.getResidentialAccess(9, 1).hasAccess).toBe(false);
    expect(shopping.getCommercialCustomers(1, 1).hasCustomers).toBe(false);
  });
});
