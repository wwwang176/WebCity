import type { GameState } from '../simulation/GameState';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { calculateAttractiveness, ATTRACTIVENESS, IMMIGRATION } from '../citizen/Migration';
import { isWorkingAge } from '../citizen/types';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { effectiveCityCrime, getAvgResidentialPollution } from '../environment/CityMetrics';
import { countResidentialCapacity, countWorkplaceJobs, isActiveZoneCell } from '../building/BuildingQueries';
import { SIMULATION } from '../simulation/SimulationConstants';

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

/**
 * 人口是 0 時的幸福度 —— 空城沒有人可以不開心。
 *
 * 用模擬的那個常數，不自己寫 70:兩邊各寫一次的話，調了一邊另一邊不會跟上，
 * 而分家的徵兆是「面板說沒吸引力、人卻一直搬進來」。
 */
const EMPTY_CITY_HAPPINESS = SIMULATION.DEFAULT_HAPPINESS;

export function buildSummaryStats(state: GameState): SummaryStats {
  const grid = state.grid;
  const population = state.citizens.getPopulation();
  const employed = state.citizens.getEmployedCount();

  const counts: Record<number, { count: number; capacity: number }> = {};
  for (const zt of ZONE_ORDER) counts[zt] = { count: 0, capacity: 0 };

  grid.forEachCell((cell) => {
    // 廢墟與燒毀的樓不算。它們住不了人也雇不了人 —— 算進去的話「空房 6889」
    // 裡有一部分是永遠住不進去的（BUG-359）。`isActiveZoneCell` 就是模擬那邊
    // `sumBuildingCapacity` 用的同一道篩子，順便擋掉多格建築的次要格。
    if (!isActiveZoneCell(cell) || cell.zoneType === ZoneType.NONE) return;
    const entry = counts[cell.zoneType];
    if (!entry) return;
    entry.count++;
    const bt = getBuildingType(cell.buildingId);
    if (bt) entry.capacity += bt.residents + bt.workers;
  });

  /**
   * 汙染要跟模擬問同一個問題。
   *
   * 這裡曾經自己掃一次「有建築**或**有劃分區」的所有格子求平均 —— 那包含工業區,
   * 而工業區的汙染是設計上就該有的,於是面板算出來的數字被工業區拉高,吸引力被
   * 多扣了分。模擬看的是**住宅區**的平均:居民感受得到的是自家門口的空氣,
   * 遠處工廠的煙不該算在他們頭上（BUG-359）。
   *
   * Environment 頁那個「Ground Avg」是另一個問題（全城平均），兩者本來就不同。
   */
  const avgPollution = getAvgResidentialPollution(grid);

  // 容量也走模擬用的那兩支，不從上面的分區表加總 —— 分區表是給人看的，
  // 這兩個數字是要拿去跟模擬對答案的。
  const totalHomes = countResidentialCapacity(grid);
  const totalJobs = countWorkplaceJobs(grid);

  const vacantHomes = Math.max(0, totalHomes - population);
  // 跟模擬用的是同一個定義。舊的 `totalJobs − population` 會在成熟城市印出
  // 「0 職缺、無法遷入」，而模擬那邊回報幾百個職缺並照樣讓人搬進來（BUG-166）。
  const jobOpenings = Math.max(0, totalJobs - employed);

  // 不四捨五入 —— 模擬那邊餵給 `calculateAttractiveness` 的是原始值。這裡先 round
  // 再算的話，兩邊的吸引力會差到 0.25 分，而門檻是一條硬線。顯示要幾位數是面板的事。
  const avgHappiness = population > 0
    ? state.citizens.getAverageHappiness()
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
