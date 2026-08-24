import { getInfraConfigById, getRotatedSize } from '../building/InfraConfig';
import { RESERVED_TO_ROTATION } from '../building/InfraPlacement';

/**
 * The sources of influence behind each overlay.
 *
 * An overlay draws results: where fire coverage reaches, where commutes are long, where there
 * is no power. A result does not tell the player which building to act on — a patch of red may
 * mean a missing station or an existing one with no road. So every overlay also marks its
 * causes, in one shared blue: **blue is where these colours come from**.
 *
 * The vocabulary covers every overlay with facilities to point at, following the commute
 * overlay, where cyan stop markers make the distance from a red house obvious.
 */

/** The colour of a source. Fixed across overlays, so the player learns it once. */
export const OVERLAY_SOURCE_COLOR = 0x00e5ff;

export interface OverlaySourcePos {
  x: number;
  y: number;
}

/** The minimum map interface needed to look up footprints. */
export interface OverlaySourceGrid {
  getCell(x: number, y: number): { buildingId: number; reserved: number } | null;
}

/**
 * Each service only has to expose where its facilities are. The names deliberately follow each
 * service's existing methods rather than sitting behind a wrapper, which would be one more
 * mapping to maintain and one more thing to drift as the services change.
 */
export interface OverlaySourceContext {
  power: { getPlants(): readonly OverlaySourcePos[] };
  water: { getPlants(): readonly OverlaySourcePos[] };
  police: { getStations(): readonly OverlaySourcePos[] };
  fire: { getStations(): readonly OverlaySourcePos[] };
  health: { getHospitals(): readonly OverlaySourcePos[] };
  education: { getSchools(): readonly OverlaySourcePos[] };
  parks: { getParks(): readonly OverlaySourcePos[] };
  garbage: { getFacilities(): readonly OverlaySourcePos[] };
  /** Transit stops. They are spread across the transport systems rather than owned by one service, so the caller assembles them. */
  transitStops: readonly OverlaySourcePos[];
}

/**
 * Overlay to the facilities that produce its colours.
 *
 * An overlay absent from this table has nothing to point at: land value, pollution, traffic,
 * districts and land use are results the whole city produces, and naming one building would
 * mislead.
 */
const OVERLAY_SOURCES: Record<string, (ctx: OverlaySourceContext) => readonly OverlaySourcePos[]> = {
  power: c => c.power.getPlants(),
  water: c => c.water.getPlants(),
  police: c => c.police.getStations(),
  // Red on the crime overlay is the result of distance from a police station, so its sources
  // are the same ones the police overlay uses.
  crime: c => c.police.getStations(),
  fire: c => c.fire.getStations(),
  health: c => c.health.getHospitals(),
  education: c => c.education.getSchools(),
  park: c => c.parks.getParks(),
  garbage: c => c.garbage.getFacilities(),
  commute: c => c.transitStops,
};

/** Whether this overlay has sources to point at. */
export function hasOverlaySources(type: string): boolean {
  return type in OVERLAY_SOURCES;
}

/**
 * Every cell covered by this overlay's sources.
 *
 * Returns **each cell of the footprint**, not the anchor. Highlighting is looked up by cell
 * coordinate while a multi-cell building hangs at its footprint centre (`x + (w-1)/2`,
 * rounded): a 2x2 fire station anchored at (10,10) is looked up at (11,11). Anchors alone
 * would leave none of these buildings lit.
 */
export function overlaySourceCells(
  grid: OverlaySourceGrid,
  ctx: OverlaySourceContext,
  type: string,
): OverlaySourcePos[] {
  const pick = OVERLAY_SOURCES[type];
  if (!pick) return [];

  const out: OverlaySourcePos[] = [];
  for (const f of pick(ctx)) {
    const cell = grid.getCell(f.x, f.y);
    const cfg = cell ? getInfraConfigById(cell.buildingId) : undefined;
    if (!cfg) {
      // With no lookup result the anchor is marked: the facility was just demolished, or a
      // saved position falls outside this map.
      out.push({ x: f.x, y: f.y });
      continue;
    }
    const { w, h } = getRotatedSize(cfg.width, cfg.height, RESERVED_TO_ROTATION[cell!.reserved] ?? 0);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        out.push({ x: f.x + dx, y: f.y + dy });
      }
    }
  }
  return out;
}
