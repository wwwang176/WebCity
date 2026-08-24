import type { GameState } from '../simulation/GameState';
import { getResidentialServiceRatios } from '../service/ServiceCoverageQuery';
import { shareFacilityLoad } from './facilityLoad';

/**
 * Services — the Services page of Overview.
 *
 * ## Capacity counts only the facilities that work
 *
 * An unpowered police station patrols nothing. Adding its capacity to the citywide total
 * divides citywide load by a number the city cannot reach, so the panel reads "spare
 * capacity" while the streets are out of control (BUG-138, BUG-100). `capacity` therefore
 * sums only `operational` facilities; broken ones stay in `facilities` (the player has to see
 * they are down) but do not count toward `capacity`.
 *
 * ## The panel's grouping is layout, not data
 *
 * The screen pairs Water with Sewage and Police with Fire; that is a layout decision. One
 * entry per service is emitted here, each carrying its own coverage. Merging is easy,
 * splitting is not.
 */

export interface FacilityStat {
  /** What this facility does. `school` is split further by `subtype` into elementary, high and university. */
  kind: string;
  subtype?: string;
  load: number;
  /** This facility's nominal capacity, reported even while it is down. The service-level `capacity` is the filtered one. */
  capacity: number;
  /** Powered, watered and road-connected. false means this one does nothing right now. */
  operational: boolean;
  /** Schools only: students who want a place here. Above capacity means under-provision. */
  demand?: number;
  /** Landfills only: how much this one incinerates per week. */
  burnedPerWeek?: number;
  /** Cemeteries only: how many bodies this one cremates per week. */
  crematedPerWeek?: number;
}

export interface ServiceStat {
  service: string;
  /** Share of the residential area this service covers, 0-1. */
  coverage: number;
  facilities: FacilityStat[];
  /** Citywide load. */
  load: number;
  /** Citywide usable capacity: **only operational facilities are summed**. */
  capacity: number;
  /** `load > capacity`. Zero capacity counts as a shortage; a citywide blackout is exactly when the warning belongs. */
  shortage: boolean;
}

export interface ServicesStats {
  services: ServiceStat[];
  /** Average of the nine coverage figures. The percentage at the panel's top left. */
  avgCoverage: number;
  /** How many services cover less than half the city. The panel's "Gaps" figure. */
  gaps: number;

  /** Citywide supply and demand, the same figures as the Infra page. */
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;

  sewageProduced: number;
  sewageUntreated: number;

  activeFires: number;

  garbageUncollected: number;
  garbageProducedPerWeek: number;
  garbageBurnedPerWeek: number;

  /** Bodies still awaiting pickup. */
  deathsAwaitingPickup: number;
  deathsPerWeek: number;
  cremationsPerWeek: number;
}

/** Total for the week. `undefined` means this facility does not track it. */
function weekTotal(daily: readonly number[] | undefined): number {
  return daily ? Math.round(daily.reduce((a, b) => a + b, 0)) : 0;
}

export function buildServicesStats(state: GameState): ServicesStats {
  const r = getResidentialServiceRatios(state);
  const services: ServiceStat[] = [];

  /** Records one service. `capacity` sums only the operational facilities. */
  const add = (service: string, coverage: number, facilities: FacilityStat[]): void => {
    let load = 0;
    let capacity = 0;
    for (const f of facilities) {
      load += f.load;
      if (f.operational) capacity += f.capacity;
    }
    // Zero capacity counts as a shortage. `capacity > 0 && load > capacity` would silence the
    // warning during a citywide blackout, exactly when it belongs (BUG-138).
    services.push({ service, coverage, facilities, load, capacity, shortage: load > capacity });
  };

  // ── Power ──
  const pwrSupply = state.power.getSupply();
  const pwrDemand = state.power.getDemand();
  add('power', r.poweredRatio, state.power.getPlants().map(p => ({
    kind: 'powerPlant',
    // Each plant takes a share of load proportional to its share of output. Plants have no
    // "broken" state; a dead one simply outputs 0.
    load: pwrSupply > 0 ? Math.round(pwrDemand * p.output / pwrSupply) : 0,
    capacity: Math.round(p.output),
    operational: true,
  })));

  // ── Water ──
  const wtrSupply = state.water.getSupply();
  const wtrDemand = state.water.getDemand();
  add('water', r.wateredRatio, state.water.getPlants().map(w => ({
    kind: 'waterPlant',
    load: wtrSupply > 0 ? Math.round(wtrDemand * w.output / wtrSupply) : 0,
    capacity: Math.round(w.output),
    operational: true,
  })));

  // ── Sewage ──
  const sewageProduced = Math.round(state.sewage.getProduced());
  const sewageSplit = shareFacilityLoad(
    sewageProduced,
    state.sewage.getTreatmentPlants(),
    tp => tp.capacity,
    tp => state.sewage.isPlantActive(tp.id),
  );
  add('sewage', r.sewageRatio, sewageSplit.shares.map(s => ({
    kind: 'sewagePlant', load: s.load, capacity: s.capacity, operational: s.active,
  })));

  // ── Police ──
  add('police', r.policeRatio, state.police.getStations().map(s => ({
    kind: 'policeStation',
    load: state.police.getStationLoad(s.id),
    capacity: s.capacity,
    operational: state.police.isFacilityOperationalById(s.id),
  })));

  // ── Fire ──
  add('fire', r.fireRatio, state.fire.getStations().map(s => ({
    kind: 'fireStation',
    load: state.fire.getStationLoad(s.id),
    capacity: s.capacity,
    operational: state.fire.isFacilityOperationalById(s.id),
  })));

  // ── Health ──
  add('health', r.healthRatio, state.health.getHospitals().map(h => ({
    kind: 'hospital',
    load: state.health.getHospitalLoad(h.id),
    capacity: h.capacity,
    operational: state.health.isFacilityOperationalById(h.id),
  })));

  // ── Education ──
  add('education', r.educationRatio, state.education.getSchools().map(s => ({
    kind: 'school',
    subtype: String(s.type),
    load: state.education.getSchoolEnrollment(s.id),
    capacity: s.capacity,
    operational: state.education.isSchoolOperational(s.id),
    // Enrolment tops out at capacity while demand can exceed it. The gap is what tells the
    // player how many more to build.
    demand: state.education.getSchoolDemand(s.id),
  })));

  // ── Garbage ──
  add('garbage', r.garbageRatio, state.garbage.getFacilities().map(f => ({
    kind: 'landfill',
    load: f.currentLoad,
    capacity: f.capacity,
    // Landfill availability is already applied by getTotalCapacity's filter; the per-facility
    // flag would only repeat it.
    operational: true,
    burnedPerWeek: weekTotal(f.burnDaily),
  })));

  // ── Death care ──
  add('deathCare', r.deathCareRatio, state.deathCare.getCemeteries().map(c => ({
    kind: 'cemetery',
    load: c.currentLoad,
    capacity: c.capacity,
    operational: true,
    crematedPerWeek: weekTotal(c.recentDaily),
  })));

  const coverages = services.map(s => s.coverage);

  return {
    services,
    avgCoverage: coverages.reduce((a, b) => a + b, 0) / coverages.length,
    gaps: coverages.filter(v => v < 0.5).length,

    powerSupply: pwrSupply,
    powerDemand: pwrDemand,
    waterSupply: wtrSupply,
    waterDemand: wtrDemand,

    sewageProduced,
    sewageUntreated: state.sewage.getUntreated(),

    activeFires: state.fire.getActiveFires().length,

    garbageUncollected: state.garbage.getUncollected(),
    garbageProducedPerWeek: state.garbage.getProducedPerWeek(),
    garbageBurnedPerWeek: state.garbage.getBurnedPerWeek(),

    deathsAwaitingPickup: state.deathCare.getPendingDeathQueue().length,
    deathsPerWeek: state.deathCare.getRecentDeaths(),
    cremationsPerWeek: state.deathCare.getRecentCremations(),
  };
}
