import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { getInfraBuildingId } from '../InfraConfig';
import { ABANDONED, BURNED, MULTI_CELL_OCCUPIED } from '../InfraPlacement';
import { isFacilityOperational } from '../../service/FacilityOperational';
import {
  getBuildingUtilityWarning, getBuildingUtilityWarnings, buildingCentre,
  collectBuildingUtilityWarnings, UTILITY_WARNING_MESSAGES, type UtilityWarningDeps,
} from '../BuildingUtilityWarning';

/**
 * An empty zoned cell can now say why it is not developing. A building that
 * has already been built and then LOSES its power says nothing at all — the
 * renderer never asked about power, so a blackout looked exactly like a normal
 * night. The only symptom was the building quietly abandoning itself weeks
 * later, by which time the cause was off screen.
 *
 * The rule has to be the one the simulation already uses, or the icon lies in
 * one of two directions: an icon over a power plant (which needs no power), or
 * silence over a bus depot that has genuinely stopped running.
 */
const ON: UtilityWarningDeps = { isPowered: () => true, isWatered: () => true };
const NO_POWER: UtilityWarningDeps = { isPowered: () => false, isWatered: () => true };
const NO_WATER: UtilityWarningDeps = { isPowered: () => true, isWatered: () => false };
const NEITHER: UtilityWarningDeps = { isPowered: () => false, isWatered: () => false };

/** A house at (5,5) on a road. */
function city(): Grid {
  const grid = new Grid(16, 16);
  for (let x = 1; x <= 12; x++) grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  return grid;
}

describe('a building says when it has lost a utility it needs', () => {
  it('should say nothing while everything is supplied', () => {
    expect(getBuildingUtilityWarning(city(), 5, 5, ON)).toBeNull();
  });

  it('should report a blackout', () => {
    expect(getBuildingUtilityWarning(city(), 5, 5, NO_POWER)).toBe('NO_POWER');
  });

  it('should report a water cut', () => {
    expect(getBuildingUtilityWarning(city(), 5, 5, NO_WATER)).toBe('NO_WATER');
  });

  it('should lead with power when both are out', () => {
    // One icon per building. Power is the one that also stops every facility
    // that would otherwise restore the water.
    expect(getBuildingUtilityWarning(city(), 5, 5, NEITHER)).toBe('NO_POWER');
  });

  it('should say nothing about empty land, roads or empty zoned cells', () => {
    const grid = city();
    expect(getBuildingUtilityWarning(grid, 9, 9, NEITHER)).toBeNull();
    expect(getBuildingUtilityWarning(grid, 5, 4, NEITHER)).toBeNull();
    grid.setCell(7, 5, { zoneType: ZoneType.RESIDENTIAL_LOW });
    expect(getBuildingUtilityWarning(grid, 7, 5, NEITHER)).toBeNull();
  });

  it('should say nothing about a ruin', () => {
    // A burnt-out house draws no power (BUG-131). Marking it as needing some
    // would send the player chasing a blackout that is not happening.
    for (const reserved of [BURNED, ABANDONED]) {
      const grid = city();
      grid.setCell(5, 5, { reserved });
      expect(getBuildingUtilityWarning(grid, 5, 5, NEITHER), `reserved=${reserved}`).toBeNull();
    }
  });

  it('should mark a multi-cell facility once, on its primary cell', () => {
    // A 3x3 university with nine icons stacked over it is not a warning, it is
    // a mess. Secondary cells carry MULTI_CELL_OCCUPIED.
    const grid = city();
    const uni = getInfraBuildingId('school_univ');
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        grid.setCell(8 + dx, 8 + dy, {
          buildingId: uni,
          reserved: (dx === 0 && dy === 0) ? 0 : MULTI_CELL_OCCUPIED,
        });
      }
    }
    expect(getBuildingUtilityWarning(grid, 8, 8, NO_POWER)).toBe('NO_POWER');
    expect(getBuildingUtilityWarning(grid, 9, 8, NO_POWER)).toBeNull();
    expect(getBuildingUtilityWarning(grid, 10, 10, NO_POWER)).toBeNull();
  });

  it('should never put a power icon on a power plant, nor a water icon on a water plant', () => {
    // These are the exemptions the simulation itself applies. An icon here
    // would tell the player to fix the thing that is doing the fixing.
    const grid = city();
    grid.setCell(2, 8, { buildingId: getInfraBuildingId('power') });
    expect(getBuildingUtilityWarning(grid, 2, 8, NO_POWER)).toBeNull();

    grid.setCell(4, 8, { buildingId: getInfraBuildingId('water') });
    expect(getBuildingUtilityWarning(grid, 4, 8, NO_WATER)).toBeNull();

    grid.setCell(6, 8, { buildingId: getInfraBuildingId('sewage') });
    expect(getBuildingUtilityWarning(grid, 6, 8, NO_WATER)).toBeNull();
  });

  it('should still fault a power plant that has no water', () => {
    // Only the power exemption applies to it.
    const grid = city();
    grid.setCell(2, 8, { buildingId: getInfraBuildingId('power') });
    expect(getBuildingUtilityWarning(grid, 2, 8, NO_WATER)).toBe('NO_WATER');
  });

  it('should agree with isFacilityOperational for every facility type', () => {
    // The binding assertion. If these two ever disagree, either a stopped
    // facility shows nothing or a working one is flagged — and the icon is
    // only worth drawing because it means "this has actually stopped".
    const types = ['power', 'water', 'sewage', 'police', 'fire', 'hospital',
                   'school', 'school_high', 'school_univ', 'garbage', 'park',
                   'cemetery', 'bus_stop', 'metro_station', 'train_station',
                   'ferry_dock', 'airport_s'] as const;
    const supplies: Array<[boolean, boolean]> = [[true, true], [false, true], [true, false], [false, false]];

    for (const type of types) {
      for (const [p, w] of supplies) {
        const grid = city();
        grid.setCell(3, 10, { buildingId: getInfraBuildingId(type) });
        const deps: UtilityWarningDeps = { isPowered: () => p, isWatered: () => w };
        const warning = getBuildingUtilityWarning(grid, 3, 10, deps);
        const operational = isFacilityOperational(3, 10, type, () => p, () => w);
        expect(warning === null, `${type} power=${p} water=${w}`).toBe(operational);
      }
    }
  });

  it('should collect every warned cell across the map', () => {
    const grid = city();
    for (let x = 5; x <= 8; x++) {
      grid.setCell(x, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    }
    grid.setCell(8, 5, { reserved: BURNED });

    const warned = collectBuildingUtilityWarnings(grid, NO_POWER);
    expect(warned.map(w => `${w.x},${w.y}`).sort()).toEqual(['5,5', '6,5', '7,5']);
    expect(warned.every(w => w.warning === 'NO_POWER')).toBe(true);

    expect(collectBuildingUtilityWarnings(grid, ON)).toHaveLength(0);
  });

  it('should report BOTH when both are out, power first', () => {
    // Showing only the first one handed the player a second problem they were
    // never told about: they restored the power, and a water badge appeared as
    // if it had just happened.
    expect(getBuildingUtilityWarnings(city(), 5, 5, NEITHER)).toEqual(['NO_POWER', 'NO_WATER']);
    expect(getBuildingUtilityWarnings(city(), 5, 5, NO_POWER)).toEqual(['NO_POWER']);
    expect(getBuildingUtilityWarnings(city(), 5, 5, NO_WATER)).toEqual(['NO_WATER']);
    expect(getBuildingUtilityWarnings(city(), 5, 5, ON)).toEqual([]);
  });

  it('should agree with the single-warning answer about the leading one', () => {
    for (const deps of [ON, NO_POWER, NO_WATER, NEITHER]) {
      const all = getBuildingUtilityWarnings(city(), 5, 5, deps);
      expect(getBuildingUtilityWarning(city(), 5, 5, deps)).toBe(all[0] ?? null);
    }
  });

  it('should emit one badge per missing utility, told apart by slot', () => {
    const grid = city();
    const warned = collectBuildingUtilityWarnings(grid, NEITHER);
    expect(warned).toHaveLength(2);
    expect(warned.map(w => w.warning)).toEqual(['NO_POWER', 'NO_WATER']);
    expect(warned.map(w => w.slot)).toEqual([0, 1]);
    expect(warned.every(w => w.slotCount === 2)).toBe(true);
  });

  it('should draw a single-cell building at its own cell', () => {
    const grid = city();
    const [w] = collectBuildingUtilityWarnings(grid, NO_POWER);
    expect([w!.drawX, w!.drawY]).toEqual([5, 5]);
  });

  it('should draw a multi-cell facility over the middle of its footprint', () => {
    // A facility is recorded at its top-left cell, so a 3x3 university badged
    // at (8,8) hung the marker off the corner of the site instead of over it.
    const grid = city();
    const uni = getInfraBuildingId('school_univ');
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        grid.setCell(8 + dx, 8 + dy, {
          buildingId: uni,
          reserved: (dx === 0 && dy === 0) ? 0 : MULTI_CELL_OCCUPIED,
        });
      }
    }
    const warned = collectBuildingUtilityWarnings(grid, NO_POWER)
      .filter(w => w.x === 8 && w.y === 8);
    expect(warned).toHaveLength(1);
    expect([warned[0]!.drawX, warned[0]!.drawY]).toEqual([9, 9]);
  });

  it('should follow the footprint when the facility is rotated', () => {
    // A 2x3 hospital turned 90 degrees is 3x2, and its centre moves with it.
    const grid = city();
    const hospital = getInfraBuildingId('hospital');
    const upright = buildingCentre({ buildingId: hospital, reserved: 0 }, 4, 8);
    const turned = buildingCentre({ buildingId: hospital, reserved: 5 }, 4, 8);
    expect(upright).toEqual({ drawX: 4.5, drawY: 9 });
    expect(turned).toEqual({ drawX: 5, drawY: 8.5 });
  });

  it('should have player-facing text for both warnings', () => {
    expect(UTILITY_WARNING_MESSAGES.NO_POWER).toBeTruthy();
    expect(UTILITY_WARNING_MESSAGES.NO_WATER).toBeTruthy();
  });
});
