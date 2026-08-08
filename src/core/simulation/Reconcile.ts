import type { GameState } from './GameState';
import { parsePosKey } from '../grid/GridHelpers';
import { getInfraConfigById } from '../building/InfraConfig';
import { ABANDONED, BURNED, MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';

/**
 * Reconcile the registries against the grid.
 *
 * Two kinds of dangling reference accumulate, and both are silent:
 *
 *   - A service registry holds a facility whose cell no longer contains it.
 *     Its capacity is still summed, its coverage still spreads, and the player
 *     is billed for a building that is not there.
 *   - A citizen holds a homeId or workplaceId pointing at a cell with no live
 *     building. They occupy a seat nobody can see, count towards occupancy so
 *     the seat is never re-let, and never appear as homeless or unemployed.
 *
 * Every individual path that removes a building is supposed to clean up after
 * itself, and each fix so far has been for one path that did not — BUG-056
 * (burned), BUG-086 (abandoned), BUG-119 (retirement), BUG-164 (missing
 * building). This runs after a load and from the debug panel, and answers the
 * question directly instead of trusting that every path got it right.
 *
 * It only ever REMOVES references. It never invents a building, so a bug here
 * costs a facility, not a corrupted city.
 */
export interface ReconcileReport {
  /** Facilities dropped, as "service:id". */
  removedFacilities: string[];
  /** Citizens whose home no longer exists. */
  clearedHomes: number[];
  /** Citizens whose workplace no longer exists. */
  clearedWorkplaces: number[];
}

/** A building that exists and is in service — not empty, ruined or burned. */
function hasLiveBuilding(state: GameState, posKey: string): boolean {
  const pos = parsePosKey(posKey);
  if (!pos) return false;
  const cell = state.grid.getCell(pos.x, pos.y);
  if (!cell || cell.buildingId === 0) return false;
  if (cell.reserved === ABANDONED || cell.reserved === BURNED) return false;
  return true;
}

/**
 * Does (x, y) still hold this kind of infrastructure?
 *
 * A multi-cell facility is registered at its top-left cell, and the secondary
 * cells carry MULTI_CELL_OCCUPIED — so the anchor is the only one that can
 * answer, and it must carry an infrastructure id rather than any building.
 */
function hasInfrastructureAt(state: GameState, x: number, y: number): boolean {
  const cell = state.grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return false;
  if (cell.reserved === MULTI_CELL_OCCUPIED) return false;
  return getInfraConfigById(cell.buildingId) !== undefined;
}

interface FacilityRegistry {
  list(): ReadonlyArray<{ id: string; x: number; y: number }>;
  remove(id: string): void;
}

function registries(state: GameState): Array<{ name: string; reg: FacilityRegistry }> {
  return [
    { name: 'police', reg: { list: () => state.police.getStations(), remove: id => state.police.removeStation(id) } },
    { name: 'fire', reg: { list: () => state.fire.getStations(), remove: id => state.fire.removeStation(id) } },
    { name: 'health', reg: { list: () => state.health.getHospitals(), remove: id => state.health.removeHospital(id) } },
    { name: 'education', reg: { list: () => state.education.getSchools(), remove: id => state.education.removeSchool(id) } },
    { name: 'garbage', reg: { list: () => state.garbage.getFacilities(), remove: id => { state.garbage.removeFacility(id); } } },
    { name: 'deathCare', reg: { list: () => state.deathCare.getCemeteries(), remove: id => { state.deathCare.removeCemetery(id); } } },
    { name: 'parks', reg: { list: () => state.parks.getParks(), remove: id => state.parks.removePark(id) } },
  ];
}

export function reconcileGameState(state: GameState): ReconcileReport {
  const report: ReconcileReport = {
    removedFacilities: [], clearedHomes: [], clearedWorkplaces: [],
  };

  for (const { name, reg } of registries(state)) {
    // Snapshot first: remove() mutates the list being walked.
    for (const f of [...reg.list()]) {
      if (!hasInfrastructureAt(state, f.x, f.y)) {
        reg.remove(f.id);
        report.removedFacilities.push(`${name}:${f.id}`);
      }
    }
  }

  for (const c of state.citizens.getCitizens()) {
    if (c.homeId !== null && !hasLiveBuilding(state, c.homeId)) {
      c.homeId = null;
      c.homelessSince = state.clock.tick;
      report.clearedHomes.push(c.id);
    }
    if (c.workplaceId !== null && !hasLiveBuilding(state, c.workplaceId)) {
      c.workplaceId = null;
      report.clearedWorkplaces.push(c.id);
    }
  }

  return report;
}

/** Did reconciliation actually change anything? */
export function isClean(report: ReconcileReport): boolean {
  return report.removedFacilities.length === 0
    && report.clearedHomes.length === 0
    && report.clearedWorkplaces.length === 0;
}

/** Exported so a caller can ask the same question this pass asks. */
export { hasLiveBuilding };
