export interface TaxRates {
  residential: number;  // Income tax rate (applied to citizens in residential buildings)
  commercial: number;   // Legacy per-zone rate (kept for backward compat)
  industrial: number;   // Legacy per-zone rate (kept for backward compat)
  office: number;       // Legacy per-zone rate (kept for backward compat)
  business: number;     // Business tax rate (applied to commercial/industrial/office companyIncome)
}

/** Default tax rate percentage used across all tax categories */
export const DEFAULT_TAX_RATE = 9;

/**
 * 稅率收得下的範圍，單位是百分點的整數。
 *
 * 面板的滑桿與 agent API 讀同一份 —— 兩邊各寫一次的話，某一天調了滑桿而 API 沒跟上，
 * 程式就設得出面板顯示不出來的稅率。
 */
export const TAX_RATE_MIN = 1;
export const TAX_RATE_MAX = 20;

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
