import { isZoneBuilding } from '../building/InfraConfig';
import { getInfraConfigById } from '../building/InfraConfig';
import { forEachMultiCell, BURNED } from '../building/InfraPlacement';
import { FIRE } from './FireService';

/** Minimal resolved-fire data needed for damage processing. */
export interface ResolvedFire {
  x: number;
  y: number;
  damage: number;
}

/** A building update produced by fire damage (for UI notification). */
export interface FireBuildingUpdate {
  x: number;
  y: number;
  zoneType: number;
  level: number;
  burned: true;
}

export interface FireDamageResult {
  changed: boolean;
  updates: FireBuildingUpdate[];
}

interface GridLike {
  getCell(x: number, y: number): { buildingId: number; zoneType: number; reserved: number; serviceCoverage: number } | null;
  setCell(x: number, y: number, partial: Record<string, unknown>): void;
  readonly width: number;
  readonly height: number;
}

/** Clamp service coverage to building level 1-3 (duplicated from SimulationLoop to avoid circular dep). */
function toBuildingLevel(serviceCoverage: number): number {
  const raw = Math.ceil(serviceCoverage / 3) || 1;
  return Math.max(1, Math.min(3, raw));
}

/**
 * Process resolved fire events and apply BURNED status to affected zone buildings.
 * Extracted from SimulationLoop for SRP — fire damage logic is independent of simulation tick.
 */
export function applyFireDamage(grid: GridLike, resolvedFires: ResolvedFire[]): FireDamageResult {
  const updates: FireBuildingUpdate[] = [];
  let changed = false;

  for (const f of resolvedFires) {
    if (f.damage < FIRE.BURN_DAMAGE_THRESHOLD) continue;

    const cell = grid.getCell(f.x, f.y);
    if (!cell || !isZoneBuilding(cell.buildingId)) continue;

    changed = true;

    // Check if this is a multi-cell building
    const cfg = getInfraConfigById(cell.buildingId);
    if (cfg && (cfg.width > 1 || cfg.height > 1)) {
      // Multi-cell: mark ALL cells as BURNED
      forEachMultiCell(grid as any, f.x, f.y, (cx: number, cy: number) => {
        const c = grid.getCell(cx, cy);
        if (c) {
          grid.setCell(cx, cy, { reserved: BURNED });
          updates.push({ x: cx, y: cy, zoneType: c.zoneType, level: 1, burned: true });
        }
      });
    } else {
      grid.setCell(f.x, f.y, { reserved: BURNED });
      const level = toBuildingLevel(cell.serviceCoverage);
      updates.push({ x: f.x, y: f.y, zoneType: cell.zoneType, level, burned: true });
    }
  }

  return { changed, updates };
}
