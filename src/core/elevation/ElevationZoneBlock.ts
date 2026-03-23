import { type ElevationManager } from './ElevationManager';

/**
 * Check if a ground-level cell is blocked from zone placement
 * by an elevated road/rail above it.
 */
export function isBlockedByElevation(em: ElevationManager, x: number, y: number): boolean {
  return em.hasElevatedSegment(x, y);
}
