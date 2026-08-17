import { ZoneType } from '../grid/types';
import { PolicyType } from './types';
import { POLICY_EFFECTS, clampLevel, maxLevel, type PolicyEffect } from './PolicyManager';
import { isCityScoped } from './PolicyScope';
import { policyCost } from './PolicyBilling';

/** 存檔裡的全城條例。 */
export interface SerializedCityOrdinances {
  levels: [PolicyType, number][];
}

/**
 * 全城條例的強度。
 *
 * 沒有分區，所以只有一份等級表 —— 這正是它跟 `PolicyManager` 的差別:那邊每個
 * 分區各有一份。
 */
export class CityOrdinances {
  private levels = new Map<PolicyType, number>();

  /**
   * 設定強度。0 = 關閉。
   *
   * 非全城範圍的條例會被拒絕:一個條例同時在分區與全城生效的話，效果會無聲地
   * 加倍，而費用只收一次。
   */
  setLevel(type: PolicyType, level: number): void {
    if (!isCityScoped(type)) return;
    const clamped = clampLevel(level, maxLevel(type));
    if (clamped === 0) this.levels.delete(type);
    else this.levels.set(type, clamped);
  }

  getLevel(type: PolicyType): number {
    return this.levels.get(type) ?? 0;
  }

  /** 目前生效的全城條例，依 `PolicyType` 的宣告順序。 */
  activeOrdinances(): { type: PolicyType; level: number }[] {
    return (Object.values(PolicyType) as PolicyType[])
      .filter(t => this.getLevel(t) > 0)
      .map(t => ({ type: t, level: this.getLevel(t) }));
  }

  /** 合成所有生效的全城條例對某一個量的影響。 */
  private effect(
    pick: (e: PolicyEffect) => number | undefined,
    identity: number,
    combine: (a: number, b: number) => number,
  ): number {
    let out = identity;
    for (const [type, level] of this.levels) {
      const tier = POLICY_EFFECTS[type]?.[level - 1];
      const value = tier && pick(tier);
      if (value !== undefined) out = combine(out, value);
    }
    return out;
  }

  /** 全城電力總需求的乘數。 */
  getPowerDemandMultiplier(): number {
    return this.effect(e => e.powerDemand, 1, (a, b) => a * b);
  }

  /** 全城條例加到犯罪率上的量。正值是代價。 */
  getCrimeBonus(): number {
    return this.effect(e => e.crime, 0, (a, b) => a + b);
  }

  /** 全城條例加到地價上的量。 */
  getLandValueBonus(): number {
    return this.effect(e => e.landValue, 0, (a, b) => a + b);
  }

  /** 全城條例對每一格垃圾產生量的乘數。 */
  getGarbageMultiplier(): number {
    return this.effect(e => e.garbage, 1, (a, b) => a * b);
  }

  /** 全城條例對這個分區類型的收入乘數。 */
  getRevenueMultiplier(zoneType: ZoneType): number {
    return this.effect((e) => {
      const flat = e.revenue;
      const byZone = e.revenueByZone?.[zoneType];
      if (flat === undefined && byZone === undefined) return undefined;
      return (flat ?? 1) * (byZone ?? 1);
    }, 1, (a, b) => a * b);
  }

  /** 全城條例本期的總支出。全城的沒有分區格數可言，所以 `districtCells` 是 0。 */
  totalCost(population: number): number {
    let total = 0;
    for (const [type, level] of this.levels) {
      total += policyCost(type, level, { population, districtCells: 0 });
    }
    return total;
  }

  toJSON(): SerializedCityOrdinances {
    return { levels: [...this.levels.entries()] };
  }

  /**
   * 從存檔還原。
   *
   * 走 `setLevel` 而不是直接塞 Map —— 存檔是使用者能編輯的檔案，範圍檢查與夾值
   * 必須在讀進來時也成立。
   */
  restore(data: Partial<SerializedCityOrdinances> | undefined): void {
    this.levels = new Map();
    for (const [type, level] of data?.levels ?? []) this.setLevel(type, level);
  }
}
