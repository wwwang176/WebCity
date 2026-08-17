import { PolicyType } from './types';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, maxLevel } from './PolicyManager';
import { isDistrictScoped } from './PolicyScope';
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
    'Garbage \u221215%  \u00B7  Commercial revenue \u22122%',
    'Garbage \u221235%  \u00B7  Commercial revenue \u22128%',
    'Garbage \u221255%  \u00B7  Commercial revenue \u221218%',
  ],
  [PolicyType.TOURISM]: ['Revenue +20%  \u00B7  Crime rises'],
  [PolicyType.ORGANIC_FOOD]: ['Land value +6  \u00B7  Commercial revenue \u22125%'],
  [PolicyType.ENERGY_REGULATION]: [
    'Power demand \u22128%  \u00B7  Commercial revenue \u22121%, industrial \u22122%',
    'Power demand \u221218%  \u00B7  Commercial revenue \u22123%, industrial \u22126%',
    'Power demand \u221230%  \u00B7  Commercial revenue \u22126%, industrial \u221212%',
  ],
  [PolicyType.NO_HEAVY_INDUSTRY]: ['No industry here  \u00B7  Gives up the industrial tax base'],
  [PolicyType.HIGH_DENSITY_BAN]: ['No high density here  \u00B7  Gives up the high-density tax base'],
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

/**
 * 分區面板該提供哪些條例。
 *
 * 全城條例濾掉 —— 列出來玩家會按，按了沒反應（`setPolicyLevel` 會擋），那比看不到
 * 更糟。這份清單本來寫在 `DistrictModal` 裡，搬過來是為了測得到:寫在那邊的話，
 * filter 拿掉不會有任何測試轉紅。
 */
export function districtOfferedPolicies(): PolicyType[] {
  return [...IMPLEMENTED_POLICY_TYPES].filter(isDistrictScoped);
}
