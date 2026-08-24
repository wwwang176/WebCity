/**
 * Overlay data: the two layers the player sees on screen, in a shape a program can read.
 *
 * ## Switching on an overlay actually shows two layers
 *
 * For Police:
 *
 * | | What it is | Values |
 * |---|---|---|
 * | **Ground tint** | whether this cell has police cover | 80 or 0, **binary** |
 * | **Building highlight** | the worse of distance and facility load | green to red, **10 steps** |
 *
 * What the player actually reads is the **second** layer: not "is there cover" but "how
 * marginal is this building's cover". Emitting only the first hands the agent a field of
 * uninformative 80s.
 *
 * ## The colour is not only distance
 *
 * Those 10 steps follow `serviceSeverity(cost / budget, load)`, the worse of distance and **how
 * full the facility serving that cell is**. Returning distance alone reports a cell next to a
 * hospital at twice its capacity as being in the best possible state (BUG-362).
 *
 * ## Not derived from the render output
 *
 * `Game.overlayHighlightCells` stores finished `{x, y, color}` records, and **only computes
 * them while that overlay is switched on**. Reading from there would make asking "how is police
 * coverage" require the player to open the overlay first, and `cost` / `ratio` are discarded
 * once the colour is chosen.
 *
 * So this reads from the **source**: `service.getCoveredCellsWithCost()` plus that service's
 * own budget. The colour is derived from it (`tier = floor(ratio * 10)`), not the reverse.
 */

import { serviceSeverity } from '../core/service/ServiceSeverity';

/** The services with a road-cost flood and a 10-step gradient. */
export const COVERAGE_SERVICES = ['police', 'fire', 'health', 'education', 'garbage'] as const;

export type CoverageService = typeof COVERAGE_SERVICES[number];

export interface CoverageSource {
  /** This service's cost budget. All five differ, and the wrong one skews every tier. */
  budget: number;
  /** `"x,y"` to the road-following cost from the nearest facility. */
  costs: ReadonlyMap<string, number>;
  /** Load over capacity for the facility serving this cell. `-1` means unavailable. */
  loadAt: (x: number, y: number) => number;
  /** The id of the facility serving this cell. */
  servingFacilityAt: (x: number, y: number) => string | null;
  /** The facilities producing these colours, drawn blue on screen. */
  sources: readonly { x: number; y: number }[];
  /** The 10-step gradient, supplied by `Game`, so colours are not computed twice. */
  gradient: readonly number[];
}

export interface CoverageCell {
  x: number;
  y: number;
  /** The road-following cost to get here. */
  cost: number;
  /** `cost / budget`, clamped to 1. Closer to 1 means **further from the facility**. */
  ratio: number;
  /**
   * How full the facility serving this cell is. 1.0 is exactly full, 2.0 is demand at twice
   * capacity. `-1` means unavailable, for services with no notion of load. **Not clamped to 1**:
   * exceeding 1 is information.
   */
  load: number;
  /** The facility serving this cell, which says which building to act on when an area is red. */
  facilityId: string | null;
  /**
   * The worse of distance and load, 0-1. **The on-screen colour follows this.**
   */
  severity: number;
  /** 0-9, the same steps as on screen. */
  tier: number;
  color: string;
}

export interface CoverageInfo {
  service: string;
  budget: number;
  /** How many cells are covered. */
  covered: number;
  cells: CoverageCell[];
  sources: readonly { x: number; y: number }[];
}

/** How to read this layer's numbers. */
export type OverlayKind = 'binary' | 'continuous' | 'categorical' | 'unknown';

/**
 * What each ground overlay's numbers mean.
 *
 * Left unsaid, a caller can only guess: a uniform field of 80 reads as a sampling failure, and
 * a district's 37 reads as an intensity to be compared against 62.
 */
const OVERLAY_KINDS: Record<string, OverlayKind> = {
  // Covered or not, with nothing in between.
  police: 'binary', fire: 'binary', health: 'binary',
  education: 'binary', park: 'binary', garbage: 'binary',
  // Genuine gradients whose numbers can be compared.
  traffic: 'continuous', pollution: 'continuous', landValue: 'continuous',
  crime: 'continuous', commute: 'continuous',
  // The numbers are **labels**, not quantities: a district's value is an identity, and
  // power/water are three-state.
  power: 'categorical', water: 'categorical',
  zone: 'categorical', district: 'categorical',
};

export function overlayKind(type: string): OverlayKind {
  return OVERLAY_KINDS[type] ?? 'unknown';
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** `"12,8"` to `[12, 8]`. */
function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/**
 * The building layer: how marginal the service is.
 *
 * `tier` uses exactly the formula `Game` uses to pick colours. One step out and an agent
 * reporting "that area is yellow" disagrees with the player's screen — the hardest kind of
 * error to spot, because both sides look reasonable.
 */
export function buildCoverage(service: string, src: CoverageSource): CoverageInfo {
  const cells: CoverageCell[] = [];
  const top = src.gradient.length - 1;

  for (const [key, cost] of src.costs) {
    const [x, y] = parseKey(key);
    const ratio = Math.min(1, cost / src.budget);
    const load = src.loadAt(x, y);
    // The tier goes through `serviceSeverity`, the same function `Game` uses to pick colours.
    const severity = Math.max(0, serviceSeverity(cost / src.budget, load));
    const tier = Math.min(top, Math.floor(severity * 10));
    cells.push({
      x, y, cost, ratio, load,
      facilityId: src.servingFacilityAt(x, y),
      severity,
      tier,
      color: hex(src.gradient[tier]!),
    });
  }

  return {
    service,
    budget: src.budget,
    covered: cells.length,
    cells,
    sources: src.sources,
  };
}

export interface OverlayCellInfo {
  x: number;
  y: number;
  value: number;
  color: string;
}

/**
 * The ground layer.
 *
 * `colorOf` is `OverlayRenderer.colorFor`: **asked**, never reimplemented. Colours computed in
 * two places diverge as soon as one side changes.
 */
export function buildOverlayCells(
  data: ReadonlyMap<string, number> | undefined,
  colorOf: (value: number) => number,
): OverlayCellInfo[] {
  if (!data) return [];
  const out: OverlayCellInfo[] = [];
  for (const [key, value] of data) {
    const [x, y] = parseKey(key);
    out.push({ x, y, value, color: hex(colorOf(value)) });
  }
  return out;
}
