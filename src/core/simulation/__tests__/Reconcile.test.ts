import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { reconcileGameState, isClean } from '../Reconcile';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { ABANDONED, BURNED, MULTI_CELL_OCCUPIED } from '../../building/InfraPlacement';
import { placeInfraOnGrid } from '../../building/InfraPlacement';

/**
 * Every path that removes a building is supposed to clean up the registries and
 * the citizens pointing at it, and every fix so far has been for one path that
 * did not: BUG-056 (burned), BUG-086 (abandoned), BUG-119 (retirement),
 * BUG-164 (a home with no building). This pass asks the question directly
 * rather than trusting that the next one gets it right.
 *
 * The two properties that matter are opposite in direction, so both are pinned:
 * it must remove what is genuinely dangling, and it must remove NOTHING from a
 * consistent city — a reconciliation that deletes a live hospital is worse than
 * the dangling reference it was written to clear.
 */
function cityWithServices() {
  const state = createGameState(24, 24);
  for (let x = 1; x <= 20; x++) {
    state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  }
  state.grid.setCell(3, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(9, 6, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

  // Real placements, so the grid genuinely holds them.
  placeInfraOnGrid(state.grid, 12, 6, 'police', 0);
  state.police.addStation(12, 6);
  placeInfraOnGrid(state.grid, 16, 6, 'park', 0);
  state.parks.addPark(16, 6);

  const c = state.citizens.createCitizen({ age: 100 })!;
  c.homeId = '3,6';
  c.workplaceId = '9,6';
  return { state, citizen: c };
}

describe('a consistent city is left completely alone', () => {
  it('should change nothing', () => {
    // Guards every case below: if reconciliation removed things
    // indiscriminately, they would all pass for the wrong reason.
    const { state, citizen } = cityWithServices();
    const report = reconcileGameState(state);

    expect(isClean(report), JSON.stringify(report)).toBe(true);
    expect(state.police.getStations()).toHaveLength(1);
    expect(state.parks.getParks()).toHaveLength(1);
    expect(citizen.homeId).toBe('3,6');
    expect(citizen.workplaceId).toBe('9,6');
  });

  it('should keep a multi-cell facility, whose other cells are only markers', () => {
    // A police station is 2x2 and registered at its top-left; the rest carry
    // MULTI_CELL_OCCUPIED. Asking the wrong cell would delete every one of them.
    const { state } = cityWithServices();
    expect(state.grid.getCell(13, 6)!.reserved).toBe(MULTI_CELL_OCCUPIED);
    reconcileGameState(state);
    expect(state.police.getStations()).toHaveLength(1);
  });
});

describe('a facility the grid no longer holds is dropped', () => {
  it('should remove a station whose cell was cleared', () => {
    const { state } = cityWithServices();
    state.grid.setCell(12, 6, { buildingId: 0, reserved: 0 });

    const report = reconcileGameState(state);

    expect(state.police.getStations()).toHaveLength(0);
    expect(report.removedFacilities).toEqual(['police:' + 'police_1']);
  });

  it('should stop billing for it', () => {
    // The player-visible consequence: a registry entry is charged maintenance
    // whether or not the building is there.
    const { state } = cityWithServices();
    const before = state.police.getMaintenanceCost();
    state.grid.setCell(12, 6, { buildingId: 0, reserved: 0 });
    reconcileGameState(state);
    expect(state.police.getMaintenanceCost()).toBeLessThan(before);
  });

  it('should remove a park whose cell now holds something else', () => {
    const { state } = cityWithServices();
    state.grid.setCell(16, 6, { buildingId: 1, reserved: 0 });
    reconcileGameState(state);
    expect(state.parks.getParks()).toHaveLength(0);
  });
});

describe('a citizen pointing at a building that is gone is released', () => {
  it('should clear a home that no longer exists', () => {
    const { state, citizen } = cityWithServices();
    state.grid.setCell(3, 6, { buildingId: 0, zoneType: ZoneType.NONE });

    const report = reconcileGameState(state);

    expect(citizen.homeId).toBeNull();
    expect(citizen.homelessSince, 'released without being marked homeless').not.toBeNull();
    expect(report.clearedHomes).toContain(citizen.id);
  });

  it('should clear a workplace that no longer exists', () => {
    const { state, citizen } = cityWithServices();
    state.grid.setCell(9, 6, { buildingId: 0, zoneType: ZoneType.NONE });

    const report = reconcileGameState(state);

    expect(citizen.workplaceId).toBeNull();
    expect(report.clearedWorkplaces).toContain(citizen.id);
  });

  it.each([
    ['a ruin', ABANDONED],
    ['a burned-out shell', BURNED],
  ])('should release them from %s', (_label, reserved) => {
    // Out of service is not the same as absent, and both leave the citizen
    // holding a seat nobody can see — occupancy still counts them, so the seat
    // is never re-let and they never show up as homeless.
    const { state, citizen } = cityWithServices();
    state.grid.setCell(3, 6, { reserved });

    reconcileGameState(state);

    expect(citizen.homeId).toBeNull();
  });

  it('should leave a citizen with no home alone', () => {
    const { state } = cityWithServices();
    const homeless = state.citizens.createCitizen({ age: 100 })!;
    homeless.homeId = null;
    homeless.workplaceId = null;

    const report = reconcileGameState(state);

    expect(report.clearedHomes).not.toContain(homeless.id);
    expect(report.clearedWorkplaces).not.toContain(homeless.id);
  });

  it('should cope with a malformed position key', () => {
    // Saves are not always well formed, and this pass runs on load.
    const { state, citizen } = cityWithServices();
    citizen.homeId = 'not-a-position';
    expect(() => reconcileGameState(state)).not.toThrow();
    expect(citizen.homeId).toBeNull();
  });
});
