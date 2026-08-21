import { PolicyType } from '../core/district/types';
import { POLICY_CONFIG, maxLevel } from '../core/district/PolicyManager';
import { POLICY_SCOPE, type PolicyScopeKind } from '../core/district/PolicyScope';
import { CitySpecType, CitySpecialization } from '../core/district/CitySpecialization';

/**
 * 條例與城市特化。
 *
 * ## 為什麼每一次設定都要讀回來確認
 *
 * 核心的兩支寫入 —— `CityOrdinances.setLevel()` 與 `PolicyManager.setPolicyLevel()`
 * —— 遇到不合法的輸入**一律靜靜地 return**:範圍不對、分區不存在，什麼都不做，
 * 也不丟例外、不回值。那對 UI 是對的（按鈕本來就不會產生不合法的輸入），對程式
 * 呼叫就不是:回一個 `ok: true` 而條例根本沒開，之後只能從帳單上少的那一筆錢反推。
 *
 * 所以這裡把核心靜靜擋掉的每一種情形都先問一次，設完再讀回來對一次。
 *
 * ## 範圍不是選項
 *
 * 每個條例只屬於分區或全城其中一邊（`POLICY_SCOPE`）。**兩邊都不能將就** ——
 * 同一條同時在分區與全城生效的話效果會加倍，而費用只收一次。所以全城條例帶了
 * 分區 ID 是錯誤，分區條例沒帶也是錯誤，兩種都擋。
 */

export interface PolicyHost {
  districtIds(): readonly string[];
  cityLevel(type: PolicyType): number;
  setCityLevel(type: PolicyType, level: number): void;
  districtLevel(districtId: string, type: PolicyType): number;
  setDistrictLevel(districtId: string, type: PolicyType, level: number): void;
  specialization(): CitySpecType;
  chooseSpecialization(type: CitySpecType): boolean;
  population(): number;
}

export interface PolicyInfo {
  type: PolicyType;
  name: string;
  scope: PolicyScopeKind;
  maxLevel: number;
  /** 現在的強度。分區條例在沒有指定分區時是 `null` —— 「還不知道」不是「關著」。 */
  level: number | null;
}

export interface PolicyResult {
  ok: boolean;
  type: string;
  scope?: PolicyScopeKind;
  districtId?: string;
  level?: number;
  reason?: string;
}

export interface SpecOption {
  type: CitySpecType;
  requiredPopulation: number;
  revenueMultiplier: number;
  happinessModifier: number;
  crimeModifier: number;
  /** 人口夠了嗎。 */
  available: boolean;
}

export interface SpecInfo {
  current: CitySpecType;
  population: number;
  options: SpecOption[];
}

export interface SpecResult {
  ok: boolean;
  current: CitySpecType;
  reason?: string;
}

function isPolicyType(t: string): t is PolicyType {
  return Object.prototype.hasOwnProperty.call(POLICY_SCOPE, t);
}

function isSpecType(t: string): t is CitySpecType {
  return (Object.values(CitySpecType) as string[]).includes(t);
}

export class AgentPolicy {
  constructor(private readonly host: PolicyHost) {}

  // ── 條例 ────────────────────────────────────────────────────────

  /**
   * 全部的條例:範圍、上限、現在開到第幾級。
   *
   * 帶 `districtId` 才看得到分區條例的強度 —— 不帶的話那一欄是 `null`。
   */
  list(districtId?: string): PolicyInfo[] {
    return (Object.values(PolicyType) as PolicyType[]).map(type => {
      const scope = POLICY_SCOPE[type];
      const level = scope === 'city'
        ? this.host.cityLevel(type)
        : districtId ? this.host.districtLevel(districtId, type) : null;
      return { type, name: POLICY_CONFIG[type].name, scope, maxLevel: maxLevel(type), level };
    });
  }

  /**
   * 設定條例強度。`0` 是關閉。
   *
   * 全城條例不要帶 `districtId`，分區條例一定要帶。
   */
  setLevel(type: PolicyType | string, level: number, districtId?: string): PolicyResult {
    if (!isPolicyType(String(type))) {
      return { ok: false, type: String(type), reason: `unknown policy type: ${type}` };
    }
    const t = type as PolicyType;
    const scope = POLICY_SCOPE[t];
    const fail = (reason: string): PolicyResult => ({ ok: false, type: t, scope, reason });

    if (!Number.isInteger(level) || level < 0) {
      return fail(`level must be a whole number from 0: ${level}`);
    }
    const max = maxLevel(t);
    if (level > max) {
      // 核心會靜靜地夾。夾掉的話呼叫端會以為開到了它要的強度。
      return fail(`${t} only goes up to level ${max}, got ${level}`);
    }

    if (scope === 'city') {
      if (districtId !== undefined) {
        return fail(`${t} is a city-wide ordinance; it cannot be set on district ${districtId}`);
      }
      this.host.setCityLevel(t, level);
      const now = this.host.cityLevel(t);
      return now === level
        ? { ok: true, type: t, scope, level: now }
        : fail(`the game refused to set ${t} to ${level} (still ${now})`);
    }

    if (districtId === undefined) {
      return fail(`${t} applies to one district; name a district id`);
    }
    if (!this.host.districtIds().includes(districtId)) {
      return fail(`no district with id ${districtId}`);
    }
    this.host.setDistrictLevel(districtId, t, level);
    const now = this.host.districtLevel(districtId, t);
    return now === level
      ? { ok: true, type: t, scope, districtId, level: now }
      : { ...fail(`the game refused to set ${t} to ${level} (still ${now})`), districtId };
  }

  // ── 城市特化 ─────────────────────────────────────────────────────

  /** 每一種特化的門檻與效果，以及現在選的是哪一個。 */
  specializations(): SpecInfo {
    const population = this.host.population();
    return {
      current: this.host.specialization(),
      population,
      options: (Object.values(CitySpecType) as CitySpecType[]).map(type => {
        const b = CitySpecialization.getBonusForType(type);
        return {
          type,
          requiredPopulation: b.requiredPopulation,
          revenueMultiplier: b.revenueMultiplier,
          happinessModifier: b.happinessModifier,
          crimeModifier: b.crimeModifier,
          available: population >= b.requiredPopulation,
        };
      }),
    };
  }

  /** 選一種特化。`NONE` 是取消。 */
  chooseSpecialization(type: CitySpecType | string): SpecResult {
    const current = this.host.specialization();
    if (!isSpecType(String(type))) {
      return { ok: false, current, reason: `unknown specialization: ${type}` };
    }
    const t = type as CitySpecType;
    if (this.host.chooseSpecialization(t)) {
      return { ok: true, current: this.host.specialization() };
    }

    // 人口門檻由 `CitySpecialization.canChoose()` 判。這裡不抄第二份 ——
    // 兩份規則走散的那天，API 會說不行而遊戲說可以。被拒絕之後才回頭解釋原因。
    const need = CitySpecialization.getBonusForType(t).requiredPopulation;
    const pop = this.host.population();
    const reason = pop < need
      ? `${t} needs ${need} people, the city has ${pop}`
      : `the game refused ${t}`;
    return { ok: false, current: this.host.specialization(), reason };
  }
}
