/**
 * Data-driven mapping from InfraType → detail extractors for the info panel.
 * Eliminates 15-case switch in Game.ts (OCP + SRP).
 */
import type { InfraType } from './InfraConfig';
import { findAtPosition } from '../grid/GridHelpers';
import { SEWAGE } from '../service/SewageService';

/**
 * Minimal interface for services needed to extract infrastructure details.
 * Uses DIP — depends on abstractions, not concrete service classes.
 */
export interface InfraDetailContext {
  police: {
    getStations(): readonly { id: string; x: number; y: number; radius: number; capacity: number }[];
    getCoverage(x: number, y: number): boolean;
    getStationLoad(stationId: string): number;
  };
  fire: {
    getStations(): readonly { id: string; x: number; y: number; radius: number; capacity: number }[];
    getActiveFires(): readonly unknown[];
    getRecentExtinguished(): number;
    getStationLoad(stationId: string): number;
  };
  health: {
    getHospitals(): readonly { id: string; x: number; y: number; capacity: number; radius: number }[];
    getHospitalLoad(hospitalId: string): number;
  };
  education: {
    getSchools(): readonly { id: string; x: number; y: number; type: string; capacity: number; radius: number }[];
    getSchoolEnrollment(schoolId: string): number;
    getSchoolDemand(schoolId: string): number;
  };
  parks: {
    getParks(): readonly { x: number; y: number; radius: number }[];
  };
  garbage: {
    getFacilities(): readonly { x: number; y: number; capacity: number; currentLoad: number }[];
    getProducedPerWeek(): number;
    getBurnedPerWeek(): number;
  };
  deathCare: {
    getCemeteries(): readonly { x: number; y: number; capacity: number; used: number; pending: number; recentDaily: number[]; recentIndex: number; todayCremated: number; deathDaily: number[] }[];
  };
  power: {
    getPlants(): readonly { x: number; y: number; output: number; type: string }[];
    getSupply(): number;
    getDemand(): number;
    getSupplyRatio(): number;
  };
  water: {
    getPlants(): readonly { x: number; y: number; output: number }[];
    getSupply(): number;
    getDemand(): number;
    getSupplyRatio(): number;
  };
  citizens: {
    getCitizens(): readonly { homeId: string | null; age: number; lifeStage: string }[];
    getEnrolledCounts(): Record<'elementary' | 'highSchool' | 'university', number>;
  };
  sewage: {
    getTreatmentPlants(): readonly { x: number; y: number; capacity: number }[];
    getUntreated(): number;
    getProduced(): number;
  };
}

type DetailExtractor = (ctx: InfraDetailContext, cx: number, cy: number) => Record<string, string | number>;

/** Factory for school detail extractors — eliminates duplicate code across 3 school types (DRY). */
function makeSchoolExtractor(
  schoolType: string,
  label: string,
  defaultCap: number,
  defaultRadius: number,
): DetailExtractor {
  return (ctx, cx, cy) => {
    const sc = findAtPosition(ctx.education.getSchools().filter(s => s.type === schoolType), cx, cy);
    const cap = sc?.capacity ?? defaultCap;
    const enrolled = sc ? ctx.education.getSchoolEnrollment(sc.id) : 0;
    const demand = sc ? ctx.education.getSchoolDemand(sc.id) : 0;
    return { Type: label, Need: demand, Capacity: cap, Students: `${enrolled} / ${cap}`, Radius: sc?.radius ?? defaultRadius };
  };
}

/**
 * Data-driven mapping from InfraType → detail extractor function.
 * Adding a new infrastructure type only requires adding an entry here (OCP).
 */
export const INFRA_DETAIL_EXTRACTORS: Partial<Record<InfraType, DetailExtractor>> = {
  police: (ctx, cx, cy) => {
    const st = findAtPosition(ctx.police.getStations(), cx, cy);
    const load = st ? ctx.police.getStationLoad(st.id) : 0;
    return { Need: load, Capacity: st?.capacity ?? 500, Radius: st?.radius ?? 15 };
  },
  fire: (ctx, cx, cy) => {
    const st = findAtPosition(ctx.fire.getStations(), cx, cy);
    const load = st ? ctx.fire.getStationLoad(st.id) : 0;
    return { Need: load, Capacity: st?.capacity ?? 500, Radius: st?.radius ?? 15, 'Active Fires': ctx.fire.getActiveFires().length };
  },
  hospital: (ctx, cx, cy) => {
    const h = findAtPosition(ctx.health.getHospitals(), cx, cy);
    const load = h ? ctx.health.getHospitalLoad(h.id) : 0;
    return { Need: load, Capacity: h?.capacity ?? 100, Radius: h?.radius ?? 12 };
  },
  school: makeSchoolExtractor('elementary', 'Elementary', 200, 10),
  school_high: makeSchoolExtractor('highschool', 'High School', 300, 12),
  school_univ: makeSchoolExtractor('university', 'University', 500, 15),
  park: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.parks.getParks(), cx, cy);
    return { Radius: p?.radius ?? 5 };
  },
  garbage: (ctx, cx, cy) => {
    const f = findAtPosition(ctx.garbage.getFacilities(), cx, cy);
    const load = f?.currentLoad ?? 0;
    const cap = f?.capacity ?? 1000;
    return { Load: `${load} / ${cap}`, 'Produced/wk': ctx.garbage.getProducedPerWeek(), 'Burned/wk': ctx.garbage.getBurnedPerWeek() };
  },
  sewage: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.sewage.getTreatmentPlants(), cx, cy);
    const cap = p?.capacity ?? SEWAGE.DEFAULT_CAPACITY;
    return { Need: Math.round(ctx.sewage.getProduced()), Capacity: cap };
  },
  cemetery: (ctx, cx, cy) => {
    const c = findAtPosition(ctx.deathCare.getCemeteries(), cx, cy);
    const bodies = (c?.pending ?? 0) + (c?.used ?? 0);
    const cap = c?.capacity ?? 500;
    const deathsWk = c ? c.deathDaily.reduce((a: number, b: number) => a + b, 0) : 0;
    const crematedWk = c ? c.recentDaily.reduce((a: number, b: number) => a + b, 0) : 0;
    return { Bodies: `${bodies} / ${cap}`, 'Deaths/wk': deathsWk, 'Cremated/wk': crematedWk };
  },
  power: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.power.getPlants(), cx, cy);
    const ratio = ctx.power.getSupplyRatio();
    const ratioStr = `${(ratio * 100).toFixed(1)}%${ratio < 1 ? ' ⚠️' : ''}`;
    return {
      Output: p?.output ?? 1500,
      Type: p?.type ?? 'coal',
      'City Supply': Math.round(ctx.power.getSupply()),
      'City Demand': Math.round(ctx.power.getDemand()),
      'Supply Ratio': ratioStr,
    };
  },
  water: (ctx, cx, cy) => {
    const w = findAtPosition(ctx.water.getPlants(), cx, cy);
    const ratio = ctx.water.getSupplyRatio();
    const ratioStr = `${(ratio * 100).toFixed(1)}%${ratio < 1 ? ' ⚠️' : ''}`;
    return {
      Output: w?.output ?? 1500,
      'City Supply': Math.round(ctx.water.getSupply()),
      'City Demand': Math.round(ctx.water.getDemand()),
      'Supply Ratio': ratioStr,
    };
  },
  airport: () => ({ Status: 'Operational' }),
};

/** Get infrastructure details for the info panel. Returns empty object for unknown types. */
export function getInfraDetails(
  ctx: InfraDetailContext,
  type: InfraType,
  cx: number,
  cy: number,
): Record<string, string | number> {
  const extractor = INFRA_DETAIL_EXTRACTORS[type];
  return extractor ? extractor(ctx, cx, cy) : {};
}
