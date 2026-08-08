import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { serializeGameState, deserializeGameState } from '../Serializer';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { getInfraBuildingId } from '../../building/InfraConfig';
import { MULTI_CELL_OCCUPIED } from '../../building/InfraPlacement';
import { CURRENT_SAVE_VERSION } from '../migrations';

/**
 * BUG-074 made placeInfraOnGrid clear zoneType, because a facility standing on
 * zoned land otherwise emitted factory-grade pollution and counted toward zone
 * supply. That fixed new placements only. Every save taken before it still
 * carries the zoneType on its facility cells, and nothing on load removes it —
 * so a city loaded from an older save keeps the entire defect.
 *
 * migrateOldInfra made it worse: expanding a 1x1 facility to its real footprint
 * writes buildingId and reserved onto the secondary cells with a partial patch,
 * leaving whatever zoneType those cells happened to have. It runs on every
 * load, so it could re-create the condition on a save that was already clean.
 */
function savedCityWithZonedFacility() {
  const state = createGameState(12, 12);
  for (let x = 1; x <= 8; x++) state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });

  // What a pre-BUG-074 save looks like: facility cells that still carry a zone.
  const policeId = getInfraBuildingId('police');
  state.grid.setCell(3, 2, { buildingId: policeId, reserved: 0, zoneType: ZoneType.INDUSTRIAL });
  state.grid.setCell(4, 2, { buildingId: policeId, reserved: MULTI_CELL_OCCUPIED, zoneType: ZoneType.INDUSTRIAL });
  state.grid.setCell(3, 3, { buildingId: policeId, reserved: MULTI_CELL_OCCUPIED, zoneType: ZoneType.INDUSTRIAL });
  state.grid.setCell(4, 3, { buildingId: policeId, reserved: MULTI_CELL_OCCUPIED, zoneType: ZoneType.INDUSTRIAL });

  const saved = JSON.parse(serializeGameState(state));
  saved.version = 6; // taken before the migration existed
  return JSON.stringify(saved);
}

/** A pre-multi-cell save: one lone facility cell, no secondaries. */
function savedCityWithOldSingleCellFacility() {
  const state = createGameState(12, 12);
  for (let x = 1; x <= 8; x++) state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  // The whole 2x2 area was zoned; only the primary cell holds the facility.
  for (const [x, y] of [[3, 2], [4, 2], [3, 3], [4, 3]] as const) {
    state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW });
  }
  state.grid.setCell(3, 2, { buildingId: getInfraBuildingId('police'), reserved: 0 });

  const saved = JSON.parse(serializeGameState(state));
  saved.version = 6;
  return JSON.stringify(saved);
}

describe('loading an old save clears zoneType off infrastructure cells', () => {
  it('should clear the zone on every cell of a restored facility', () => {
    const state = deserializeGameState(savedCityWithZonedFacility());

    for (const [x, y] of [[3, 2], [4, 2], [3, 3], [4, 3]] as const) {
      expect(state.grid.getCell(x, y)!.zoneType, `(${x},${y})`).toBe(ZoneType.NONE);
    }
  });

  it('should keep the facility itself intact', () => {
    // Negative control: the migration must clear the zone, not the building.
    const state = deserializeGameState(savedCityWithZonedFacility());
    const policeId = getInfraBuildingId('police');

    expect(state.grid.getCell(3, 2)!.buildingId).toBe(policeId);
    expect(state.grid.getCell(4, 3)!.reserved).toBe(MULTI_CELL_OCCUPIED);
  });

  it('should not disturb ordinary zoned cells', () => {
    const state = deserializeGameState(savedCityWithZonedFacility());
    state.grid.setCell(7, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    expect(state.grid.getCell(7, 2)!.zoneType).toBe(ZoneType.COMMERCIAL_LOW);
  });

  it('should clear the zone off cells migrateOldInfra newly claims', () => {
    // The expansion writes buildingId and reserved with a partial patch; the
    // zoneType underneath survived unless something clears it.
    const state = deserializeGameState(savedCityWithOldSingleCellFacility());

    for (const [x, y] of [[3, 2], [4, 2], [3, 3], [4, 3]] as const) {
      const cell = state.grid.getCell(x, y)!;
      expect(cell.buildingId, `(${x},${y}) buildingId`).toBe(getInfraBuildingId('police'));
      expect(cell.zoneType, `(${x},${y}) zoneType`).toBe(ZoneType.NONE);
    }
  });

  it('should be reachable — the current version must be past the migration', () => {
    expect(CURRENT_SAVE_VERSION).toBeGreaterThanOrEqual(7);
  });
});
