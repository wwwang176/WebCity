/**
 * RadiusCoverageMap — shared radius-based coverage counting for civic services.
 *
 * Eliminates duplicated coverage calculation logic between PoliceService and HealthService.
 * Pure logic module — no Three.js imports.
 */

import { toPosKey, forEachCellInRadius } from '../grid/GridHelpers';

export interface CoverableFacility {
  x: number;
  y: number;
  radius: number;
}

export class RadiusCoverageMap {
  private map = new Map<string, number>();

  /** Recalculate coverage from the given facilities. Clears previous state. */
  recalculate(facilities: readonly CoverableFacility[]): void {
    this.map.clear();
    for (const f of facilities) {
      forEachCellInRadius(f.x, f.y, f.radius, (x, y) => {
        const key = toPosKey(x, y);
        this.map.set(key, (this.map.get(key) ?? 0) + 1);
      });
    }
  }

  /** Check if a cell has any coverage. */
  hasCoverage(x: number, y: number): boolean {
    return (this.map.get(toPosKey(x, y)) ?? 0) > 0;
  }

  /** Get the number of facilities covering a cell. */
  getCoverageCount(x: number, y: number): number {
    return this.map.get(toPosKey(x, y)) ?? 0;
  }
}
