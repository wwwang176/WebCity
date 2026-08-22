import type { GameState } from '../simulation/GameState';
import { LifeStage, EducationLevel } from '../citizen/types';
import { ZoneType, isCommercialZone } from '../grid/types';
import { getBuildingType } from '../building/types';

/**
 * 人口組成 —— Overview 的 Demographics 頁。
 *
 * ## 交叉表才是這一頁的重點
 *
 * 「大學畢業 300 人」跟「大學畢業 300 人，其中 210 人在做工業區的工作」是兩件事。
 * 前者看不出教育投資有沒有回收,後者看得出來。所以除了兩條分佈,這裡也給出
 * **教育 × 職業**與**教育 × 住宅等級**兩張交叉表。
 *
 * ## 分母不是人口
 *
 * 就業率的分母是**成年人**,不是總人口 —— 把嬰兒算成失業人口的話,一座年輕的城市
 * 永遠看起來像在崩潰。
 */

/** 交叉表的欄。`unemployed` 只出現在職業那張。 */
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
  /** 這一列的教育程度。 */
  education: string;
  /** 對應 `WORK_KEYS` / `HOUSING_LEVELS` 的欄。 */
  counts: number[];
  total: number;
}

export interface DemographicsStats {
  population: number;
  avgHappiness: number;
  avgHealth: number;

  /** 成年人數。就業率的分母。 */
  adults: number;
  employed: number;
  /** 找過工作但沒找到的成年人。 */
  unemployed: number;
  /** 沒有住處的居民。 */
  homeless: number;
  /** `employed / adults`。沒有成年人時是 0。 */
  employmentRate: number;

  /** 生命階段分佈。 */
  lifeStages: Bucket[];
  /** 教育程度分佈。 */
  education: Bucket[];
  /** 住在各等級住宅的人數。 */
  housingLevels: Bucket[];
  /** 有住處的人數 —— 住宅分佈的分母。 */
  withHome: number;
  /** 在各類分區上班的人數。 */
  workZones: Bucket[];
  /** 有工作的人數 —— 職業分佈的分母。 */
  workers: number;

  /** 教育 × 職業。欄依 `WORK_KEYS`。 */
  educationByWork: CrossRow[];
  /** 教育 × 住宅等級。欄依 `HOUSING_LEVELS`。 */
  educationByHousing: CrossRow[];
}

/** 工作地那一格屬於哪一類。無法歸類的算商業 —— 面板也是這樣算的。 */
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

    // 就業只問成年人。把嬰兒算成失業人口的話，一座年輕的城市永遠看起來像在崩潰。
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
      // 剛生成、還沒找過工作的不算失業 —— `unemployedSince` 才是「找過但沒找到」。
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
