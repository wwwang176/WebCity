import type { GameState } from '../simulation/GameState';

/**
 * 基礎設施 —— Overview 的 Infra 頁。
 *
 * ## 容量的兩半必須講同一批設施
 *
 * `getTotalCapacity()` 只數**接得到路而且有電**的掩埋場,`getActiveLoad()` 也只算
 * 那幾座的載重。把其中一半換成未過濾的總量，畫面就會印出「1800 / 0」而且標成健康的
 * 0%（BUG-155）。這裡兩邊都用過濾後的那一組,離線的容量另外用
 * `landfillStrandedCapacity` 講。
 */

export interface InfraStats {
  power: { supply: number; demand: number; ratio: number };
  water: { supply: number; demand: number; ratio: number };

  /** 掩埋場的載重與**可用**容量。 */
  landfillLoad: number;
  landfillCapacity: number;
  /** 蓋了但用不到的容量（沒路或沒電）。 */
  landfillStrandedCapacity: number;
  /** 還沒被收走、正在製造污染的垃圾。 */
  garbageUncollected: number;
  garbageProducedPerWeek: number;
  garbageBurnedPerWeek: number;

  sewageProduced: number;
  sewageUntreated: number;
  sewageCapacity: number;
  waterPollution: number;

  cemeteryUsed: number;
  cemeteryCapacity: number;
  /** 還沒被處理的遺體。滿了會讓全城幸福度 −20。 */
  unprocessedDeaths: number;
  deathsPerWeek: number;
  cremationsPerWeek: number;
}

/** 供需比。需求是 0 時有供給就算 2（面板的「綽綽有餘」），全空就是 0。 */
function supplyRatio(supply: number, demand: number): number {
  if (demand > 0) return supply / demand;
  return supply > 0 ? 2 : 0;
}

export function buildInfraStats(state: GameState): InfraStats {
  const pwrSupply = state.power.getSupply();
  const pwrDemand = state.power.getDemand();
  const wtrSupply = state.water.getSupply();
  const wtrDemand = state.water.getDemand();

  let cemeteryUsed = 0;
  let cemeteryCapacity = 0;
  for (const c of state.deathCare.getCemeteries()) {
    cemeteryUsed += c.currentLoad;
    cemeteryCapacity += c.capacity;
  }

  return {
    power: { supply: pwrSupply, demand: pwrDemand, ratio: supplyRatio(pwrSupply, pwrDemand) },
    water: { supply: wtrSupply, demand: wtrDemand, ratio: supplyRatio(wtrSupply, wtrDemand) },

    // 兩邊都是過濾後的那一組設施 —— 混用會印出「1800 / 0」而且標成健康（BUG-155）。
    landfillLoad: state.garbage.getActiveLoad(),
    landfillCapacity: state.garbage.getTotalCapacity(),
    landfillStrandedCapacity: state.garbage.getStrandedCapacity(),
    garbageUncollected: state.garbage.getUncollected(),
    garbageProducedPerWeek: state.garbage.getProducedPerWeek(),
    garbageBurnedPerWeek: state.garbage.getBurnedPerWeek(),

    sewageProduced: state.sewage.getProduced(),
    sewageUntreated: state.sewage.getUntreated(),
    sewageCapacity: state.sewage.getTreatmentCapacity(),
    waterPollution: state.sewage.getWaterPollution(),

    cemeteryUsed,
    cemeteryCapacity,
    unprocessedDeaths: state.deathCare.getUnprocessed(),
    deathsPerWeek: state.deathCare.getRecentDeaths(),
    cremationsPerWeek: state.deathCare.getRecentCremations(),
  };
}
