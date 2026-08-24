import type { PolicyScale } from '../../district/PolicyBilling';

/**
 * Fills out a billing scale, defaulting anything not given to 0.
 *
 * Most billing tests care about one or two of the quantities. Spelling all six fields into
 * every literal buries the one under test among the other five, and 0 is a safe default: zero
 * units means nothing is charged.
 */
export function scaleOf(partial: Partial<PolicyScale> = {}): PolicyScale {
  return {
    population: 0,
    districtCells: 0,
    districtRoadCells: 0,
    babies: 0,
    children: 0,
    teens: 0,
    clinicPatients: 0,
    chargedDrivers: 0,
    ...partial,
  };
}
