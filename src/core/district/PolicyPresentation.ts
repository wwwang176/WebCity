import { PolicyType } from './types';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, maxLevel } from './PolicyManager';
import { isDistrictScoped, POLICY_SCOPE, type PolicyScopeKind } from './PolicyScope';
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
  [PolicyType.LEGALIZE_GAMBLING]: ['Commercial revenue +35%  \u00B7  Crime +12'],
  [PolicyType.NIGHT_ECONOMY]: [
    'Commercial revenue +12%  \u00B7  Crime +4',
    'Commercial revenue +25%  \u00B7  Crime +10',
  ],
  [PolicyType.CURFEW]: [
    'Crime \u22125  \u00B7  Commercial revenue \u221210%',
    'Crime \u221210  \u00B7  Commercial revenue \u221222%',
  ],
  [PolicyType.HERITAGE_PRESERVATION]: [
    'Land value +12  \u00B7  Commercial revenue \u22128%, housing \u22126%',
  ],
  [PolicyType.INDUSTRY_SUBSIDY]: [
    'Industrial revenue +12%  \u00B7  Land value \u22124',
    'Industrial revenue +25%  \u00B7  Land value \u22129',
  ],
  [PolicyType.SURVEILLANCE_NETWORK]: [
    'Crime \u22126  \u00B7  Land value \u22122',
    'Crime \u221213  \u00B7  Land value \u22125',
  ],
  [PolicyType.PAY_AS_YOU_THROW]: [
    'Garbage \u221222%  \u00B7  Land value \u22123',
    'Garbage \u221242%  \u00B7  Land value \u22127',
  ],
  [PolicyType.WATER_CONSERVATION]: [
    'Water demand \u22128%  \u00B7  Commercial revenue \u22121%, industrial \u22122%',
    'Water demand \u221218%  \u00B7  Commercial revenue \u22123%, industrial \u22126%',
    'Water demand \u221230%  \u00B7  Commercial revenue \u22126%, industrial \u221212%',
  ],
  [PolicyType.SEWAGE_STANDARDS]: [
    'Sewage \u221215%  \u00B7  Industrial revenue \u22124%',
    'Sewage \u221230%  \u00B7  Industrial revenue \u221210%',
  ],
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    'Industrial ground pollution \u221220%  \u00B7  Industrial revenue \u22125%',
    'Industrial ground pollution \u221240%  \u00B7  Industrial revenue \u221212%',
    'Industrial ground pollution \u221260%  \u00B7  Industrial revenue \u221222%',
  ],
  [PolicyType.CHILDCARE_SUBSIDY]: [
    'Paid for infants  \u00B7  Births +20%  \u00B7  Business revenue \u22122%',
    'Paid through childhood  \u00B7  Births +45%  \u00B7  Business revenue \u22125%',
    'Paid through the teens  \u00B7  Births +70%  \u00B7  Business revenue \u22129%',
  ],
  [PolicyType.COMPULSORY_EDUCATION]: [
    'Schooling compulsory through elementary  \u00B7  Industrial revenue \u22123%',
    'Compulsory through high school  \u00B7  Industrial revenue \u22127%',
    'Compulsory through university  \u00B7  Industrial revenue \u221214%',
  ],
  [PolicyType.FREE_CLINIC]: [
    'Deaths \u221212% where hospitals reach  \u00B7  Commercial revenue \u22122%',
    'Deaths \u221225% where hospitals reach  \u00B7  Commercial revenue \u22125%',
  ],
  [PolicyType.SMOKING_BAN]: [
    'Deaths \u22126% citywide  \u00B7  Commercial revenue \u221212%',
  ],
  [PolicyType.CONGESTION_CHARGE]: [
    'Driving here costs 30% more  \u00B7  Commercial revenue \u22125%',
    'Driving here costs 75% more  \u00B7  Commercial revenue \u221212%',
  ],
};

/** 這個條例這一級做什麼。等級 0 回空字串。 */
export function policyEffectSummary(type: PolicyType, level: number): string {
  if (level <= 0) return '';
  return EFFECT_SUMMARY[type]?.[level - 1] ?? '';
}

/**
 * 強度按鈕上的字。
 *
 * 寫完整的字而不是 L／M／H:縮寫要把游標停上去才知道是什麼，而且單級條例用兩個
 * 符號、三級用三個字母的話，同一個面板裡會有兩套語言要學。
 *
 * 單級的條例說「On」不說「Light」—— 沒有更重的可以開，寫 Light 會讓玩家一直在找
 * 那個不存在的下一格。
 */
const TIER_NAMES = ['Light', 'Medium', 'Heavy'] as const;

/**
 * 這一級叫什麼。強度按鈕與帳本的逐條支出共用 —— 兩邊各寫各的話，同一條政策在面板上
 * 是「Medium」、在帳本上是「●●○」，玩家得自己猜那兩個圓點對應到哪一格。
 */
export function policyLevelLabel(type: PolicyType, level: number): string {
  if (!(level >= 1)) return 'Off';          // NaN 也走這裡
  if (maxLevel(type) <= 1) return 'On';
  // 存檔是可以編輯的。夾住而不是回 undefined —— 那會讓帳本印出「undefined」。
  const i = Math.min(Math.floor(level), TIER_NAMES.length) - 1;
  return TIER_NAMES[i]!;
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

/**
 * 條例的分類。
 *
 * 16 條擺成一排的話玩家找不到東西，而且看不出哪幾條在回答同一個問題。分類是
 * 「這條條例在管什麼」——「在哪裡蓋什麼」「錢從哪來」「晚上安不安全」「排出去
 * 的東西」。
 *
 * `Retired` 不在這張表裡:它不是一種主題，而是「這條條例已經沒有效果了」的狀態，
 * 只有舊存檔帶得出來。
 */
export const POLICY_CATEGORY: Record<PolicyType, string> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'Land use',
  [PolicyType.HIGH_DENSITY_BAN]: 'Land use',
  [PolicyType.HERITAGE_PRESERVATION]: 'Land use',

  [PolicyType.TOURISM]: 'Economy',
  [PolicyType.ORGANIC_FOOD]: 'Economy',
  [PolicyType.LEGALIZE_GAMBLING]: 'Economy',
  [PolicyType.NIGHT_ECONOMY]: 'Economy',
  [PolicyType.INDUSTRY_SUBSIDY]: 'Economy',

  [PolicyType.CURFEW]: 'Safety',
  [PolicyType.SURVEILLANCE_NETWORK]: 'Safety',

  [PolicyType.ENCOURAGE_RECYCLING]: 'Environment',
  [PolicyType.PAY_AS_YOU_THROW]: 'Environment',
  [PolicyType.ENERGY_REGULATION]: 'Environment',
  [PolicyType.WATER_CONSERVATION]: 'Environment',
  [PolicyType.SEWAGE_STANDARDS]: 'Environment',
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: 'Environment',

  [PolicyType.CHILDCARE_SUBSIDY]: 'Welfare',
  [PolicyType.COMPULSORY_EDUCATION]: 'Welfare',
  [PolicyType.FREE_CLINIC]: 'Welfare',
  [PolicyType.SMOKING_BAN]: 'Welfare',

  [PolicyType.CONGESTION_CHARGE]: 'Transport',
};

/** 面板上分類出現的順序。 */
export const CATEGORY_ORDER =
  ['Land use', 'Economy', 'Transport', 'Safety', 'Welfare', 'Environment'] as const;

/** 已下架的條例集中在這一組。 */
export const RETIRED_CATEGORY = 'Retired';

export interface PolicyGroup {
  category: string;
  policies: PolicyType[];
}

/**
 * 某個範圍的面板該顯示的條例，依分類分組。
 *
 * `alsoCarried` 是這個分區存檔裡已經有的條例 —— 沒有它的話，舊存檔裡已下架的條例
 * 會從畫面上消失，玩家就再也關不掉它。已下架的集中放在 `Retired` 那一組，跟還在
 * 生效的分開。
 *
 * 空的分類不會出現。全城面板沒有 Land use 也沒有 Economy —— 「在哪裡蓋什麼」跟
 * 「哪一區補貼」本來就都是分區的問題。
 */
export function policiesByCategory(
  scope: PolicyScopeKind,
  alsoCarried: readonly PolicyType[] = [],
): PolicyGroup[] {
  const offered = [...IMPLEMENTED_POLICY_TYPES]
    .filter(t => POLICY_SCOPE[t] === scope);
  const offeredSet = new Set(offered);

  const byCategory = new Map<string, PolicyType[]>();
  for (const t of offered) {
    const c = POLICY_CATEGORY[t];
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(t);
  }

  const retired: PolicyType[] = [];
  for (const t of alsoCarried) {
    if (offeredSet.has(t)) continue;
    if (retired.includes(t)) continue;
    retired.push(t);
  }

  const groups: PolicyGroup[] = [];
  for (const c of CATEGORY_ORDER) {
    const policies = byCategory.get(c);
    if (policies?.length) groups.push({ category: c, policies });
  }
  if (retired.length) groups.push({ category: RETIRED_CATEGORY, policies: retired });
  return groups;
}
