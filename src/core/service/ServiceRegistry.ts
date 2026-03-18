import type { CivicService } from './CivicService';
import type { GameState } from '../simulation/GameState';

/** All civic-service keys on GameState that implement CivicService. */
const CIVIC_SERVICE_KEYS: readonly (keyof GameState)[] = [
  'power', 'water', 'police', 'fire', 'health',
  'education', 'parks', 'garbage', 'sewage', 'deathCare',
];

/** Get all civic services from GameState as a flat array (OCP-friendly). */
export function getCivicServices(state: GameState): CivicService[] {
  return CIVIC_SERVICE_KEYS.map(key => state[key] as unknown as CivicService);
}

/** Sum getMaintenanceCost() across all civic services. */
export function getTotalServiceMaintenanceCost(state: GameState): number {
  return getCivicServices(state).reduce((sum, svc) => sum + svc.getMaintenanceCost(), 0);
}

/**
 * Tick all civic services (OCP: adding a new service only requires updating this function).
 * Centralizes service ticking from SimulationLoop — services with special tick signatures
 * (garbage/sewage need population) are handled here.
 */
export function tickAllCivicServices(state: GameState): void {
  const population = state.citizens.getPopulation();
  state.police.tick();
  state.fire.tick();
  state.health.tick();
  state.education.tick();
  state.parks.tick();
  state.garbage.tick(population);
  state.sewage.tick(population);
  state.deathCare.tick();
}
