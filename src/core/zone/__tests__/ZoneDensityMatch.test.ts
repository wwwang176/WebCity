import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { BuildingGrowth } from '../../building/BuildingGrowth';
import { getGrowthDensity, getMaxDensity } from '../DensityRules';
import { getZoneBlocker } from '../ZoneBlocker';

/**
 * The zone/road density pairing had four dead combinations, and every one of
 * them looked exactly like a healthy plot that was merely waiting its turn.
 *
 * getMaxDensity returns the BEST tier any nearby road permits, and tryGrow used
 * that tier verbatim as the building lookup. So a low-density house beside a
 * four-lane road asked for `RESIDENTIAL_LOW` + density `HIGH` — a combination
 * BUILDING_TYPES does not contain — and got an empty list. Forever. canGrow
 * returned true throughout, so no gate anywhere reported a problem.
 *
 * The rule the game actually wants: a zone knows its own density. The road only
 * has to be big enough to carry it. A six-lane road happily fronts small
 * houses; a two-lane street cannot carry an apartment block. Only OFFICE has
 * both tiers, so only OFFICE lets the road pick.
 */
const DEMAND = { residential: 50, commercial: 50, industrial: 50 };
const GROWS = true;
const DEAD = false;

function plot(zoneType: ZoneType, roadType: RoadType): Grid {
  const grid = new Grid(12, 12);
  for (let x = 1; x <= 9; x++) grid.setCell(x, 5, { roadType, roadFlags: 12 });
  grid.setCell(5, 6, { zoneType });
  return grid;
}

describe('a zone builds at its own density, on any road big enough to carry it', () => {
  // roadType, zoneType, does a building actually appear
  const CASES: Array<[string, ZoneType, RoadType, boolean]> = [
    // Small zones are fine on big roads — this is the half that was dead.
    ['low residential on a four-lane', ZoneType.RESIDENTIAL_LOW, RoadType.FOUR_LANE, GROWS],
    ['low residential on a six-lane', ZoneType.RESIDENTIAL_LOW, RoadType.SIX_LANE, GROWS],
    ['low commercial on a four-lane', ZoneType.COMMERCIAL_LOW, RoadType.FOUR_LANE, GROWS],
    ['low residential on a two-lane', ZoneType.RESIDENTIAL_LOW, RoadType.TWO_LANE, GROWS],
    ['low residential on a rural road', ZoneType.RESIDENTIAL_LOW, RoadType.RURAL, GROWS],

    // Big zones genuinely need a big road. These stay dead — but must now SAY so.
    ['high residential on a two-lane', ZoneType.RESIDENTIAL_HIGH, RoadType.TWO_LANE, DEAD],
    ['high residential on a rural road', ZoneType.RESIDENTIAL_HIGH, RoadType.RURAL, DEAD],
    ['high commercial on a two-lane', ZoneType.COMMERCIAL_HIGH, RoadType.TWO_LANE, DEAD],
    ['high residential on a four-lane', ZoneType.RESIDENTIAL_HIGH, RoadType.FOUR_LANE, GROWS],
    ['high commercial on a six-lane', ZoneType.COMMERCIAL_HIGH, RoadType.SIX_LANE, GROWS],

    // Industrial has one tier and takes any road; office has both.
    ['industry on a six-lane', ZoneType.INDUSTRIAL, RoadType.SIX_LANE, GROWS],
    ['industry on a rural road', ZoneType.INDUSTRIAL, RoadType.RURAL, GROWS],
    ['offices on a two-lane', ZoneType.OFFICE, RoadType.TWO_LANE, GROWS],
    ['offices on a six-lane', ZoneType.OFFICE, RoadType.SIX_LANE, GROWS],
  ];

  for (const [name, zoneType, roadType, expected] of CASES) {
    it(`should ${expected ? 'develop' : 'refuse'} ${name}`, () => {
      const grid = plot(zoneType, roadType);
      const grew = new BuildingGrowth(grid).tryGrow(5, 6, {
        hasPower: true, hasWater: true, rciDemand: DEMAND,
      });
      expect(grew).toBe(expected);
      if (expected) expect(grid.getCell(5, 6)!.buildingId).toBeGreaterThan(0);
    });

    it(`should diagnose ${name} the same way`, () => {
      // The diagnosis is only worth showing if it never says "ready" about a
      // plot that will not build. This is the assertion that binds the two.
      const grid = plot(zoneType, roadType);
      const blocker = getZoneBlocker(grid, 5, 6, {
        isPowered: () => true, isWatered: () => true, rciDemand: DEMAND,
      });
      expect(blocker === null).toBe(expected);
      if (!expected) expect(blocker).toBe('ROAD_TOO_SMALL');
    });
  }

  it('should pick the office tier from the road, since offices have both', () => {
    expect(getGrowthDensity(ZoneType.OFFICE, 'LOW')).toBe('LOW');
    expect(getGrowthDensity(ZoneType.OFFICE, 'HIGH')).toBe('HIGH');
  });

  it('should let a small zone keep its own tier on a big road', () => {
    expect(getGrowthDensity(ZoneType.RESIDENTIAL_LOW, 'HIGH')).toBe('LOW');
    expect(getGrowthDensity(ZoneType.COMMERCIAL_LOW, 'HIGH')).toBe('LOW');
    expect(getGrowthDensity(ZoneType.INDUSTRIAL, 'HIGH')).toBe('LOW');
  });

  it('should refuse a big zone on a road that cannot carry it', () => {
    expect(getGrowthDensity(ZoneType.RESIDENTIAL_HIGH, 'LOW')).toBeNull();
    expect(getGrowthDensity(ZoneType.COMMERCIAL_HIGH, 'LOW')).toBeNull();
  });

  it('should refuse everything with no road at all', () => {
    for (const z of [ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
                     ZoneType.INDUSTRIAL, ZoneType.OFFICE]) {
      expect(getGrowthDensity(z, 'NONE')).toBeNull();
    }
  });

  it('should still call a highway no road at all, not a road that is too small', () => {
    // A highway has no frontage; the fix is to build a street, not to widen one.
    const grid = plot(ZoneType.RESIDENTIAL_LOW, RoadType.HIGHWAY);
    expect(getMaxDensity(grid, 5, 6)).toBe('NONE');
    expect(getZoneBlocker(grid, 5, 6, {
      isPowered: () => true, isWatered: () => true, rciDemand: DEMAND,
    })).toBe('NO_ROAD');
  });
});

describe('every zone/road pair the game permits agrees across all three answers', () => {
  it('should never report "ready" for a plot that does not build', () => {
    const zones = [ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
                   ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
                   ZoneType.INDUSTRIAL, ZoneType.OFFICE];
    const roads = [RoadType.RURAL, RoadType.TWO_LANE, RoadType.ONE_WAY,
                   RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY];

    for (const zoneType of zones) {
      for (const roadType of roads) {
        const label = `zone=${zoneType} road=${roadType}`;
        const blocker = getZoneBlocker(plot(zoneType, roadType), 5, 6, {
          isPowered: () => true, isWatered: () => true, rciDemand: DEMAND,
        });
        const grew = new BuildingGrowth(plot(zoneType, roadType)).tryGrow(5, 6, {
          hasPower: true, hasWater: true, rciDemand: DEMAND,
        });
        expect(blocker === null, label).toBe(grew);
      }
    }
  });
});
