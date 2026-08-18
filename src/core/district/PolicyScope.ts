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
  // 這五條回答的都是「在哪裡」:夜生活放在哪一區、哪一區要保存、補貼給哪一片
  // 工業地。套到全城就沒有選址可言了。
  [PolicyType.LEGALIZE_GAMBLING]: 'district',
  [PolicyType.NIGHT_ECONOMY]: 'district',
  [PolicyType.CURFEW]: 'district',
  [PolicyType.HERITAGE_PRESERVATION]: 'district',
  [PolicyType.INDUSTRY_SUBSIDY]: 'district',
  // 這兩條回答的是「要不要、多強」:監視器裝在哪幾條街不是玩家在決定的，
  // 垃圾費也不會只向某一區收。套到全城永遠不會更糟，那就該是全城的。
  [PolicyType.SURVEILLANCE_NETWORK]: 'city',
  [PolicyType.PAY_AS_YOU_THROW]: 'city',
  [PolicyType.WATER_CONSERVATION]: 'city',
  [PolicyType.SEWAGE_STANDARDS]: 'city',
  // 汙染源是逐格的工業格，好處與代價也都落在工業格上 ——「管哪一片工廠」是
  // 有意義的決策，套到全城只會在沒有汙染問題的工業區白扣收入。
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: 'district',
  // 生育率是全城一個數字。只在某一區補貼的話,決策會退化成「把分區畫在住宅密度
  // 最高的地方」—— 那是找最大的那一塊,不是取捨。
  [PolicyType.CHILDCARE_SUBSIDY]: 'city',
  // 國民教育的階數是一部法律,不是一塊地的屬性。只在某一區義務到大學的話,決策會
  // 退化成「把分區畫在學校旁邊」。
  [PolicyType.COMPULSORY_EDUCATION]: 'city',
  // 這兩條都是「要不要、多強」，不是「在哪裡」。而且分區範圍會讓代價落空:把禁菸令
  // 畫在純住宅區等於白拿健康 —— 那一區沒有商業可以付錢。
  [PolicyType.FREE_CLINIC]: 'city',
  [PolicyType.SMOKING_BAN]: 'city',
  // 只在市中心收的壅塞費如果全城都收，就等於全面加稅 —— 那就沒有「收費區」可言了。
  [PolicyType.CONGESTION_CHARGE]: 'district',
};

/** 這個條例畫在分區上有意義嗎？ */
export function isDistrictScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'district';
}

/** 這個條例是全城的嗎？ */
export function isCityScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'city';
}
