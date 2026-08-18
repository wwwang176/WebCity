import { TaxRates } from '../economy/Tax';

export enum PolicyType {
  NO_HEAVY_INDUSTRY = 'NO_HEAVY_INDUSTRY',
  ENCOURAGE_RECYCLING = 'ENCOURAGE_RECYCLING',
  HIGH_DENSITY_BAN = 'HIGH_DENSITY_BAN',
  ORGANIC_FOOD = 'ORGANIC_FOOD',
  TOURISM = 'TOURISM',
  ENERGY_REGULATION = 'ENERGY_REGULATION',
  LEGALIZE_GAMBLING = 'LEGALIZE_GAMBLING',
  NIGHT_ECONOMY = 'NIGHT_ECONOMY',
  CURFEW = 'CURFEW',
  HERITAGE_PRESERVATION = 'HERITAGE_PRESERVATION',
  INDUSTRY_SUBSIDY = 'INDUSTRY_SUBSIDY',
  SURVEILLANCE_NETWORK = 'SURVEILLANCE_NETWORK',
  PAY_AS_YOU_THROW = 'PAY_AS_YOU_THROW',
  WATER_CONSERVATION = 'WATER_CONSERVATION',
  SEWAGE_STANDARDS = 'SEWAGE_STANDARDS',
  INDUSTRIAL_EMISSION_CONTROL = 'INDUSTRIAL_EMISSION_CONTROL',
  CHILDCARE_SUBSIDY = 'CHILDCARE_SUBSIDY',
  COMPULSORY_EDUCATION = 'COMPULSORY_EDUCATION',
  FREE_CLINIC = 'FREE_CLINIC',
  SMOKING_BAN = 'SMOKING_BAN',
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
  /**
   * 玩家選的色票索引。沒選過就是 undefined，圖層退回從 id 雜湊出來的顏色。
   *
   * 存索引而不是顏色本身:色票是固定的一組，存索引的話調整那組顏色時舊存檔會跟著
   * 更新，而存下來的色碼會永遠停在舊的那一版。
   */
  colorIndex?: number;
  cells: Set<string>;
  taxRateOverride?: TaxRates;
  policies: Policy[];
  specialization: Specialization;
}
