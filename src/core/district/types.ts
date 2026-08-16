import { TaxRates } from '../economy/Tax';

export enum PolicyType {
  NO_HEAVY_INDUSTRY = 'NO_HEAVY_INDUSTRY',
  ENCOURAGE_RECYCLING = 'ENCOURAGE_RECYCLING',
  HIGH_DENSITY_BAN = 'HIGH_DENSITY_BAN',
  ORGANIC_FOOD = 'ORGANIC_FOOD',
  TOURISM = 'TOURISM',
}

export enum Specialization {
  NONE = 'NONE',
  FARMING = 'FARMING',
  FORESTRY = 'FORESTRY',
  MINING = 'MINING',
  OIL = 'OIL',
  TOURISM = 'TOURISM',
  HIGH_TECH = 'HIGH_TECH',
}

export interface Policy {
  id: string;
  name: string;
  type: PolicyType;
  /**
   * 強度。0 = 關閉。
   *
   * 用一個等級欄位而不是三個 enum 成員（LIGHT / MEDIUM / HEAVY），是因為互斥必須
   * 自動成立 —— 分成三個成員的話，「不能同時開輕度和重度」會變成另一份要手動
   * 維護的檢查，而漏掉的那一條不會有任何徵兆。一個欄位只能是一個值。
   */
  level: 0 | 1 | 2 | 3;
}

export interface District {
  id: string;
  name: string;
  cells: Set<string>;
  taxRateOverride?: TaxRates;
  policies: Policy[];
  specialization: Specialization;
}
