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
  CONGESTION_CHARGE = 'CONGESTION_CHARGE',
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
   * The level. 0 is off.
   *
   * One level field rather than three enum members (LIGHT / MEDIUM / HEAVY), because exclusivity
   * has to hold automatically: with three members, "light and heavy cannot both be on" becomes
   * another hand-maintained check whose omission has no symptom. One field holds one value.
   */
  level: 0 | 1 | 2 | 3;
}

export interface District {
  id: string;
  name: string;
  /**
   * The swatch index the player chose, or undefined when they never did, in which case the
   * overlay falls back to a hue hashed from the id.
   *
   * An index rather than the colour itself: the swatches are a fixed set, and storing the index
   * lets older saves follow adjustments to that set, while a stored colour value would stay on
   * the old version forever.
   */
  colorIndex?: number;
  cells: Set<string>;
  taxRateOverride?: TaxRates;
  policies: Policy[];
  specialization: Specialization;
}
