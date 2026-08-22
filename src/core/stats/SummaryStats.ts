import type { GameState } from '../simulation/GameState';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { calculateAttractiveness, ATTRACTIVENESS, IMMIGRATION } from '../citizen/Migration';
import { isWorkingAge } from '../citizen/types';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { effectiveCityCrime } from '../environment/CityMetrics';

/**
 * 城市總覽 —— Overview 的 Summary 頁。
 *
 * ## 這一頁在回答的問題是「為什麼沒有人搬進來」
 *
 * 中間那組勾選項（房子、工作、失業率、吸引力）不是裝飾:它們就是遷入的閘門。
 * 所以除了分數,這裡也給出**拖累分數最多的那一項**，那才是玩家（或呼叫端）該去修的東西。
 */

export interface ZoneCount {
  zone: string;
  /** 蓋起來的建築數。 */
  count: number;
  /** 這些建築加起來能裝多少人（住戶 + 工作機會）。 */
  capacity: number;
}

export interface AppealDrag {
  reason: string;
  /** 這一項扣了幾分。 */
  penalty: number;
}

export interface SummaryStats {
  population: number;
  employed: number;
  totalHomes: number;
  totalJobs: number;
  vacantHomes: number;
  /** `totalJobs − employed`。跟模擬用的定義同一個（BUG-166）。 */
  jobOpenings: number;
  avgHappiness: number;
  unemploymentRate: number;
  avgPollution: number;
  crimeRate: number;
  taxRate: number;

  /** 0–100。低於門檻就沒有人會搬進來。 */
  attractiveness: number;
  /** 遷入的門檻。 */
  attractivenessThreshold: number;
  /** 三個條件同時成立才有人搬進來:夠吸引人、有空房、有職缺。 */
  canMigrate: boolean;
  /** 分數不夠時，扣最多分的那一項。夠的話是 `null`。 */
  worstDrag: AppealDrag | null;
  /** 每一項各扣了幾分,由大到小。 */
  drags: AppealDrag[];

  zones: ZoneCount[];
  powerRatio: number;
  waterRatio: number;
  freightSupplyRatio: number;
  rci: { residential: number; commercial: number; industrial: number };
}

const ZONE_ORDER = [
  ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
  ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
  ZoneType.INDUSTRIAL, ZoneType.OFFICE,
] as const;

const ZONE_KEYS: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: 'residential_low',
  [ZoneType.RESIDENTIAL_HIGH]: 'residential_high',
  [ZoneType.COMMERCIAL_LOW]: 'commercial_low',
  [ZoneType.COMMERCIAL_HIGH]: 'commercial_high',
  [ZoneType.INDUSTRIAL]: 'industrial',
  [ZoneType.OFFICE]: 'office',
};

/** 人口是 0 時幸福度給 70 —— 空城沒有人可以不開心。 */
const EMPTY_CITY_HAPPINESS = 70;

export function buildSummaryStats(state: GameState): SummaryStats {
  const grid = state.grid;
  const population = state.citizens.getPopulation();
  const employed = state.citizens.getEmployedCount();

  const counts: Record<number, { count: number; capacity: number }> = {};
  for (const zt of ZONE_ORDER) counts[zt] = { count: 0, capacity: 0 };

  let pollutionTotal = 0;
  let pollutionCells = 0;
  grid.forEachCell((cell) => {
    if (cell.buildingId > 0 || cell.zoneType > 0) {
      pollutionTotal += cell.pollution;
      pollutionCells++;
    }
    if (cell.buildingId <= 0 || cell.zoneType === ZoneType.NONE) return;
    const entry = counts[cell.zoneType];
    if (!entry) return;
    entry.count++;
    const bt = getBuildingType(cell.buildingId);
    if (bt) entry.capacity += bt.residents + bt.workers;
  });
  const avgPollution = pollutionCells > 0 ? pollutionTotal / pollutionCells : 0;

  const totalHomes = (counts[ZoneType.RESIDENTIAL_LOW]?.capacity ?? 0)
    + (counts[ZoneType.RESIDENTIAL_HIGH]?.capacity ?? 0);
  const totalJobs = (counts[ZoneType.COMMERCIAL_LOW]?.capacity ?? 0)
    + (counts[ZoneType.COMMERCIAL_HIGH]?.capacity ?? 0)
    + (counts[ZoneType.INDUSTRIAL]?.capacity ?? 0)
    + (counts[ZoneType.OFFICE]?.capacity ?? 0);

  const vacantHomes = Math.max(0, totalHomes - population);
  // 跟模擬用的是同一個定義。舊的 `totalJobs − population` 會在成熟城市印出
  // 「0 職缺、無法遷入」，而模擬那邊回報幾百個職缺並照樣讓人搬進來（BUG-166）。
  const jobOpenings = Math.max(0, totalJobs - employed);

  const avgHappiness = population > 0
    ? Math.round(state.citizens.getAverageHappiness())
    : EMPTY_CITY_HAPPINESS;
  const taxRate = state.taxRates.residential ?? DEFAULT_TAX_RATE;

  let workingAge = 0;
  let jobless = 0;
  for (const c of state.citizens.getCitizens()) {
    if (!isWorkingAge(c.age)) continue;
    workingAge++;
    if (c.workplaceId === null) jobless++;
  }
  const unemploymentRate = workingAge > 0 ? jobless / workingAge : 0;
  // 模擬那邊（`SimulationLoop.getCityCrime`）用的是同一支。這裡曾經自己寫了一條
  // `Math.min(50, population * 0.02)` —— 那正好是 `calculateCrimeRate` 在
  // **一座警局都沒有**時的回傳值,所以蓋了警局面板照樣扣滿分（BUG-358）。
  const crimeRate = effectiveCityCrime(
    population,
    state.police.getStations().length,
    state.ordinances.getCrimeBonus(),
  );

  const attractiveness = calculateAttractiveness({
    jobOpenings, vacantHomes, avgHappiness, taxRate,
    pollution: avgPollution, crimeRate, unemploymentRate,
  });
  const threshold = IMMIGRATION.ATTRACTIVENESS_THRESHOLD;

  // 分數不夠的時候，光說「不吸引人」沒有用 —— 要知道是哪一項在扣分。
  const drags: AppealDrag[] = [
    { reason: 'low happiness', penalty: (EMPTY_CITY_HAPPINESS - avgHappiness) * ATTRACTIVENESS.HAPPINESS_WEIGHT },
    { reason: 'high taxes', penalty: taxRate * ATTRACTIVENESS.TAX_WEIGHT },
    { reason: 'pollution', penalty: avgPollution * ATTRACTIVENESS.POLLUTION_WEIGHT },
    { reason: 'crime', penalty: crimeRate * ATTRACTIVENESS.CRIME_WEIGHT },
    { reason: 'unemployment', penalty: unemploymentRate * ATTRACTIVENESS.UNEMPLOYMENT_WEIGHT },
  ].sort((a, b) => b.penalty - a.penalty);

  const freightDemand = state.freight.getLastDemand();
  const freightTrade = state.freight.getLastTrade();
  const effectiveProduction = freightDemand.production - freightTrade.exported + freightTrade.imported;

  return {
    population, employed, totalHomes, totalJobs, vacantHomes, jobOpenings,
    avgHappiness, unemploymentRate, avgPollution, crimeRate, taxRate,

    attractiveness,
    attractivenessThreshold: threshold,
    canMigrate: attractiveness > threshold && vacantHomes > 0 && jobOpenings > 0,
    worstDrag: attractiveness > threshold ? null : (drags[0] ?? null),
    drags,

    zones: ZONE_ORDER.map(zt => ({
      zone: ZONE_KEYS[zt] ?? String(zt),
      count: counts[zt]?.count ?? 0,
      capacity: counts[zt]?.capacity ?? 0,
    })),
    powerRatio: state.power.getSupplyRatio(),
    waterRatio: state.water.getSupplyRatio(),
    freightSupplyRatio: freightDemand.consumption > 0
      ? effectiveProduction / freightDemand.consumption
      : 1,
    rci: {
      residential: state.rciDemand?.residential ?? 0,
      commercial: state.rciDemand?.commercial ?? 0,
      industrial: state.rciDemand?.industrial ?? 0,
    },
  };
}
