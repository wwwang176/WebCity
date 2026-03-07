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
  cost: number;
  active: boolean;
}

export interface District {
  id: string;
  name: string;
  cells: Set<string>;
  taxRateOverride?: TaxRates;
  policies: Policy[];
  specialization: Specialization;
}
