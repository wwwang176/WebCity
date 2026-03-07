export interface TaxRates {
  residential: number;
  commercial: number;
  industrial: number;
  office: number;
}

export const DEFAULT_TAX_RATES: TaxRates = {
  residential: 9,
  commercial: 9,
  industrial: 9,
  office: 9,
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
