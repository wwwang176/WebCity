import type { InfraType } from '../../../core/building/InfraConfig';
import type { CivicPlan } from './types';

/**
 * `InfraType` → `CivicPlan` 的查表。
 *
 * 這張表是**逐步填滿**的：19 種公共建築分批改造，改好一種就註冊一種。
 * 沒註冊的種類仍然走 `BuildingRenderer` 舊的手寫 `MeshLambertMaterial`
 * 路徑，所以半途的狀態是可用的，不必等全部做完。
 */
const PLANS: Partial<Record<InfraType, CivicPlan>> = {};

/** 這種公共建築的 plan。還沒改造的回傳 `undefined`。 */
export function getCivicPlan(type: InfraType): CivicPlan | undefined {
  return PLANS[type];
}

/**
 * 已經改造完成的種類。
 *
 * showcase 的下拉選單與資料表測試都吃它 —— 手寫第二份清單的話，做完一種
 * 卻忘了加進選單，結果是「做好了但看不到」。
 */
export function civicTypesDone(): InfraType[] {
  return Object.keys(PLANS) as InfraType[];
}

/**
 * 註冊一種公共建築。
 *
 * 用函式而不是直接寫在 `PLANS` 字面值裡：每棟建築一個檔案（見 spec §4.5），
 * 而 19 個 import 全部塞進這裡會讓這個模組變成所有 model 的相依中心 ——
 * 改一棟就重編全部。
 */
export function registerCivicPlan(type: InfraType, plan: CivicPlan): void {
  if (PLANS[type]) throw new Error(`公共建築 ${type} 註冊了兩次`);
  PLANS[type] = plan;
}

/**
 * 測試用：清空註冊表。
 *
 * 模組層級的狀態在同一個測試檔的各個 `it` 之間會延續 —— 不清的話，
 * 「列出已註冊的種類」這類斷言會被前一條測試留下的東西污染。
 * 與 `resetBuildingMaterial()` 同一個理由與同一個慣例。
 */
export function resetCivicPlans(): void {
  for (const k of Object.keys(PLANS)) delete PLANS[k as InfraType];
}
