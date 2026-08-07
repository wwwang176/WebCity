import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';

/**
 * The elevated twin of BUG-060.
 *
 * removeElevated re-derived each surviving neighbour's roadType from "the
 * highest tier still connected to it". A road's tier is player-paid state —
 * calculateRoadCost charges the differential when a higher tier is drawn over an
 * existing road — so demolishing one span silently downgraded paid capacity in
 * one direction and granted a free upgrade in the other. It matters more up here
 * than on the ground: an elevated segment's roadType also drives its per-tick
 * maintenance bill, so the player's expenses were rewritten too (BUG-096).
 */
function elevatedRun() {
  const grid = new Grid(20, 20);
  new RoadBuilder(grid).buildRoad({ x: 0, y: 5 }, { x: 0, y: 5 }, RoadType.TWO_LANE, 1e6);
  const em = new ElevationManager();
  const builder = new ElevatedRoadBuilder(grid, em);
  return { grid, em, builder };
}

describe('removing an elevated segment leaves neighbour tiers alone', () => {
  /** x=1..4 are TWO_LANE, x=5..8 are FOUR_LANE, so the tiers meet between 4 and 5. */
  function mixedRun() {
    const { em, builder } = elevatedRun();
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 1e6, 1);
    builder.buildElevatedRoad({ x: 5, y: 5 }, { x: 8, y: 5 }, RoadType.FOUR_LANE, 1e6, 1);
    return { em, builder };
  }

  it('should not upgrade a cheaper neighbour for free', () => {
    // Removing (3,5) leaves the TWO_LANE cell (4,5) connected only eastward to
    // the FOUR_LANE run, so "highest remaining connection" promoted it to
    // FOUR_LANE at no charge — and raised its maintenance bill.
    const { em, builder } = mixedRun();
    expect(em.get(4, 5, 1)!.roadType).toBe(RoadType.TWO_LANE);

    builder.removeElevated(3, 5);

    expect(em.get(4, 5, 1)!.roadType).toBe(RoadType.TWO_LANE);
  });

  it('should not downgrade a pricier neighbour', () => {
    // Removing (6,5) leaves the FOUR_LANE cell (5,5) connected only westward to
    // the TWO_LANE run, destroying capacity the player paid for.
    const { em, builder } = mixedRun();
    expect(em.get(5, 5, 1)!.roadType).toBe(RoadType.FOUR_LANE);

    builder.removeElevated(6, 5);

    expect(em.get(5, 5, 1)!.roadType).toBe(RoadType.FOUR_LANE);
  });

  it('should still clear the connection flag toward the removed cell', () => {
    const { em, builder } = elevatedRun();
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    const flagsBefore = em.get(4, 5, 1)!.roadFlags;
    builder.removeElevated(5, 5);
    const flagsAfter = em.get(4, 5, 1)!.roadFlags;

    expect(flagsAfter).toBeLessThan(flagsBefore);
  });
});
