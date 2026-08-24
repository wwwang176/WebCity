import { PolicyType } from '../core/district/types';
import { POLICY_CONFIG, maxLevel } from '../core/district/PolicyManager';
import { POLICY_SCOPE, type PolicyScopeKind } from '../core/district/PolicyScope';
import { CitySpecType, CitySpecialization } from '../core/district/CitySpecialization';

/**
 * Policies and city specialization.
 *
 * ## Why every write is read back
 *
 * The two core writers — `CityOrdinances.setLevel()` and `PolicyManager.setPolicyLevel()` —
 * **return silently** on invalid input: an out-of-range level or an unknown district does
 * nothing, throws nothing and returns nothing. That is right for the UI, whose buttons cannot
 * produce invalid input, but not for programmatic calls: an `ok: true` for a policy that was
 * never enabled can only be worked out later from a missing line on the bill.
 *
 * So every case the core would silently reject is checked first, and the value is read back
 * after writing.
 *
 * ## Scope is not optional
 *
 * Each policy belongs either to a district or to the city (`POLICY_SCOPE`), never both:
 * applying one at both levels doubles its effect while charging its fee once. A city ordinance
 * given a district id is an error, and so is a district policy without one.
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
  /** The current level. `null` for a district policy with no district named: "not known" rather
   *  than "off". */
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
  /** Whether the population threshold is met. */
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

  // ── Policies ────────────────────────────────────────────────────

  /**
   * Every policy: its scope, its maximum, and its current level.
   *
   * District policies show a level only when `districtId` is given; otherwise that field is
   * `null`.
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
   * Sets a policy level. `0` turns it off.
   *
   * City ordinances take no `districtId`; district policies require one.
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
      // The core clamps silently, which would let the caller believe it reached the level it
      // asked for.
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

  // ── City specialization ─────────────────────────────────────────

  /** Each specialization's threshold and effects, and which one is currently chosen. */
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

  /** Chooses a specialization. `NONE` clears it. */
  chooseSpecialization(type: CitySpecType | string): SpecResult {
    const current = this.host.specialization();
    if (!isSpecType(String(type))) {
      return { ok: false, current, reason: `unknown specialization: ${type}` };
    }
    const t = type as CitySpecType;
    if (this.host.chooseSpecialization(t)) {
      return { ok: true, current: this.host.specialization() };
    }

    // The population threshold is decided by `CitySpecialization.canChoose()`, not duplicated
    // here: two copies of the rule would eventually disagree, with the API refusing what the
    // game allows. The reason is worked out only after a refusal.
    const need = CitySpecialization.getBonusForType(t).requiredPopulation;
    const pop = this.host.population();
    const reason = pop < need
      ? `${t} needs ${need} people, the city has ${pop}`
      : `the game refused ${t}`;
    return { ok: false, current: this.host.specialization(), reason };
  }
}
