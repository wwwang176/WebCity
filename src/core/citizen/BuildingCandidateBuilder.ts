import { getBuildingType } from '../building/types';
import type { HousingCandidate } from './HousingScore';
import type { WorkplaceCandidate } from './WorkplaceScore';
import type { Grid } from '../grid/Grid';
import type { PollutionManager } from '../environment/Pollution';
import type { ParkService } from '../service/ParkService';

export interface BuildingPosition {
  pos: string;
  x: number;
  y: number;
  buildingId: number;
}

/** Build HousingCandidate[] from building positions. */
export function buildHousingCandidates(
  positions: readonly BuildingPosition[],
  grid: Grid,
  pollution: PollutionManager,
  parks: ParkService,
): HousingCandidate[] {
  const candidates: HousingCandidate[] = [];
  for (const b of positions) {
    const bt = getBuildingType(b.buildingId);
    if (!bt || bt.residents <= 0) continue;

    const cell = grid.getCell(b.x, b.y);
    const p = pollution.getPollutionAt(b.x, b.y);
    candidates.push({
      pos: b.pos,
      capacity: bt.residents,
      level: bt.level,
      landValue: cell ? cell.landValue : 0,
      groundPollution: p ? p.ground : 0,
      noisePollution: p ? p.noise : 0,
      serviceCoverage: cell ? cell.serviceCoverage : 0,
      hasPark: parks.getCoverage(b.x, b.y),
    });
  }
  return candidates;
}

/** Build WorkplaceCandidate[] from building positions. */
export function buildWorkplaceCandidates(
  positions: readonly BuildingPosition[],
): WorkplaceCandidate[] {
  const candidates: WorkplaceCandidate[] = [];
  for (const b of positions) {
    const bt = getBuildingType(b.buildingId);
    if (!bt || bt.workers <= 0) continue;

    candidates.push({
      pos: b.pos,
      capacity: bt.workers,
      zoneType: bt.zoneType,
    });
  }
  return candidates;
}
