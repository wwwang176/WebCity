import type { PolicyScale } from '../../district/PolicyBilling';

/**
 * 補齊計費規模的欄位，沒給的填 0。
 *
 * 多數計費測試只關心其中一兩個量。每個字面值都寫滿六個欄位的話，真正在驗的那一個
 * 會被其他五個淹掉 —— 而填 0 本身是安全的:0 個單位就是不收錢。
 */
export function scaleOf(partial: Partial<PolicyScale> = {}): PolicyScale {
  return {
    population: 0,
    districtCells: 0,
    districtRoadCells: 0,
    babies: 0,
    children: 0,
    teens: 0,
    clinicPatients: 0,
    chargedDrivers: 0,
    ...partial,
  };
}
