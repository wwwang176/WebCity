import type { GameState } from '../simulation/GameState';

/**
 * Infrastructure — the Infra page of Overview.
 *
 * ## Both halves of capacity must describe the same facilities
 *
 * `getTotalCapacity()` counts only landfills that are **road-connected and powered**, and
 * `getActiveLoad()` sums the load of those same ones. Swapping either half for an unfiltered
 * total prints "1800 / 0" flagged as a healthy 0% (BUG-155). Both sides here use the filtered
 * set; offline capacity is reported separately as `landfillStrandedCapacity`.
 */

export interface InfraStats {
  power: { supply: number; demand: number; ratio: number };
  water: { supply: number; demand: number; ratio: number };

  /** Landfill load and **usable** capacity. */
  landfillLoad: number;
  landfillCapacity: number;
  /** Capacity that is built but unreachable (no road or no power). */
  landfillStrandedCapacity: number;
  /** Garbage not yet collected, generating pollution where it sits. */
  garbageUncollected: number;
  garbageProducedPerWeek: number;
  garbageBurnedPerWeek: number;

  sewageProduced: number;
  sewageUntreated: number;
  sewageCapacity: number;
  waterPollution: number;

  cemeteryUsed: number;
  cemeteryCapacity: number;
  /** Bodies not yet processed. A backlog costs the city -20 happiness. */
  unprocessedDeaths: number;
  deathsPerWeek: number;
  cremationsPerWeek: number;
}

/** Supply-to-demand ratio. With zero demand, any supply reads 2 (the panel's "ample"); nothing at all reads 0. */
function supplyRatio(supply: number, demand: number): number {
  if (demand > 0) return supply / demand;
  return supply > 0 ? 2 : 0;
}

export function buildInfraStats(state: GameState): InfraStats {
  const pwrSupply = state.power.getSupply();
  const pwrDemand = state.power.getDemand();
  const wtrSupply = state.water.getSupply();
  const wtrDemand = state.water.getDemand();

  let cemeteryUsed = 0;
  let cemeteryCapacity = 0;
  for (const c of state.deathCare.getCemeteries()) {
    cemeteryUsed += c.currentLoad;
    cemeteryCapacity += c.capacity;
  }

  return {
    power: { supply: pwrSupply, demand: pwrDemand, ratio: supplyRatio(pwrSupply, pwrDemand) },
    water: { supply: wtrSupply, demand: wtrDemand, ratio: supplyRatio(wtrSupply, wtrDemand) },

    // Both sides use the filtered facility set; mixing them prints "1800 / 0" flagged as healthy (BUG-155).
    landfillLoad: state.garbage.getActiveLoad(),
    landfillCapacity: state.garbage.getTotalCapacity(),
    landfillStrandedCapacity: state.garbage.getStrandedCapacity(),
    garbageUncollected: state.garbage.getUncollected(),
    garbageProducedPerWeek: state.garbage.getProducedPerWeek(),
    garbageBurnedPerWeek: state.garbage.getBurnedPerWeek(),

    sewageProduced: state.sewage.getProduced(),
    sewageUntreated: state.sewage.getUntreated(),
    sewageCapacity: state.sewage.getTreatmentCapacity(),
    waterPollution: state.sewage.getWaterPollution(),

    cemeteryUsed,
    cemeteryCapacity,
    unprocessedDeaths: state.deathCare.getUnprocessed(),
    deathsPerWeek: state.deathCare.getRecentDeaths(),
    cremationsPerWeek: state.deathCare.getRecentCremations(),
  };
}
