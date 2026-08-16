import { PolicyType } from './types';
import { POLICY_CONFIG, maxLevel } from './PolicyManager';
import { policyCost, type PolicyScale } from './PolicyBilling';

/**
 * 條例 UI 的純邏輯。
 *
 * Solid 那一層綁著 `getGame()`，專案既有慣例是不測 UI —— 但「按一次進幾級」
 * 「按鈕上寫什麼」是真的會錯的規則，不該只靠肉眼。放在 core 裡就測得到。
 */

/**
 * 按一次進一級，到頂再按回到 0。
 *
 * 一顆按鈕就走得完全部等級，不必為三級各放一顆。`current` 可能來自存檔而超過
 * 現在的表格長度 —— 那時候也要能回到 0，否則按鈕會卡住。
 */
export function nextPolicyLevel(current: number, type: PolicyType): number {
  const max = maxLevel(type);
  if (current >= max) return 0;
  return Math.max(0, Math.floor(current)) + 1;
}

/**
 * 按鈕上的字:圓點是等級，金額是**本期**費用。
 *
 * 費用寫在按鈕上而不是說明頁，是因為它會隨規模變動 —— 把分區畫大一倍數字就跳
 * 一倍，那是「依規模計費」最直接的回饋。
 *
 * 限制型條例不顯示金額:它們的代價是機會成本，標一個 $0 會讓玩家以為那是免費的
 * 好處。
 */
export function policyButtonText(type: PolicyType, level: number, scale: PolicyScale): string {
  const name = POLICY_CONFIG[type]?.name ?? type;
  if (level <= 0) return name;
  const dots = '●'.repeat(level);
  const cost = policyCost(type, level, scale);
  return cost > 0
    ? `✓${dots} ${name} ($${Math.round(cost)})`
    : `✓${dots} ${name}`;
}

/**
 * 每個條例每一級「給你什麼、要你付什麼」的一句話。
 *
 * 好處與代價寫在同一行，不是 tooltip —— 取捨是玩法，藏起來就沒有取捨。玩家要在
 * 按下去之前看得到代價。
 */
const EFFECT_SUMMARY: Partial<Record<PolicyType, readonly string[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    '垃圾 −15%　·　商業收入 −2%',
    '垃圾 −35%　·　商業收入 −8%',
    '垃圾 −55%　·　商業收入 −18%',
  ],
  [PolicyType.TOURISM]: ['稅收 +20%　·　犯罪率上升'],
  [PolicyType.ORGANIC_FOOD]: ['地價 +6　·　商業收入 −5%'],
  [PolicyType.ENERGY_REGULATION]: [
    '電力需求 −8%　·　商業收入 −1%、工業收入 −2%',
    '電力需求 −18%　·　商業收入 −3%、工業收入 −6%',
    '電力需求 −30%　·　商業收入 −6%、工業收入 −12%',
  ],
  [PolicyType.NO_HEAVY_INDUSTRY]: ['這一區蓋不了工業　·　少掉工業的稅基'],
  [PolicyType.HIGH_DENSITY_BAN]: ['這一區蓋不了高密度　·　少掉高密度的稅基'],
};

/** 這個條例這一級做什麼。等級 0 回空字串。 */
export function policyEffectSummary(type: PolicyType, level: number): string {
  if (level <= 0) return '';
  return EFFECT_SUMMARY[type]?.[level - 1] ?? '';
}

/** 一個分區所有條例本期的費用合計。 */
export function districtPolicyTotal(
  policies: readonly { type: PolicyType; level: number }[],
  scale: PolicyScale,
): number {
  let total = 0;
  for (const p of policies) total += policyCost(p.type, p.level, scale);
  return total;
}
