import { Policy, PolicyType, type District } from './types';
import { ZoneType } from '../grid/types';
import { isDistrictScoped } from './PolicyScope';
import { conflictsWith } from './PolicyExclusion';

/** Minimal interface for district lookup (DIP). */
export interface DistrictLookup {
  getDistrict(id: string): District | undefined;
}

/** Consolidated per-policy-type configuration (OCP-friendly). */
export interface PolicyTypeConfig {
  name: string;
}

/** Single source of truth for all policy type parameters. */
export const POLICY_CONFIG: Record<PolicyType, PolicyTypeConfig> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: { name: 'No Heavy Industry' },
  [PolicyType.ENCOURAGE_RECYCLING]: { name: 'Encourage Recycling' },
  [PolicyType.HIGH_DENSITY_BAN]: { name: 'High Density Ban' },
  [PolicyType.ORGANIC_FOOD]: { name: 'Organic Food' },
  [PolicyType.TOURISM]: { name: 'Tourism Promotion' },
  [PolicyType.ENERGY_REGULATION]: { name: 'Energy Regulation' },
  [PolicyType.LEGALIZE_GAMBLING]: { name: 'Legalize Gambling' },
  [PolicyType.NIGHT_ECONOMY]: { name: 'Night Economy' },
  [PolicyType.CURFEW]: { name: 'Curfew' },
  [PolicyType.HERITAGE_PRESERVATION]: { name: 'Heritage Preservation' },
  [PolicyType.INDUSTRY_SUBSIDY]: { name: 'Industry Subsidy' },
  [PolicyType.SURVEILLANCE_NETWORK]: { name: 'Surveillance Network' },
  [PolicyType.PAY_AS_YOU_THROW]: { name: 'Pay As You Throw' },
  [PolicyType.WATER_CONSERVATION]: { name: 'Water Conservation' },
  [PolicyType.SEWAGE_STANDARDS]: { name: 'Sewage Standards' },
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: { name: 'Industrial Emission Control' },
};

/**
 * Data-driven zone restrictions per policy type (OCP).
 * Adding a new zone-restricting policy only requires a new entry here.
 */
export const POLICY_ZONE_RESTRICTIONS: Partial<Record<PolicyType, ReadonlySet<ZoneType>>> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: new Set([ZoneType.INDUSTRIAL]),
  [PolicyType.HIGH_DENSITY_BAN]: new Set([ZoneType.RESIDENTIAL_HIGH, ZoneType.COMMERCIAL_HIGH]),
};

/**
 * What each non-zoning policy does, in the units the consumer uses.
 *
 * Three of the five policies did nothing at all: a repo-wide search for
 * ENCOURAGE_RECYCLING, ORGANIC_FOOD and TOURISM found only this file and its
 * tests. They were billed every budget cycle regardless — $380 for nothing,
 * with the district modal advertising the prices as though they bought
 * something (BUG-091). Hiding them from the UI was the stopgap; this table is
 * the implementation.
 *
 * Each is deliberately a small effect on a number the player can already read
 * off a panel, so "did that policy do anything?" is answerable by looking.
 */
export interface PolicyEffect {
  /** Multiplier on garbage produced in the district. */
  garbage?: number;
  /** Multiplier on tax revenue from every building in the district. */
  revenue?: number;
  /** Flat addition to land value before the usual clamp. */
  landValue?: number;
  /**
   * 只作用在特定分區類型的收入乘數。
   *
   * `revenue` 是全分區一視同仁,做不出「只扣商業」—— 而多數條例的代價本來就落在
   * 特定產業上:回收增加的是商家的處理成本,跟住戶無關。
   */
  revenueByZone?: Partial<Record<ZoneType, number>>;
  /**
   * 加到該區犯罪率上的量。正值是代價，單位同 `calculateLandValue` 的 `crimeRate`。
   *
   * `PoliceService` 只提供 `getCrimeReduction` —— 整個模擬沒有任何東西能讓犯罪
   * **上升**，所以「+收入 +犯罪」這類取捨做不出來。這一欄是那個缺口。
   */
  crime?: number;
  /**
   * 全城電力總需求的乘數。
   *
   * 這是一個**城市級的池子** —— 只在半個城市要求節能，省下來的電照樣進同一張
   * 電網，所以「在哪裡」不是決策。帶這個欄位的條例必然是全城範圍。
   */
  powerDemand?: number;
  /** 全城逐格用水需求乘數。 */
  waterDemand?: number;
  /** 全城逐格汙水排放乘數。 */
  sewageLoad?: number;
  /** 工業格的地面汙染乘數。 */
  industrialPollution?: number;
}

/**
 * 每個條例每一級做什麼。索引 0 是第 1 級;二元條例只放一格。
 *
 * 回收原本是一條純好處 —— 付得起就一定開,那不是決策,是價目表。現在每一級都同時
 * 扣商業收入,而且**單位代價逐級上升**:第三級每減 1% 垃圾要付的收入代價比第一級
 * 高,所以最強的那一級不會自動是最好的選擇。
 *
 * 代價落在 `revenueByZone` 而不是 `revenue`:回收增加的是商家的處理成本,跟住戶
 * 無關。
 */
export const POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    // 減 15% 垃圾，代價 2% 商業收入 → 單位代價 0.133
    { garbage: 0.85, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98 } },
    // 減 35%，代價 8% → 0.229
    { garbage: 0.65, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92 } },
    // 減 55%，代價 18% → 0.327
    { garbage: 0.45, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.82, [ZoneType.COMMERCIAL_HIGH]: 0.82 } },
  ],
  // 觀光帶人潮，人潮帶治安問題 —— 這是它的代價，不是市府掏的錢。
  [PolicyType.TOURISM]: [{ revenue: 1.2, crime: 4 }],
  // 有機食品讓這一區更宜居，代價是商家的進貨成本。
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95, [ZoneType.COMMERCIAL_HIGH]: 0.95 } }],
  /**
   * 節能法規。作用在電網的**總需求**上，代價落在商業與工業:設備更新與製程改造
   * 的成本由業者吸收。工業扣得比商業重 —— 製程改造比換一批冷氣貴得多。
   */
  [PolicyType.ENERGY_REGULATION]: [
    { powerDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { powerDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { powerDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],

  /**
   * 賭場與宵禁是刻意設計的一對:同一塊地只能選一邊。賭場把夜生活放出來換錢，
   * 宵禁把它關掉換治安。
   */
  [PolicyType.LEGALIZE_GAMBLING]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.35, [ZoneType.COMMERCIAL_HIGH]: 1.35 }, crime: 12 },
  ],
  // 賭場的溫和版，分兩級。第二級的每 1% 收入要付的犯罪比第一級高。
  [PolicyType.NIGHT_ECONOMY]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.12, [ZoneType.COMMERCIAL_HIGH]: 1.12 }, crime: 4 },
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.25, [ZoneType.COMMERCIAL_HIGH]: 1.25 }, crime: 10 },
  ],
  [PolicyType.CURFEW]: [
    { crime: -5, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.90, [ZoneType.COMMERCIAL_HIGH]: 0.90 } },
    { crime: -10, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.78, [ZoneType.COMMERCIAL_HIGH]: 0.78 } },
  ],
  // 限高與外觀規範對誰都一樣，所以住宅也付代價 —— 只是比商業輕。
  [PolicyType.HERITAGE_PRESERVATION]: [
    {
      landValue: 12,
      revenueByZone: {
        [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92,
        [ZoneType.RESIDENTIAL_LOW]: 0.94, [ZoneType.RESIDENTIAL_HIGH]: 0.94,
      },
    },
  ],
  // 補貼換來的是工廠擴張，代價落在地價上 —— 沒有人想住在旁邊。
  [PolicyType.INDUSTRY_SUBSIDY]: [
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.12 }, landValue: -4 },
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.25 }, landValue: -9 },
  ],

  // 治安換隱私。地價的代價是刻意的 —— 少了它這條就變成「花錢買治安」的價目表。
  [PolicyType.SURVEILLANCE_NETWORK]: [
    { crime: -6, landValue: -2 },
    { crime: -13, landValue: -5 },
  ],
  // 垃圾費隨袋徵收。少了垃圾，多了居民的不滿。
  [PolicyType.PAY_AS_YOU_THROW]: [
    { garbage: 0.78, landValue: -3 },
    { garbage: 0.58, landValue: -7 },
  ],
  // 省下來的水是實打實的:逐格需求變小，同一座水廠的預算就送得到更遠的地方。
  // 代價落在業者身上 —— 工業的製程用水改造比商業換一批省水龍頭貴得多。
  [PolicyType.WATER_CONSERVATION]: [
    { waterDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { waterDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { waterDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],
  // 排放標準壓在製程上，所以代價只落在工業 —— 家戶端換的是水龍頭，工廠端換的
  // 是整條處理線。
  [PolicyType.SEWAGE_STANDARDS]: [
    { sewageLoad: 0.85, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.96 } },
    { sewageLoad: 0.70, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.90 } },
  ],
  // 只降地面汙染。工廠的噪音來自機具，不是排放 —— 把噪音也一起降的話，這條就
  // 變成一顆萬用的「工業變乾淨」按鈕，而不是一個取捨。
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    { industrialPollution: 0.80, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.95 } },
    { industrialPollution: 0.60, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.88 } },
    { industrialPollution: 0.40, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.78 } },
  ],
};

/**
 * Policies implemented by something other than a zone restriction — derived
 * from the effect table, so adding an effect is all it takes to make a policy
 * real, and a policy with no effect can never be offered.
 */
const NON_ZONE_IMPLEMENTED_POLICY_TYPES: readonly PolicyType[] =
  Object.keys(POLICY_EFFECTS) as PolicyType[];

/**
 * Policies the simulation actually reads — DERIVED, not a hand-kept list.
 *
 * A repo-wide search for the other three enum members (ENCOURAGE_RECYCLING,
 * ORGANIC_FOOD, TOURISM) finds only this file and its tests — nothing in
 * GarbageService, Pollution, LandValue, Happiness or the income path consults
 * them. They were still billed every budget cycle, $380 for nothing, while the
 * district modal advertised their prices as though they did something (BUG-091).
 *
 * The first fix wrote the two real policies out by hand, which made this the
 * third list needing manual sync (POLICY_CONFIG and DistrictModal being the
 * others) and made the test that "checked" it a tautology — a subset assertion
 * over a set literally built from those members. Deriving it from the
 * restriction table removes the sync obligation entirely.
 */
export const IMPLEMENTED_POLICY_TYPES: ReadonlySet<PolicyType> = new Set<PolicyType>([
  ...(Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]),
  ...NON_ZONE_IMPLEMENTED_POLICY_TYPES,
]);

/** Does this policy have an effect on the simulation? */
export function isPolicyImplemented(type: PolicyType): boolean {
  return IMPLEMENTED_POLICY_TYPES.has(type);
}

/**
 * 把任意數字夾成合法的等級。
 *
 * 存檔是使用者能編輯的檔案，而 `Policy.level` 宣告成 `0 | 1 | 2 | 3` —— 沒有夾住
 * 的話，`-1` / `4` / 小數 / `NaN` 會直接破壞那個不變量，而 TypeScript 只在編譯期
 * 看得到它。`Math.max(0, NaN)` 仍是 `NaN`，所以非有限數要先擋掉。
 */
/**
 * 分級之前的 `active: true` 對應到現在的第幾級。
 *
 * 分級之前每條政策只有一組數字。一律轉成 level 1 的話，那組數字剛好不在第一格的
 * 政策就會在讀檔當下靜靜地變弱 —— 回收原本是 `garbage: 0.65`，而 0.65 是新表的
 * **第 2 級**;轉成 level 1 的玩家沒有動任何東西，垃圾量卻從減 35% 掉到減 15%，
 * 而且多了 2% 的商業收入代價。
 *
 * 沒有列在這裡的就是 1 —— 它們的舊數字本來就在第一格。
 */
const LEGACY_ACTIVE_LEVEL: Partial<Record<PolicyType, number>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: 2,
};

/** 舊存檔的 `active` 旗標對應到的等級。 */
export function levelForLegacyActive(type: PolicyType, active: boolean | undefined): number {
  if (!active) return 0;
  return LEGACY_ACTIVE_LEVEL[type] ?? 1;
}

export function clampLevel(level: number, max: number): Policy['level'] {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(max, Math.floor(level))) as Policy['level'];
}

/**
 * 這個條例最高幾級。
 *
 * 由效果表的長度推導,不手寫 —— 手寫的那份一定會跟表走散,而走散的那天不會有任何
 * 徵兆:多出來的那一級會靜靜地套用最後一格的效果。
 *
 * 沒有效果表條目的（限制型條例）是二元的,最高 1 級。
 */
export function maxLevel(type: PolicyType): number {
  return POLICY_EFFECTS[type]?.length ?? 1;
}

export class PolicyManager {
  private districtLookup: DistrictLookup;
  private nextPolicyId = 1;

  constructor(districtLookup: DistrictLookup) {
    this.districtLookup = districtLookup;
  }

  /**
   * 設定某個分區裡某條政策的強度。0 = 關閉。
   *
   * 已經存在的條目就地改等級，不新增第二筆 —— 互斥靠的就是「一個型別只有一筆
   * 紀錄，而那筆紀錄只有一個等級」。
   *
   * 等級 0 且原本沒有條目時什麼都不做:留一筆 level 0 的紀錄只是垃圾，而且會讓
   * 「這個分區有哪些政策」的計數變得不準。
   */
  setPolicyLevel(districtId: string, policyType: PolicyType, level: number): void {
    // 全城條例畫在分區上沒有意義，而且兩邊都設得進去的話效果會無聲地加倍。
    if (!isDistrictScoped(policyType)) return;
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;
    const clamped = clampLevel(level, maxLevel(policyType));

    // 開一條就把同組的其他條關掉。只在真的開啟時做 —— 關閉一條不該把同組的別條
    // 也掃掉，那會讓「關閉」變成一顆會誤傷的按鈕。
    if (clamped > 0) {
      for (const other of conflictsWith(policyType)) {
        const p = district.policies.find((x) => x.type === other);
        if (p) p.level = 0;
      }
    }

    const existing = district.policies.find((p) => p.type === policyType);
    if (existing) {
      existing.level = clamped;
      return;
    }
    if (clamped === 0) return;

    const cfg = POLICY_CONFIG[policyType];
    const policy: Policy = {
      id: `policy_${this.nextPolicyId++}`,
      name: cfg.name,
      type: policyType,
      level: clamped,
    };
    district.policies.push(policy);
  }

  /** 這個分區這條政策開到第幾級。沒有分區、沒有那條政策都是 0。 */
  getPolicyLevel(districtId: string | null, policyType: PolicyType): number {
    if (!districtId) return 0;
    return this.districtLookup.getDistrict(districtId)
      ?.policies.find((p) => p.type === policyType)?.level ?? 0;
  }

  removePolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;

    district.policies = district.policies.filter((p) => p.type !== policyType);
  }

  isPolicyActive(districtId: string, policyType: PolicyType): boolean {
    return this.getPolicyLevel(districtId, policyType) > 0;
  }

  /**
   * Combined effect of a district's active policies on one quantity.
   *
   * `districtId` is nullable because most callers ask about a CELL, and most
   * cells are in no district at all — those get the identity value rather than
   * a special case at every call site.
   */
  private effect(
    districtId: string | null,
    pick: (e: PolicyEffect) => number | undefined,
    identity: number,
    combine: (a: number, b: number) => number,
  ): number {
    if (!districtId) return identity;
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return identity;

    let out = identity;
    for (const policy of district.policies) {
      if (policy.level === 0) continue;
      const tier = POLICY_EFFECTS[policy.type]?.[policy.level - 1];
      const value = tier && pick(tier);
      if (value !== undefined) out = combine(out, value);
    }
    return out;
  }

  /** Multiplier on garbage produced by buildings in this district. */
  getGarbageMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.garbage, 1, (a, b) => a * b);
  }

  /**
   * Multiplier on tax revenue from buildings of this zone type in this district.
   *
   * `revenue`（全分區一視同仁）與 `revenueByZone`（只打特定產業）在同一趟裡合成。
   * 分成兩次 `effect()` 呼叫會查兩次分區、掃兩次政策，而這是逐棟建築、每次收入
   * 計算都會走的路。
   */
  getRevenueMultiplier(districtId: string | null, zoneType: ZoneType): number {
    return this.effect(districtId, (e) => {
      const flat = e.revenue;
      const byZone = e.revenueByZone?.[zoneType];
      if (flat === undefined && byZone === undefined) return undefined;
      return (flat ?? 1) * (byZone ?? 1);
    }, 1, (a, b) => a * b);
  }

  /** Flat land-value bonus for cells in this district. */
  getLandValueBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.landValue, 0, (a, b) => a + b);
  }

  /** 該區因條例而增加的犯罪率。沒有分區就是 0。 */
  getIndustrialPollutionMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.industrialPollution, 1, (a, b) => a * b);
  }

  getCrimeBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.crime, 0, (a, b) => a + b);
  }

  /**
   * Policy objects themselves live on their District, so only the id counter
   * needs persisting here — without it, policies created after a load would
   * reuse ids already present on restored districts (BUG-053).
   */
  toJSON(): { nextPolicyId: number } {
    return { nextPolicyId: this.nextPolicyId };
  }

  restore(data: { nextPolicyId?: number } | undefined): void {
    if (data?.nextPolicyId != null) this.nextPolicyId = data.nextPolicyId;
  }

  canBuildInDistrict(districtId: string, buildingZoneType: ZoneType): boolean {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return true;

    // Data-driven zone restrictions (OCP: adding new policies only needs POLICY_ZONE_RESTRICTIONS entry)
    for (const [policyType, blockedZones] of Object.entries(POLICY_ZONE_RESTRICTIONS)) {
      if (blockedZones!.has(buildingZoneType) && this.isPolicyActive(districtId, policyType as PolicyType)) {
        return false;
      }
    }

    return true;
  }
}
