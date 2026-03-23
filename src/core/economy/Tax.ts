export interface TaxRates {
  residential: number;  // Income tax rate (applied to citizens in residential buildings)
  commercial: number;   // Legacy per-zone rate (kept for backward compat)
  industrial: number;   // Legacy per-zone rate (kept for backward compat)
  office: number;       // Legacy per-zone rate (kept for backward compat)
  business: number;     // Business tax rate (applied to commercial/industrial/office companyIncome)
}

/** Default tax rate percentage used across all tax categories */
export const DEFAULT_TAX_RATE = 9;

export const DEFAULT_TAX_RATES: TaxRates = {
  residential: DEFAULT_TAX_RATE,
  commercial: DEFAULT_TAX_RATE,
  industrial: DEFAULT_TAX_RATE,
  office: DEFAULT_TAX_RATE,
  business: DEFAULT_TAX_RATE,
};

export function calculateTaxRevenue(
  buildingCount: { residential: number; commercial: number; industrial: number; office: number },
  baseTax: { residential: number; commercial: number; industrial: number; office: number },
  rates: TaxRates,
): number {
  return (
    buildingCount.residential * baseTax.residential * (rates.residential / 100) +
    buildingCount.commercial * baseTax.commercial * (rates.commercial / 100) +
    buildingCount.industrial * baseTax.industrial * (rates.industrial / 100) +
    buildingCount.office * baseTax.office * (rates.office / 100)
  );
}
