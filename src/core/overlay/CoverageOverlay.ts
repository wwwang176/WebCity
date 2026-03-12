/**
 * Data-driven mapping from coverage overlay types to their service providers.
 * Eliminates duplicated switch cases in buildOverlayData (OCP + DRY).
 */

export interface CoverageProvider {
  getCoverage(x: number, y: number): boolean;
}

/** Minimal interface for services that provide coverage overlay data. */
export interface CoverageServices {
  police: CoverageProvider;
  fire: CoverageProvider;
  health: CoverageProvider;
  education: CoverageProvider;
  parks: CoverageProvider;
  garbage: CoverageProvider;
}

type CoverageOverlayType = 'police' | 'fire' | 'health' | 'education' | 'park' | 'garbage';

const SERVICE_MAP: Record<CoverageOverlayType, keyof CoverageServices> = {
  police: 'police',
  fire: 'fire',
  health: 'health',
  education: 'education',
  park: 'parks',
  garbage: 'garbage',
};

/** All overlay types that use the boolean getCoverage() pattern. */
export const COVERAGE_OVERLAY_TYPES: readonly string[] = Object.keys(SERVICE_MAP);

/** Get the coverage service for a given overlay type, or undefined if not a coverage overlay. */
export function getCoverageService(
  services: CoverageServices,
  overlayType: string,
): CoverageProvider | undefined {
  const key = SERVICE_MAP[overlayType as CoverageOverlayType];
  if (!key) return undefined;
  return services[key];
}
