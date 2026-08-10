import type { InfraType } from '../../../core/building/InfraConfig';
import type { CivicPlan } from './types';
import { CIVIC_MODELS } from './models';

/**
 * `InfraType` → `CivicPlan` 的查表。
 *
 * 這裡刻意沒有可變狀態 —— 實體是 `models/index.ts` 的靜態表。以前這裡是
 * 一張可變的 Map 加上 `registerCivicPlan`，靠每個 model 檔在載入時自己註冊；
 * 那個設計的失敗模式是靜默的：沒有人 import 到那個檔案，那種建築就不存在。
 */

/** 這種公共建築的 plan。還沒改造的回傳 `undefined`（仍走舊的手寫路徑）。 */
export function getCivicPlan(type: InfraType): CivicPlan | undefined {
  return CIVIC_MODELS[type];
}

/**
 * 已經改造完成的種類。
 *
 * showcase 的下拉選單與資料表測試都吃它 —— 手寫第二份清單的話，做完一種
 * 卻忘了加進選單，結果是「做好了但看不到」。
 */
export function civicTypesDone(): InfraType[] {
  return Object.keys(CIVIC_MODELS) as InfraType[];
}
