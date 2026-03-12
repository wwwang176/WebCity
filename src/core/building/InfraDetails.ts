/**
 * Data-driven mapping from InfraType → detail extractors for the info panel.
 * Eliminates 15-case switch in Game.ts (OCP + SRP).
 */
import type { InfraType } from './InfraConfig';
import { findAtPosition } from '../grid/GridHelpers';

/**
 * Minimal interface for services needed to extract infrastructure details.
 * Uses DIP — depends on abstractions, not concrete service classes.
 */
export interface InfraDetailContext {
  police: {
    getStations(): readonly { x: number; y: number; radius: number }[];
    getCoverage(x: number, y: number): boolean;
  };
  fire: {
    getStations(): readonly { x: number; y: number; radius: number }[];
    getActiveFires(): readonly unknown[];
  };
  health: {
    getHospitals(): readonly { x: number; y: number; capacity: number; radius: number }[];
  };
  education: {
    getSchools(): readonly { x: number; y: number; type: string; capacity: number; radius: number }[];
  };
  parks: {
    getParks(): readonly { x: number; y: number; radius: number }[];
  };
  garbage: {
    getFacilities(): readonly { x: number; y: number; capacity: number; currentLoad: number }[];
  };
  deathCare: {
    getCemeteries(): readonly { x: number; y: number; capacity: number; used: number; recentDaily: number[]; recentIndex: number; todayCremated: number }[];
  };
  power: {
    getPlants(): readonly { x: number; y: number; output: number; type: string }[];
  };
  water: {
    getPlants(): readonly { x: number; y: number; output: number }[];
  };
}

type DetailExtractor = (ctx: InfraDetailContext, cx: number, cy: number) => Record<string, string | number>;

/**
 * Data-driven mapping from InfraType → detail extractor function.
 * Adding a new infrastructure type only requires adding an entry here (OCP).
 */
export const INFRA_DETAIL_EXTRACTORS: Partial<Record<InfraType, DetailExtractor>> = {
  police: (ctx, cx, cy) => {
    const st = findAtPosition(ctx.police.getStations(), cx, cy);
    return { Radius: st?.radius ?? 15, Coverage: ctx.police.getCoverage(cx, cy) ? 'Yes' : 'No' };
  },
  fire: (ctx, cx, cy) => {
    const st = findAtPosition(ctx.fire.getStations(), cx, cy);
    return { Radius: st?.radius ?? 15, 'Active Fires': ctx.fire.getActiveFires().length };
  },
  hospital: (ctx, cx, cy) => {
    const h = findAtPosition(ctx.health.getHospitals(), cx, cy);
    return { Capacity: h?.capacity ?? 100, Radius: h?.radius ?? 12 };
  },
  school: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'elementary');
    return { Type: 'Elementary', Capacity: sc?.capacity ?? 200, Radius: sc?.radius ?? 10 };
  },
  school_high: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'highschool');
    return { Type: 'High School', Capacity: sc?.capacity ?? 300, Radius: sc?.radius ?? 12 };
  },
  school_univ: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'university');
    return { Type: 'University', Capacity: sc?.capacity ?? 500, Radius: sc?.radius ?? 15 };
  },
  park: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.parks.getParks(), cx, cy);
    return { Radius: p?.radius ?? 5 };
  },
  garbage: (ctx, cx, cy) => {
    const f = findAtPosition(ctx.garbage.getFacilities(), cx, cy);
    return { Capacity: f?.capacity ?? 1000, Load: f?.currentLoad ?? 0 };
  },
  sewage: () => ({ Status: 'Active' }),
  cemetery: (ctx, cx, cy) => {
    const c = findAtPosition(ctx.deathCare.getCemeteries(), cx, cy);
    const recent = c ? c.recentDaily.reduce((a, b) => a + b, 0) : 0;
    return { Capacity: c?.capacity ?? 500, Stored: c?.used ?? 0, 'Recent/month': recent };
  },
  power: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.power.getPlants(), cx, cy);
    return { Output: p?.output ?? 500, Type: p?.type ?? 'coal' };
  },
  water: (ctx, cx, cy) => {
    const w = findAtPosition(ctx.water.getPlants(), cx, cy);
    return { Output: w?.output ?? 500 };
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
