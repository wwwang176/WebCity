import type { GameState } from '../simulation/GameState';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { calculateAttractiveness, ATTRACTIVENESS, IMMIGRATION } from '../citizen/Migration';
import { isWorkingAge } from '../citizen/types';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { effectiveCityCrime, getAvgResidentialPollution } from '../environment/CityMetrics';
import { countResidentialCapacity, countWorkplaceJobs, isActiveZoneCell } from '../building/BuildingQueries';
import { SIMULATION } from '../simulation/SimulationConstants';

/**
 * City overview — the Summary page of Overview.
 *
 * ## The question this page answers is "why is nobody moving in"
 *
 * The checklist in the middle (homes, jobs, unemployment, appeal) is the migration gate
 * itself. So alongside the score this reports **the item dragging it down hardest**, which is
 * what the player (or the caller) has to fix.
 */

export interface ZoneCount {
  zone: string;
  /** Buildings actually standing. */
  count: number;
  /** How many people those buildings hold in total (residents + jobs). */
  capacity: number;
}

export interface AppealDrag {
  reason: string;
  /** How many points this item costs. */
  penalty: number;
}

export interface SummaryStats {
  population: number;
  employed: number;
  totalHomes: number;
  totalJobs: number;
  vacantHomes: number;
  /** `totalJobs - employed`, the same definition the simulation uses (BUG-166). */
  jobOpenings: number;
  avgHappiness: number;
  unemploymentRate: number;
  avgPollution: number;
  crimeRate: number;
  taxRate: number;

  /** 0-100. Below the threshold nobody moves in. */
  attractiveness: number;
  /** The migration threshold. */
  attractivenessThreshold: number;
  /** All three have to hold before anyone moves in: appealing enough, homes free, jobs open. */
  canMigrate: boolean;
  /** When the score falls short, the item costing the most. `null` when it does not. */
  worstDrag: AppealDrag | null;
  /** What each item costs, largest first. */
  drags: AppealDrag[];

  zones: ZoneCount[];
  powerRatio: number;
  waterRatio: number;
  freightSupplyRatio: number;
  rci: { residential: number; commercial: number; industrial: number };
}

const ZONE_ORDER = [
  ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
  ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
  ZoneType.INDUSTRIAL, ZoneType.OFFICE,
] as const;

const ZONE_KEYS: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: 'residential_low',
  [ZoneType.RESIDENTIAL_HIGH]: 'residential_high',
  [ZoneType.COMMERCIAL_LOW]: 'commercial_low',
  [ZoneType.COMMERCIAL_HIGH]: 'commercial_high',
  [ZoneType.INDUSTRIAL]: 'industrial',
  [ZoneType.OFFICE]: 'office',
};

/**
 * Happiness at zero population: an empty city has nobody to be unhappy.
 *
 * Takes the simulation's constant rather than a literal 70. Two copies drift as soon as one
 * is tuned, and the symptom is "the panel says unappealing while people keep moving in".
 */
const EMPTY_CITY_HAPPINESS = SIMULATION.DEFAULT_HAPPINESS;

export function buildSummaryStats(state: GameState): SummaryStats {
  const grid = state.grid;
  const population = state.citizens.getPopulation();
  const employed = state.citizens.getEmployedCount();

  const counts: Record<number, { count: number; capacity: number }> = {};
  for (const zt of ZONE_ORDER) counts[zt] = { count: 0, capacity: 0 };

  grid.forEachCell((cell) => {
    // Ruined and burned buildings do not count: they house nobody and employ nobody, so
    // including them puts permanently unreachable homes into a figure like "6889 free"
    // (BUG-359). `isActiveZoneCell` is the same filter the simulation's `sumBuildingCapacity`
    // uses, and it also rejects the secondary cells of multi-cell buildings.
    if (!isActiveZoneCell(cell) || cell.zoneType === ZoneType.NONE) return;
    const entry = counts[cell.zoneType];
    if (!entry) return;
    entry.count++;
    const bt = getBuildingType(cell.buildingId);
    if (bt) entry.capacity += bt.residents + bt.workers;
  });

  /**
   * Pollution has to ask the question the simulation asks.
   *
   * The simulation reads the average over **residential** cells: what residents feel is the
   * air at their own door, not smoke from a distant factory (BUG-359). Averaging over every
   * cell with a building **or** a zone pulls industry in, whose pollution is intentional, and
   * over-penalises appeal.
   *
   * The Environment page's "Ground Avg" answers a different question (the citywide average).
   */
  const avgPollution = getAvgResidentialPollution(grid);

  // Capacity also goes through the simulation's own two helpers instead of summing the zone
  // table above: the zone table is for display, these two numbers are checked against the
  // simulation.
  const totalHomes = countResidentialCapacity(grid);
  const totalJobs = countWorkplaceJobs(grid);

  const vacantHomes = Math.max(0, totalHomes - population);
  // The same definition the simulation uses. `totalJobs - population` prints "0 openings,
  // cannot migrate" in a mature city while the simulation reports hundreds of openings and
  // keeps letting people in (BUG-166).
  const jobOpenings = Math.max(0, totalJobs - employed);

  // No rounding: the simulation feeds `calculateAttractiveness` the raw value. Rounding first
  // moves appeal by as much as 0.25 points, and the threshold is a hard line. Display
  // precision is the panel's business.
  const avgHappiness = population > 0
    ? state.citizens.getAverageHappiness()
    : EMPTY_CITY_HAPPINESS;
  const taxRate = state.taxRates.residential ?? DEFAULT_TAX_RATE;

  let workingAge = 0;
  let jobless = 0;
  for (const c of state.citizens.getCitizens()) {
    if (!isWorkingAge(c.age)) continue;
    workingAge++;
    if (c.workplaceId === null) jobless++;
  }
  const unemploymentRate = workingAge > 0 ? jobless / workingAge : 0;
  // The same helper the simulation uses (`SimulationLoop.getCityCrime`). A local
  // `Math.min(50, population * 0.02)` is exactly what `calculateCrimeRate` returns with **no
  // police station at all**, so building one leaves the panel's penalty untouched (BUG-358).
  const crimeRate = effectiveCityCrime(
    population,
    state.police.getStations().length,
    state.ordinances.getCrimeBonus(),
  );

  const attractiveness = calculateAttractiveness({
    jobOpenings, vacantHomes, avgHappiness, taxRate,
    pollution: avgPollution, crimeRate, unemploymentRate,
  });
  const threshold = IMMIGRATION.ATTRACTIVENESS_THRESHOLD;

  // When the score falls short, "unappealing" on its own is not actionable; the caller needs
  // to know which item is costing what.
  const drags: AppealDrag[] = [
    { reason: 'low happiness', penalty: (EMPTY_CITY_HAPPINESS - avgHappiness) * ATTRACTIVENESS.HAPPINESS_WEIGHT },
    { reason: 'high taxes', penalty: taxRate * ATTRACTIVENESS.TAX_WEIGHT },
    { reason: 'pollution', penalty: avgPollution * ATTRACTIVENESS.POLLUTION_WEIGHT },
    { reason: 'crime', penalty: crimeRate * ATTRACTIVENESS.CRIME_WEIGHT },
    { reason: 'unemployment', penalty: unemploymentRate * ATTRACTIVENESS.UNEMPLOYMENT_WEIGHT },
  ].sort((a, b) => b.penalty - a.penalty);

  const freightDemand = state.freight.getLastDemand();
  const freightTrade = state.freight.getLastTrade();
  const effectiveProduction = freightDemand.production - freightTrade.exported + freightTrade.imported;

  return {
    population, employed, totalHomes, totalJobs, vacantHomes, jobOpenings,
    avgHappiness, unemploymentRate, avgPollution, crimeRate, taxRate,

    attractiveness,
    attractivenessThreshold: threshold,
    canMigrate: attractiveness > threshold && vacantHomes > 0 && jobOpenings > 0,
    worstDrag: attractiveness > threshold ? null : (drags[0] ?? null),
    drags,

    zones: ZONE_ORDER.map(zt => ({
      zone: ZONE_KEYS[zt] ?? String(zt),
      count: counts[zt]?.count ?? 0,
      capacity: counts[zt]?.capacity ?? 0,
    })),
    powerRatio: state.power.getSupplyRatio(),
    waterRatio: state.water.getSupplyRatio(),
    freightSupplyRatio: freightDemand.consumption > 0
      ? effectiveProduction / freightDemand.consumption
      : 1,
    rci: {
      residential: state.rciDemand?.residential ?? 0,
      commercial: state.rciDemand?.commercial ?? 0,
      industrial: state.rciDemand?.industrial ?? 0,
    },
  };
}
