import { PolicyType } from './types';
import { maxLevel } from './PolicyManager';

/** 費用跟著哪一個規模走。 */
export type BillingBasis = 'flat' | 'population' | 'districtCells';

/** 算費用要知道的規模。呼叫端負責填。 */
export interface PolicyScale {
  /** 全城人口。 */
  population: number;
  /** 這個條例所在分區的格數。全城條例填 0。 */
  districtCells: number;
}

/**
 * 每個條例怎麼收錢。
 *
 * 沒有條目 = 不收費。限制型條例（禁重工業、禁高密度）就屬於這一類:它們的代價是
 * 機會成本 —— 該區長不出高稅收的建築 —— 而不是市府掏錢。再收一次是雙重懲罰，
 * 而且那個數字沒有來由。
 *
 * `perUnit` 每一級一格，索引 0 是第 1 級，長度必須等於 `maxLevel(type)`。兩張表
 * 走散的話，第三級會靜靜地用第二級的價錢。
 *
 * 固定費用在大城市等於免費 —— 早期是限制，後期是無感。跟著規模走，費用才有來由，
 * 而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。
 */
export const POLICY_BILLING: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { basis: 'districtCells', perUnit: [1.5, 4, 9] },
  [PolicyType.TOURISM]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.ORGANIC_FOOD]: { basis: 'districtCells', perUnit: [2] },
  // 全城條例沒有分區格數可言 —— 它服務的是整座城市，所以按人口收。
  [PolicyType.ENERGY_REGULATION]: { basis: 'population', perUnit: [0.08, 0.22, 0.5] },
  [PolicyType.LEGALIZE_GAMBLING]: { basis: 'districtCells', perUnit: [4] },
  [PolicyType.NIGHT_ECONOMY]: { basis: 'districtCells', perUnit: [2, 5] },
  [PolicyType.CURFEW]: { basis: 'districtCells', perUnit: [1.5, 4] },
  [PolicyType.HERITAGE_PRESERVATION]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.INDUSTRY_SUBSIDY]: { basis: 'districtCells', perUnit: [3, 7] },
  [PolicyType.SURVEILLANCE_NETWORK]: { basis: 'population', perUnit: [0.06, 0.15] },
  [PolicyType.PAY_AS_YOU_THROW]: { basis: 'population', perUnit: [0.05, 0.12] },
};

function unitsOf(basis: BillingBasis, scale: PolicyScale): number {
  switch (basis) {
    case 'flat': return 1;
    case 'population': return scale.population;
    case 'districtCells': return scale.districtCells;
  }
}

/** 這個條例在這個等級、這個規模下，每個預算週期要花多少。 */
export function policyCost(type: PolicyType, level: number, scale: PolicyScale): number {
  if (level <= 0) return 0;
  const billing = POLICY_BILLING[type];
  if (!billing) return 0;
  const perUnit = billing.perUnit[Math.min(level, maxLevel(type)) - 1];
  if (perUnit === undefined) return 0;
  return perUnit * unitsOf(billing.basis, scale);
}
