import type { CivicService } from './CivicService';
import type { GameState } from '../simulation/GameState';
import { type InfraType, getInfraConfig } from '../building/InfraConfig';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';
import type { RoadCoverageService, Facility } from './RoadCoverageService';

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

/** Helper: update operational status for a RoadCoverageService subclass. */
function updateRoadServiceOps<F extends Facility>(
  service: RoadCoverageService<F>,
  infraType: InfraType,
  isPow: UtilityChecker,
  isWat: UtilityChecker,
): void {
  service.updateOperationalStatus(
    (f) => isFacilityOperational(f.x, f.y, infraType, isPow, isWat),
  );
}

/**
 * Tick all civic services (OCP: adding a new service only requires updating this function).
 * Centralizes service ticking from SimulationLoop — services with special tick signatures
 * (garbage/sewage need population) are handled here.
 *
 * Before ticking, updates operational status based on power/water availability.
 */
export function tickAllCivicServices(state: GameState): void {
  const population = state.citizens.getPopulation();
  const isPow: UtilityChecker = (x, y) => state.power.isPowered(x, y);
  const isWat: UtilityChecker = (x, y) => state.water.isSupplied(x, y);

  // Update operational status for RoadCoverageService subclasses
  updateRoadServiceOps(state.police, 'police', isPow, isWat);
  updateRoadServiceOps(state.fire, 'fire', isPow, isWat);
  updateRoadServiceOps(state.health, 'hospital', isPow, isWat);
  updateRoadServiceOps(state.garbage, 'garbage', isPow, isWat);
  updateRoadServiceOps(state.deathCare, 'cemetery', isPow, isWat);

  // Update non-RoadCoverageService services
  state.education.updateOperationalStatus(isPow, isWat);
  state.parks.updateOperationalStatus(isPow, isWat);
  state.sewage.updateOperationalStatus(isPow, isWat);

  state.police.tick();
  state.fire.tick();
  state.health.tick();
  state.education.tick();
  state.parks.tick();
  state.garbage.tick(population);
  state.sewage.tick(population);
  state.deathCare.tick();
}

/** Facility position + operational status for renderer light sync. */
export interface FacilityOpEntry { x: number; y: number; operational: boolean }

/** Collect all civic-facility anchor positions with their operational status. */
export function collectFacilityOperationalStatus(state: GameState): FacilityOpEntry[] {
  const isPow: UtilityChecker = (x, y) => state.power.isPowered(x, y);
  const isWat: UtilityChecker = (x, y) => state.water.isSupplied(x, y);
  const result: FacilityOpEntry[] = [];

  const addFromRoadService = <F extends Facility>(
    service: RoadCoverageService<F>, infraType: InfraType,
  ) => {
    for (const f of service.getFacilities()) {
      result.push({ x: f.x, y: f.y, operational: isFacilityOperational(f.x, f.y, infraType, isPow, isWat) });
    }
  };

  addFromRoadService(state.police, 'police');
  addFromRoadService(state.fire, 'fire');
  addFromRoadService(state.health, 'hospital');
  addFromRoadService(state.garbage, 'garbage');
  addFromRoadService(state.deathCare, 'cemetery');

  // Education schools
  for (const s of state.education.getSchools()) {
    const infraType: InfraType = s.type === 'elementary' ? 'school' : s.type === 'highschool' ? 'school_high' : 'school_univ';
    result.push({ x: s.x, y: s.y, operational: isFacilityOperational(s.x, s.y, infraType, isPow, isWat) });
  }

  // Parks
  for (const p of state.parks.getParks()) {
    result.push({ x: p.x, y: p.y, operational: isFacilityOperational(p.x, p.y, 'park', isPow, isWat) });
  }

  // Sewage treatment plants
  for (const p of state.sewage.getTreatmentPlants()) {
    result.push({ x: p.x, y: p.y, operational: isFacilityOperational(p.x, p.y, 'sewage', isPow, isWat) });
  }

  return result;
}
