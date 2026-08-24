import { serviceSeverity } from '../../core/service/ServiceSeverity';
import type { ServiceCellStatus } from '../../core/service/ServiceStatusView';

/**
 * The row of service dots on the building panel.
 *
 * ## Why this is its own file
 *
 * Held in `BuildingPanel.tsx`, none of it can be tested: the unit tests run in a node environment with
 * no DOM, so a change reverting the dots to distance alone passes with the whole suite green.
 * Extracted, that change is caught.
 *
 * ## The colour says how bad it is; the hint says why
 *
 * A dot carries one dimension while the player has two problems to act on: **too far** calls for a
 * nearer facility, **too full** calls for a second one. So the colour takes the worse of the two and
 * the hover hint lays out both numbers.
 */

/** No coverage. Grey, which is a different matter from poor coverage's red. */
const NO_COVERAGE_COLOR = '#616161';

/**
 * Severity to colour: `-1` grey, `0` green, `0.5` yellow, `1` red.
 *
 * Green to yellow to red in two linear segments, yellow at the midpoint. The same progression as the
 * overlay's ten-step ramp, continuous here.
 */
export function severityColor(severity: number): string {
  if (severity < 0) return NO_COVERAGE_COLOR;
  const r = Math.min(1, severity);
  if (r <= 0.5) {
    const red = Math.round(255 * (r * 2));
    return `rgb(${red},200,50)`;
  }
  const green = Math.round(200 * (1 - (r - 0.5) * 2));
  return `rgb(255,${green},50)`;
}

/** One service dot's colour, taking the worse of distance and load. */
export function serviceDotColor(st: ServiceCellStatus): string {
  return severityColor(serviceSeverity(st.cost, st.load));
}

/**
 * The hover hint.
 *
 * The colour says only how bad it is, not whether the cause is distance or load, and that decides
 * where the player builds. Services with no notion of load — power, water — print the distance alone
 * rather than inventing a 0%.
 */
export function serviceDotHint(label: string, st: ServiceCellStatus): string {
  if (st.cost < 0) return `${label}: no coverage`;
  const parts = [`distance ${Math.round(Math.min(1, st.cost) * 100)}%`];
  if (st.load >= 0) parts.push(`facility load ${Math.round(st.load * 100)}%`);
  return `${label}: ${parts.join(' · ')}`;
}
