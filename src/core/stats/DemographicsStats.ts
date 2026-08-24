import type { GameState } from '../simulation/GameState';
import { LifeStage, EducationLevel } from '../citizen/types';
import { ZoneType, isCommercialZone } from '../grid/types';
import { getBuildingType } from '../building/types';

/**
 * Population makeup — the Demographics page of Overview.
 *
 * ## The cross-tabs are the point of this page
 *
 * "300 university graduates" and "300 university graduates, 210 of them working industrial
 * jobs" are different facts, and only the second shows whether the education spending paid
 * off. So alongside the two distributions this exposes an **education x work** and an
 * **education x housing level** cross-tab.
 *
 * ## The denominator is not population
 *
 * The employment rate divides by **adults**, not total population: counting babies as
 * unemployed makes a young city look permanently on the brink of collapse.
 */

/** Cross-tab columns. `unemployed` appears only in the work table. */
export const WORK_KEYS = ['commercial', 'industrial', 'office', 'unemployed'] as const;
export const HOUSING_LEVELS = [1, 2, 3] as const;

const EDU_ORDER = [
  EducationLevel.NONE, EducationLevel.ELEMENTARY,
  EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY,
] as const;

const STAGE_ORDER = [
  LifeStage.BABY, LifeStage.CHILD, LifeStage.TEEN,
  LifeStage.ADULT, LifeStage.SENIOR,
] as const;

export interface Bucket {
  key: string;
  count: number;
}

export interface CrossRow {
  /** The education level this row covers. */
  education: string;
  /** Columns matching `WORK_KEYS` / `HOUSING_LEVELS`. */
  counts: number[];
  total: number;
}

export interface DemographicsStats {
  population: number;
  avgHappiness: number;
  avgHealth: number;

  /** Adult count, the denominator of the employment rate. */
  adults: number;
  employed: number;
  /** Adults who looked for work and did not find any. */
  unemployed: number;
  /** Residents with no home. */
  homeless: number;
  /** `employed / adults`. 0 when there are no adults. */
  employmentRate: number;

  /** Life-stage distribution. */
  lifeStages: Bucket[];
  /** Education-level distribution. */
  education: Bucket[];
  /** How many residents live in housing of each level. */
  housingLevels: Bucket[];
  /** Residents with a home: the denominator of the housing distribution. */
  withHome: number;
  /** How many residents work in each zone category. */
  workZones: Bucket[];
  /** Residents with a job: the denominator of the work distribution. */
  workers: number;

  /** Education x work. Columns follow `WORK_KEYS`. */
  educationByWork: CrossRow[];
  /** Education x housing level. Columns follow `HOUSING_LEVELS`. */
  educationByHousing: CrossRow[];
}

/** Which category the workplace cell falls into. Unclassifiable cells count as commercial, matching the panel. */
function workKey(zoneType: number): string {
  if (isCommercialZone(zoneType)) return 'commercial';
  if (zoneType === ZoneType.INDUSTRIAL) return 'industrial';
  if (zoneType === ZoneType.OFFICE) return 'office';
  return 'commercial';
}

function parsePos(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export function buildDemographicsStats(state: GameState): DemographicsStats {
  const grid = state.grid;
  const citizens = state.citizens.getCitizens();
  const population = citizens.length;

  const stages: Record<string, number> = {};
  const edus: Record<string, number> = {};
  const housing: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const work: Record<string, number> = { commercial: 0, industrial: 0, office: 0 };

  const workCross: Record<string, Record<string, number>> = {};
  const housingCross: Record<string, Record<number, number>> = {};
  for (const e of EDU_ORDER) {
    workCross[e] = { commercial: 0, industrial: 0, office: 0, unemployed: 0 };
    housingCross[e] = { 1: 0, 2: 0, 3: 0 };
  }

  let happinessTotal = 0;
  let healthTotal = 0;
  let adults = 0;
  let employed = 0;
  let unemployed = 0;
  let homeless = 0;

  for (const c of citizens) {
    stages[c.lifeStage] = (stages[c.lifeStage] ?? 0) + 1;
    edus[c.education] = (edus[c.education] ?? 0) + 1;
    happinessTotal += c.happiness;
    healthTotal += c.health;
    if (c.homelessSince !== null) homeless++;

    if (c.homeId) {
      const [hx, hy] = parsePos(c.homeId);
      const cell = grid.getCell(hx, hy);
      const bt = cell ? getBuildingType(cell.buildingId) : undefined;
      if (bt) {
        housing[bt.level] = (housing[bt.level] ?? 0) + 1;
        housingCross[c.education]![bt.level] = (housingCross[c.education]![bt.level] ?? 0) + 1;
      }
    }

    // Employment asks about adults only. Counting babies as unemployed makes a young city
    // look permanently on the brink of collapse.
    if (c.lifeStage !== LifeStage.ADULT) continue;
    adults++;

    if (c.workplaceId) {
      employed++;
      const [wx, wy] = parsePos(c.workplaceId);
      const cell = grid.getCell(wx, wy);
      if (cell) {
        const k = workKey(cell.zoneType);
        work[k] = (work[k] ?? 0) + 1;
        workCross[c.education]![k] = (workCross[c.education]![k] ?? 0) + 1;
      }
    } else {
      // Freshly spawned citizens who have not looked for work are not unemployed;
      // `unemployedSince` marks "looked and did not find".
      if (c.unemployedSince !== null) unemployed++;
      workCross[c.education]!.unemployed = (workCross[c.education]!.unemployed ?? 0) + 1;
    }
  }

  const cross = (
    table: Record<string, Record<string | number, number>>,
    cols: readonly (string | number)[],
  ): CrossRow[] => EDU_ORDER.map((e) => {
    const counts = cols.map(c => table[e]![c] ?? 0);
    return {
      education: String(e),
      counts,
      total: counts.reduce((a, b) => a + b, 0),
    };
  });

  const housingBuckets = HOUSING_LEVELS.map(l => ({ key: `level${l}`, count: housing[l] ?? 0 }));
  const workBuckets = ['commercial', 'industrial', 'office']
    .map(k => ({ key: k, count: work[k] ?? 0 }));

  return {
    population,
    avgHappiness: population > 0 ? happinessTotal / population : 0,
    avgHealth: population > 0 ? healthTotal / population : 0,

    adults, employed, unemployed, homeless,
    employmentRate: adults > 0 ? employed / adults : 0,

    lifeStages: STAGE_ORDER.map(s => ({ key: String(s), count: stages[s] ?? 0 })),
    education: EDU_ORDER.map(e => ({ key: String(e), count: edus[e] ?? 0 })),
    housingLevels: housingBuckets,
    withHome: housingBuckets.reduce((a, b) => a + b.count, 0),
    workZones: workBuckets,
    workers: workBuckets.reduce((a, b) => a + b.count, 0),

    educationByWork: cross(workCross, WORK_KEYS),
    educationByHousing: cross(housingCross, HOUSING_LEVELS),
  };
}
