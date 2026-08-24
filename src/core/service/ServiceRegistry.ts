import type { CivicService } from './CivicService';
import type { GameState } from '../simulation/GameState';
import type { InfraType } from '../building/InfraConfig';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';
import type { RoadCoverageService, Facility } from './RoadCoverageService';
import type { SizedGrid } from '../grid/GridHelpers';
import { produceGarbageAndSewage } from './GarbageSewageProduction';
import { toPosKey } from '../grid/GridHelpers';

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

/** Utility keys — billed inside the civic total, but itemised separately in the economy panel. */
const UTILITY_SERVICE_KEYS = ['power', 'water'] as const;

/** Power and water plant upkeep, itemised. */
export function getUtilityMaintenanceCost(state: GameState): { power: number; water: number } {
  return {
    power: state.power.getMaintenanceCost(),
    water: state.water.getMaintenanceCost(),
  };
}

/**
 * Civic maintenance excluding the utility plants. The economy panel shows Power
 * Plants and Water Plants as their own rows, so adding the full civic total on
 * top of them charged those two twice.
 */
export function getCivicMaintenanceCostExcludingUtilities(state: GameState): number {
  return CIVIC_SERVICE_KEYS
    .filter(key => !(UTILITY_SERVICE_KEYS as readonly string[]).includes(key as string))
    .reduce((sum, key) => sum + (state[key] as unknown as CivicService).getMaintenanceCost(), 0);
}

/** Helper: update operational status for a RoadCoverageService subclass. */
function updateRoadServiceOps<F extends Facility>(
  service: RoadCoverageService<F>,
  infraType: InfraType,
  isPow: UtilityChecker,
  isWat: UtilityChecker,
  grid: SizedGrid,
): void {
  const changed = service.updateOperationalStatus(
    (f) => isFacilityOperational(f.x, f.y, infraType, isPow, isWat),
  );
  if (changed) service.recalculateCoverage(grid);
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
  // If status changed (facility gained/lost power or water), recalculate coverage immediately
  const grid = state.grid;
  updateRoadServiceOps(state.police, 'police', isPow, isWat, grid);
  updateRoadServiceOps(state.fire, 'fire', isPow, isWat, grid);
  updateRoadServiceOps(state.health, 'hospital', isPow, isWat, grid);
  updateRoadServiceOps(state.garbage, 'garbage', isPow, isWat, grid);
  updateRoadServiceOps(state.deathCare, 'cemetery', isPow, isWat, grid);

  // Update non-RoadCoverageService services
  // Mirror updateRoadServiceOps: a status change must trigger a coverage recalc,
  // otherwise an unpowered school keeps serving the whole neighbourhood.
  if (state.education.updateOperationalStatus(isPow, isWat)) {
    state.education.recalculateCoverage(grid);
  }
  state.parks.updateOperationalStatus(isPow, isWat);
  // Parks resolve coverage lazily in getCoverage, so they need no recalc.
  // Sewage precomputes a coverage Set at slow-slot 1 while this runs at slot 2,
  // so without an immediate recalc an unpowered plant kept supplying its whole
  // catchment for the rest of the cycle — and getPollutionSources skips
  // supplied cells, so the water-pollution penalty stayed suppressed with it.
  if (state.sewage.updateOperationalStatus(isPow, isWat)) {
    state.sewage.recalculateCoverage(grid as unknown as import('../grid/Grid').Grid);
  }

  state.police.tick();
  state.fire.tick();
  state.health.tick();
  state.education.tick();
  state.parks.tick();

  // Build occupancy maps for actual resident/worker counts
  const residentsByPos = new Map<string, number>();
  const workersByPos = new Map<string, number>();
  for (const c of state.citizens.getCitizens()) {
    if (c.homeId) residentsByPos.set(c.homeId, (residentsByPos.get(c.homeId) ?? 0) + 1);
    if (c.workplaceId) workersByPos.set(c.workplaceId, (workersByPos.get(c.workplaceId) ?? 0) + 1);
  }

  // Garbage + sewage production (delegated — OCP/DRY)
  const production = produceGarbageAndSewage(
    (fn) => state.grid.forEachCell(fn),
    state.garbage,
    state.sewage,
    (x, y) => residentsByPos.get(toPosKey(x, y)) ?? 0,
    (x, y) => workersByPos.get(toPosKey(x, y)) ?? 0,
    // The district and city-wide multipliers multiply. The city-wide one applies to every cell,
    // including those in no district, which is what city-wide means.
    (x, y) => state.policies.getGarbageMultiplier(state.districts.getDistrictAt(x, y)?.id ?? null)
      * state.ordinances.getGarbageMultiplier(),
    () => state.ordinances.getSewageLoadMultiplier(),
  );
  state.garbage.tick();
  state.sewage.tick(production.sewage);

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

  // Transport: airports
  for (const a of state.airport.getAirports()) {
    const infraType: InfraType = a.size === 'SMALL' ? 'airport_s' : a.size === 'MEDIUM' ? 'airport_m' : 'airport_l';
    result.push({ x: a.x, y: a.y, operational: isFacilityOperational(a.x, a.y, infraType, isPow, isWat) });
  }

  // Transport: bus stops, metro stations, train stations, ferry docks
  const transportKeys: { key: 'bus' | 'metro' | 'rail' | 'ferry'; infraType: InfraType }[] = [
    { key: 'bus', infraType: 'bus_stop' },
    { key: 'metro', infraType: 'metro_station' },
    { key: 'rail', infraType: 'train_station' },
    { key: 'ferry', infraType: 'ferry_dock' },
  ];
  for (const { key, infraType } of transportKeys) {
    for (const stop of state[key].getStops()) {
      result.push({ x: stop.x, y: stop.y, operational: isFacilityOperational(stop.x, stop.y, infraType, isPow, isWat) });
    }
  }

  return result;
}
