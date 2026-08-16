import { PolicyType } from './types';

/** 條例的作用範圍。 */
export type PolicyScopeKind = 'district' | 'city';

/**
 * 每個條例的作用範圍。
 *
 * 判斷法:**如果「整張地圖都套用」永遠不會比「只套一部分」差，它就該是全城的** ——
 * 那時候「在哪裡」根本不是決策，逼玩家先畫分區只是多按幾下。反過來，只在市中心收
 * 的壅塞費如果全城都收，就等於全面加稅，失去它原本的意義。
 *
 * 一個條例只能有一個範圍，而且**兩邊都要擋**:只擋一邊的話，另一邊仍然設得進去，
 * 效果會無聲地加倍而費用只收一次。
 *
 * 這是完整的 `Record` 不是 `Partial` —— 加了新的 `PolicyType` 卻忘了指定範圍時，
 * 型別檢查會擋下來。
 */
export const POLICY_SCOPE: Record<PolicyType, PolicyScopeKind> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'district',
  [PolicyType.HIGH_DENSITY_BAN]: 'district',
  [PolicyType.ENCOURAGE_RECYCLING]: 'district',
  [PolicyType.ORGANIC_FOOD]: 'district',
  [PolicyType.TOURISM]: 'district',
  // 電網的總需求是一個城市級的池子 —— 只在半個城市要求節能，省下來的電照樣進
  // 同一張電網。
  [PolicyType.ENERGY_REGULATION]: 'city',
};

/** 這個條例畫在分區上有意義嗎？ */
export function isDistrictScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'district';
}

/** 這個條例是全城的嗎？ */
export function isCityScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'city';
}
