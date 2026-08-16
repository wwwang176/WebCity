import { policyCost } from '../district/PolicyBilling';
import type { PolicyScopeKind } from '../district/PolicyScope';
import { PolicyType } from '../district/types';

/**
 * Calculate total cost of active district policies.
 *
 * Only policies the simulation actually reads are billed. Three of the five
 * (ENCOURAGE_RECYCLING, ORGANIC_FOOD, TOURISM) have no effect anywhere in the
 * codebase, and charging for them was a pure $380/cycle drain the player could
 * not diagnose (BUG-091).
 *
 * 費用由 `POLICY_BILLING` 依規模算出來，不再是存在政策身上的一個常數 —— 固定費用
 * 在大城市等於免費，而且那個數字不會隨玩家把分區畫大而變動，看不出來錢花在哪。
 */
export function calculateDistrictPolicyCost(
  districts: readonly {
    cells: { size: number };
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  population: number,
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      // 這裡曾經另外擋一道 `isPolicyImplemented`。它是多餘的:`policyCost` 對沒有
      // 計費條目的型別回 0，而每一個計費條目都對應到一條真的有效果的條例 ——
      // 那個前提由 `PolicyBilling.test.ts` 的
      // `should only bill policies the simulation actually reads` 守著。
      total += policyCost(policy.type, policy.level, {
        population,
        districtCells: district.cells.size,
      });
    }
  }
  return total;
}

/**
 * 本期政策總支出:分區條例加全城條例。
 *
 * 抽出來是因為它有兩個消費端 —— 模擬迴圈的預算與預算面板。兩邊各寫一次加法的話，
 * 加了全城條例只改到一邊，面板與帳本就會靜靜地差一個數字。
 */
export function totalPolicyExpense(
  districts: readonly {
    cells: { size: number };
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  ordinances: { totalCost(population: number): number },
  population: number,
): number {
  return calculateDistrictPolicyCost(districts, population) + ordinances.totalCost(population);
}

export interface ExpenseBreakdown {
  roadMaintenance: number;
  serviceCost: number;
  policyCost: number;
  transportCost: number;
  elevatedMaintenance: number;
}

/** Calculate total expenses from all categories. */
export function calculateTotalExpenses(breakdown: ExpenseBreakdown): number {
  return breakdown.roadMaintenance
    + breakdown.serviceCost
    + breakdown.policyCost
    + breakdown.transportCost
    + breakdown.elevatedMaintenance;
}

/** 預算面板上的一行政策支出。 */
export interface PolicyExpenseLine {
  type: PolicyType;
  scope: PolicyScopeKind;
  /** 全城條例是 null。 */
  districtName: string | null;
  level: number;
  cost: number;
}

/**
 * 逐條列出本期政策支出。
 *
 * 預算面板只給一個總額的話，「政策從 $800 漲到 $4,200」會是一個玩家事後才發現的坑。
 * 看得見才做得了決定 —— 這也是這套設計不設預算上限的前提:上限會替玩家自動砍掉
 * 政策，而且砍得無聲無息。
 *
 * 合計必須等於 `totalPolicyExpense`（同一個 `population`）—— 明細跟帳對不起來的話，
 * 玩家看到的解釋是假的。費用為 0 的不列:限制型條例本來就不收費，列一行 $0 會讓
 * 玩家以為那是「免費的好處」。
 */
export function listPolicyExpenses(
  districts: readonly {
    name: string;
    cells: { size: number };
    policies: readonly { type: PolicyType; level: number }[];
  }[],
  ordinances: { getLevel(t: PolicyType): number },
  population: number,
): PolicyExpenseLine[] {
  const out: PolicyExpenseLine[] = [];
  for (const d of districts) {
    for (const p of d.policies) {
      const cost = policyCost(p.type, p.level, { population, districtCells: d.cells.size });
      if (cost === 0) continue;
      out.push({ type: p.type, scope: 'district', districtName: d.name, level: p.level, cost });
    }
  }
  for (const type of Object.values(PolicyType)) {
    const level = ordinances.getLevel(type);
    const cost = policyCost(type, level, { population, districtCells: 0 });
    if (cost === 0) continue;
    out.push({ type, scope: 'city', districtName: null, level, cost });
  }
  return out;
}
