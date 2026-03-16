/**
 * Data-driven mapping from InfraType → detail extractors for the info panel.
 * Eliminates 15-case switch in Game.ts (OCP + SRP).
 */
import type { InfraType } from './InfraConfig';
import { findAtPosition, parsePosKey } from '../grid/GridHelpers';
import { euclideanDistance } from '../grid/GridHelpers';

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
    getRecentExtinguished(): number;
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
    getSupply(): number;
    getDemand(): number;
    getSupplyRatio(): number;
  };
  water: {
    getPlants(): readonly { x: number; y: number; output: number }[];
  };
  citizens: {
    getCitizens(): readonly { homeId: string | null; age: number; lifeStage: string }[];
  };
  sewage: {
    getTreatmentPlants(): readonly { x: number; y: number; capacity: number }[];
    getUntreated(): number;
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
    return { Radius: st?.radius ?? 15, 'Active Fires': ctx.fire.getActiveFires().length, 'Extinguished/month': ctx.fire.getRecentExtinguished() };
  },
  hospital: (ctx, cx, cy) => {
    const h = findAtPosition(ctx.health.getHospitals(), cx, cy);
    const radius = h?.radius ?? 12;
    let residents = 0;
    if (h) {
      for (const c of ctx.citizens.getCitizens()) {
        if (!c.homeId) continue;
        const pos = parsePosKey(c.homeId);
        if (pos && euclideanDistance(pos.x, pos.y, h.x, h.y) <= radius) residents++;
      }
    }
    return { Capacity: h?.capacity ?? 100, Radius: radius, Residents: residents };
  },
  school: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'elementary');
    const students = ctx.citizens.getCitizens().filter(c => c.lifeStage === 'CHILD').length;
    return { Type: 'Elementary', Capacity: sc?.capacity ?? 200, Radius: sc?.radius ?? 10, Students: students };
  },
  school_high: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'highschool');
    const students = ctx.citizens.getCitizens().filter(c => c.lifeStage === 'TEEN').length;
    return { Type: 'High School', Capacity: sc?.capacity ?? 300, Radius: sc?.radius ?? 12, Students: students };
  },
  school_univ: (ctx, cx, cy) => {
    const sc = ctx.education.getSchools().find(s => s.x === cx && s.y === cy && s.type === 'university');
    const students = ctx.citizens.getCitizens().filter(c => c.lifeStage === 'ADULT' && c.age <= 25).length;
    return { Type: 'University', Capacity: sc?.capacity ?? 500, Radius: sc?.radius ?? 15, Students: students };
  },
  park: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.parks.getParks(), cx, cy);
    return { Radius: p?.radius ?? 5 };
  },
  garbage: (ctx, cx, cy) => {
    const f = findAtPosition(ctx.garbage.getFacilities(), cx, cy);
    return { Capacity: f?.capacity ?? 1000, Load: f?.currentLoad ?? 0 };
  },
  sewage: (ctx, cx, cy) => {
    const p = findAtPosition(ctx.sewage.getTreatmentPlants(), cx, cy);
    return { Capacity: p?.capacity ?? 200, Untreated: ctx.sewage.getUntreated() };
  },
  cemetery: (ctx, cx, cy) => {
    const c = findAtPosition(ctx.deathCare.getCemeteries(), cx, cy);
    const recent = c ? c.recentDaily.reduce((a, b) => a + b, 0) : 0;
    return { Capacity: c?.capacity ?? 500, Stored: c?.used ?? 0, 'Recent/month': recent };
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
