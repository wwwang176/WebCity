import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { BuildingGrowth } from '../../building/BuildingGrowth';
import {
  getZoneBlocker, summariseZoneBlockers, ZONE_BLOCKER_MESSAGES,
  ACTIONABLE_BLOCKERS, type ZoneBlocker, type ZoneBlockerDeps,
} from '../ZoneBlocker';

/**
 * A zoned cell that will never develop is drawn identically to one that is
 * simply waiting its turn. In a play session twelve residential cells sat empty
 * with demand at 67, land zoned and a road adjacent — and nothing on screen
 * said that road was on a separate network from the power plant. The
 * information existed (isPowered(x, y)); it had no route to the player.
 *
 * The value of this diagnosis depends entirely on it agreeing with the real
 * growth gate, so the last test drives BuildingGrowth.canGrow itself over a
 * matrix of conditions and demands the two answers match.
 */
const FULL_DEMAND = { residential: 50, commercial: 50, industrial: 50 };
const deps = (o: Partial<ZoneBlockerDeps> = {}): ZoneBlockerDeps => ({
  isPowered: () => true,
  isWatered: () => true,
  rciDemand: FULL_DEMAND,
  ...o,
});

/** A road at y=5 with a zoned cell at (5,6). */
function city(): Grid {
  const grid = new Grid(12, 12);
  for (let x = 1; x <= 9; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  grid.setCell(5, 6, { zoneType: ZoneType.RESIDENTIAL_LOW });
  return grid;
}

describe('an empty zoned cell can say why it is empty', () => {
  it('should report nothing wrong when everything is in place', () => {
    expect(getZoneBlocker(city(), 5, 6, deps())).toBeNull();
  });

  it('should report NO_POWER', () => {
    expect(getZoneBlocker(city(), 5, 6, deps({ isPowered: () => false }))).toBe('NO_POWER');
  });

  it('should report NO_WATER', () => {
    expect(getZoneBlocker(city(), 5, 6, deps({ isWatered: () => false }))).toBe('NO_WATER');
  });

  it('should report NO_ROAD when the road is gone', () => {
    const grid = city();
    for (let x = 1; x <= 9; x++) grid.setCell(x, 5, { roadType: RoadType.NONE, roadFlags: 0 });
    expect(getZoneBlocker(grid, 5, 6, deps())).toBe('NO_ROAD');
  });

  it('should report NO_DEMAND', () => {
    expect(getZoneBlocker(city(), 5, 6, deps({
      rciDemand: { residential: 0, commercial: 50, industrial: 50 },
    }))).toBe('NO_DEMAND');
  });

  it('should report DISTRICT_POLICY', () => {
    expect(getZoneBlocker(city(), 5, 6, deps({ canBuildHere: () => false }))).toBe('DISTRICT_POLICY');
  });

  it('should report RAIL_IN_THE_WAY', () => {
    const grid = city();
    grid.setCell(5, 6, { railType: RailType.STANDARD });
    expect(getZoneBlocker(grid, 5, 6, deps())).toBe('RAIL_IN_THE_WAY');
  });

  it('should say nothing about a cell that is not zoned, or already built', () => {
    const grid = city();
    expect(getZoneBlocker(grid, 7, 7, deps())).toBeNull();
    grid.setCell(5, 6, { buildingId: 1 });
    expect(getZoneBlocker(grid, 5, 6, deps())).toBeNull();
  });

  it('should put the utility problem before the demand problem', () => {
    // Both true at once. The player can fix the power; "no demand" would send
    // them chasing the wrong thing.
    expect(getZoneBlocker(city(), 5, 6, deps({
      isPowered: () => false,
      rciDemand: { residential: 0, commercial: 0, industrial: 0 },
    }))).toBe('NO_POWER');
  });

  it('should have a message and an actionability verdict for every blocker', () => {
    const all: ZoneBlocker[] = ['NO_ROAD', 'NO_POWER', 'NO_WATER', 'DISTRICT_POLICY',
                                'NO_DEMAND', 'RAIL_IN_THE_WAY'];
    for (const b of all) {
      expect(ZONE_BLOCKER_MESSAGES[b], b).toBeTruthy();
    }
    // NO_DEMAND is a normal state of a healthy city, not something to flag.
    expect(ACTIONABLE_BLOCKERS.has('NO_DEMAND')).toBe(false);
    expect(ACTIONABLE_BLOCKERS.has('NO_POWER')).toBe(true);
  });

  it('should count blockers across the map', () => {
    const grid = city();
    for (let x = 3; x <= 7; x++) grid.setCell(x, 6, { zoneType: ZoneType.RESIDENTIAL_LOW });
    const summary = summariseZoneBlockers(grid, deps({ isPowered: () => false }));
    expect(summary.NO_POWER).toBe(5);
    expect(summary.NO_WATER).toBe(0);
  });
});

describe('the diagnosis agrees with the growth gate it describes', () => {
  it('should say "nothing wrong" exactly when a building actually appears', () => {
    // The oracle here has to be tryGrow, not canGrow. canGrow is only the first
    // half of the gate — it knows nothing about whether BUILDING_TYPES holds a
    // building for this zone at the density the road permits, which is the half
    // that silently killed four zone/road pairings. A matrix anchored on
    // canGrow agrees with a diagnosis that is wrong in exactly the same way.
    for (const hasPower of [true, false]) {
      for (const hasWater of [true, false]) {
        for (const demand of [50, 0]) {
          for (const withRoad of [true, false]) {
            const label = `power=${hasPower} water=${hasWater} demand=${demand} road=${withRoad}`;
            const rciDemand = { residential: demand, commercial: demand, industrial: demand };
            const build = () => {
              const g = new Grid(12, 12);
              if (withRoad) {
                for (let x = 1; x <= 9; x++) g.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
              }
              g.setCell(5, 6, { zoneType: ZoneType.RESIDENTIAL_LOW });
              return g;
            };

            const blocker = getZoneBlocker(build(), 5, 6, {
              isPowered: () => hasPower, isWatered: () => hasWater, rciDemand,
            });
            // tryGrow writes to the grid, so it gets its own copy.
            const grew = new BuildingGrowth(build())
              .tryGrow(5, 6, { hasPower, hasWater, rciDemand });

            expect(blocker === null, label).toBe(grew);
          }
        }
      }
    }
  });
});
