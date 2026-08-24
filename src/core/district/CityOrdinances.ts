import { ZoneType } from '../grid/types';
import { PolicyType } from './types';
import { POLICY_EFFECTS, clampLevel, maxLevel, type PolicyEffect } from './PolicyManager';
import { isCityScoped } from './PolicyScope';
import { policyCost, type CityScales } from './PolicyBilling';

/** City ordinances as stored in a save. */
export interface SerializedCityOrdinances {
  levels: [PolicyType, number][];
}

/**
 * City ordinance levels.
 *
 * There are no districts, so there is a single level table. That is exactly what distinguishes
 * this from `PolicyManager`, which keeps one per district.
 */
export class CityOrdinances {
  private levels = new Map<PolicyType, number>();

  /**
   * Sets a level. 0 turns it off.
   *
   * Policies that are not city-scoped are refused: one applying at both district and city level
   * doubles its effect silently while its fee is charged once.
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

  /** The active city ordinances, in `PolicyType` declaration order. */
  activeOrdinances(): { type: PolicyType; level: number }[] {
    return (Object.values(PolicyType) as PolicyType[])
      .filter(t => this.getLevel(t) > 0)
      .map(t => ({ type: t, level: this.getLevel(t) }));
  }

  /** Combines every active city ordinance's effect on one quantity. */
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

  /** The multiplier on total city power demand. */
  getPowerDemandMultiplier(): number {
    return this.effect(e => e.powerDemand, 1, (a, b) => a * b);
  }

  /** The city ordinances' multiplier on per-cell water demand. */
  getWaterDemandMultiplier(): number {
    return this.effect(e => e.waterDemand, 1, (a, b) => a * b);
  }

  /** The city ordinances' multiplier on per-cell sewage discharge. */
  getSewageLoadMultiplier(): number {
    return this.effect(e => e.sewageLoad, 1, (a, b) => a * b);
  }

  /** What the city ordinances add to the crime rate. Positive is a cost. */
  getCrimeBonus(): number {
    return this.effect(e => e.crime, 0, (a, b) => a + b);
  }

  /** What the city ordinances add to land value. */
  getLandValueBonus(): number {
    return this.effect(e => e.landValue, 0, (a, b) => a + b);
  }

  /** The city ordinances' multiplier on per-cell refuse production. */
  getGarbageMultiplier(): number {
    return this.effect(e => e.garbage, 1, (a, b) => a * b);
  }

  /** The city ordinances' multiplier on birth probability. */
  getFertilityMultiplier(): number {
    return this.effect(e => e.fertility, 1, (a, b) => a * b);
  }

  /**
   * How far compulsory schooling reaches, as a school stage. 0 means none.
   *
   * Stacking takes the highest stage rather than summing: two ordinances each reaching primary
   * school still reach primary school.
   */
  getCompulsorySchoolingStages(): number {
    return this.effect(e => e.compulsorySchooling, 0, (a, b) => Math.max(a, b));
  }

  /** The city ordinances' multiplier on death probability, applying to everyone (the smoking
   *  ban). */
  getDeathRateMultiplier(): number {
    return this.effect(e => e.deathRate, 1, (a, b) => a * b);
  }

  /** The death probability multiplier applying only inside hospital coverage (free clinics). */
  getCoveredDeathRateMultiplier(): number {
    return this.effect(e => e.coveredDeathRate, 1, (a, b) => a * b);
  }

  /** The city ordinances' revenue multiplier for this zone type. */
  getRevenueMultiplier(zoneType: ZoneType): number {
    return this.effect((e) => {
      const flat = e.revenue;
      const byZone = e.revenueByZone?.[zoneType];
      if (flat === undefined && byZone === undefined) return undefined;
      return (flat ?? 1) * (byZone ?? 1);
    }, 1, (a, b) => a * b);
  }

  /** The city ordinances' total cost this period. City-wide ordinances have no district cell
   *  count, so `districtCells` is 0. */
  totalCost(city: CityScales): number {
    let total = 0;
    for (const [type, level] of this.levels) {
      // A city ordinance has no district, so all three district quantities are 0.
      total += policyCost(type, level,
        { ...city, districtCells: 0, districtRoadCells: 0, chargedDrivers: 0 });
    }
    return total;
  }

  toJSON(): SerializedCityOrdinances {
    return { levels: [...this.levels.entries()] };
  }

  /**
   * Restores from a save.
   *
   * Goes through `setLevel` rather than writing the Map directly: a save is a file the user can
   * edit, so range checks and clamping have to hold on the way in too.
   */
  restore(data: Partial<SerializedCityOrdinances> | undefined): void {
    this.levels = new Map();
    for (const [type, level] of data?.levels ?? []) this.setLevel(type, level);
  }
}
