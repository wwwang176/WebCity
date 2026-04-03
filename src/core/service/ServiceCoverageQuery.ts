import { type GameState } from '../simulation/GameState';
import { isResidentialZone } from '../grid/types';
import { SIMULATION } from '../simulation/SimulationConstants';

export interface ServiceFlags {
  isPowered: boolean;
  isWatered: boolean;
  hasPolice: boolean;
  hasFire: boolean;
  hasGarbage: boolean;
  hasHealth: boolean;
  hasEducation: boolean;
  hasDeathCare: boolean;
}

export interface ServiceRatios {
  poweredRatio: number;
  wateredRatio: number;
  policeRatio: number;
  fireRatio: number;
  garbageRatio: number;
  healthRatio: number;
  educationRatio: number;
  deathCareRatio: number;
}

/** Query all service coverage flags for a single cell. */
export function getCellServiceFlags(state: GameState, x: number, y: number): ServiceFlags {
  return {
    isPowered: state.power.isPowered(x, y),
    isWatered: state.water.isSupplied(x, y),
    hasPolice: state.police.getCoverage(x, y),
    hasFire: state.fire.getCoverage(x, y),
    hasGarbage: state.garbage.getCoverage(x, y),
    hasHealth: state.health.getCoverage(x, y),
    hasEducation: state.education.getCoverage(x, y),
    hasDeathCare: state.deathCare.getCoverage(x, y),
  };
}

/** Calculate the weighted service coverage score for a single cell.
 *  Power and water each count 2; all other services count 1.
 *  Inlined to avoid allocating a ServiceFlags object per call.
 */
export function getCellServiceScore(state: GameState, x: number, y: number): number {
  return (state.power.isPowered(x, y) ? 2 : 0)
    + (state.water.isSupplied(x, y) ? 2 : 0)
    + (state.police.getCoverage(x, y) ? 1 : 0)
    + (state.fire.getCoverage(x, y) ? 1 : 0)
    + (state.garbage.getCoverage(x, y) ? 1 : 0)
    + (state.health.getCoverage(x, y) ? 1 : 0)
    + (state.education.getCoverage(x, y) ? 1 : 0)
    + (state.deathCare.getCoverage(x, y) ? 1 : 0);
}

/** Convert service flags to the weighted numeric score. */
export function serviceFlagsToScore(f: ServiceFlags): number {
  return (f.isPowered ? 2 : 0)
    + (f.isWatered ? 2 : 0)
    + (f.hasPolice ? 1 : 0)
    + (f.hasFire ? 1 : 0)
    + (f.hasGarbage ? 1 : 0)
    + (f.hasHealth ? 1 : 0)
    + (f.hasEducation ? 1 : 0)
    + (f.hasDeathCare ? 1 : 0);
}

/** Calculate service coverage ratios across all residential buildings.
 *  Only counts cells that have a building (buildingId > 0) in a residential zone.
 */
export function getResidentialServiceRatios(state: GameState): ServiceRatios {
  let powered = 0;
  let watered = 0;
  let police = 0;
  let fire = 0;
  let garbage = 0;
  let health = 0;
  let education = 0;
  let deathCare = 0;
  let total = 0;

  state.grid.forEachCell((cell, x, y) => {
    if (cell.buildingId > 0 && isResidentialZone(cell.zoneType)) {
      total++;
      if (state.power.isPowered(x, y)) powered++;
      if (state.water.isSupplied(x, y)) watered++;
      if (state.police.getCoverage(x, y)) police++;
      if (state.fire.getCoverage(x, y)) fire++;
      if (state.garbage.getCoverage(x, y)) garbage++;
      if (state.health.getCoverage(x, y)) health++;
      if (state.education.getCoverage(x, y)) education++;
      if (state.deathCare.getCoverage(x, y)) deathCare++;
    }
  });

  return {
    poweredRatio: total > 0 ? powered / total : 0,
    wateredRatio: total > 0 ? watered / total : 0,
    policeRatio: total > 0 ? police / total : 0,
    fireRatio: total > 0 ? fire / total : 0,
    garbageRatio: total > 0 ? garbage / total : 0,
    healthRatio: total > 0 ? health / total : 0,
    educationRatio: total > 0 ? education / total : 0,
    deathCareRatio: total > 0 ? deathCare / total : 0,
  };
}

/**
 * Calculate a continuous service coverage score for abandonment stress.
 * Uses costRatio (0.0=nearest, 1.0=farthest, -1=uncovered) per service.
 * Power/water are binary (2 each). Other services contribute svc(costRatio).
 * Non-residential zones only count infrastructure + safety services.
 * Normalized to 0–SERVICE_MAX_RES scale.
 *
 * OCP: adding a new civic service only requires updating this function
 * (alongside getCellServiceScore, getCellServiceFlags, etc.)
 */
export function getCellServiceCostScore(
  state: GameState,
  x: number,
  y: number,
  isResidential: boolean,
): number {
  const svc = (ratio: number) => ratio < 0 ? 0 : 1 - ratio;
  const rawScore =
    (state.power.isPowered(x, y) ? 2 : 0) +
    (state.water.isSupplied(x, y) ? 2 : 0) +
    svc(state.police.getCostRatio(x, y)) +
    svc(state.fire.getCostRatio(x, y)) +
    (isResidential ? svc(state.garbage.getCostRatio(x, y)) : 0) +
    (isResidential ? svc(state.health.getCostRatio(x, y)) : 0) +
    (isResidential ? svc(state.education.getCostRatio(x, y)) : 0) +
    (isResidential ? svc(state.deathCare.getCostRatio(x, y)) : 0);
  return isResidential ? rawScore : rawScore * (SIMULATION.SERVICE_MAX_RES / SIMULATION.SERVICE_MAX_NON_RES);
}
