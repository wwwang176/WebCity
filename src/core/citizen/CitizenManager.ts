import { type Citizen, LifeStage, EducationLevel, getLifeStage, calculateEmigrationTolerance, EMIGRATION_TOLERANCE, LIFE_STAGE_AGE, AGE_PER_TICK, MAX_AGE } from './types';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/** Daily death rate per life stage (bathtub curve) — calibrated for compressed life-week aging. */
export const DAILY_DEATH_RATE: Record<LifeStage, number> = {
  [LifeStage.BABY]:   0.0016,    // 0-8 wk: ~91% survive without health
  [LifeStage.CHILD]:  0.00015,   // 9-32 wk: ~98% survive
  [LifeStage.TEEN]:   0.00015,   // 33-52 wk: ~98% survive
  [LifeStage.ADULT]:  0.0005,    // 53-200 wk: ~60% survive without health
  [LifeStage.SENIOR]: 0.006,     // 201-260 wk: ~8% survive without health
};

/** Health coverage multiplier on death rate */
export const HEALTH_MULTIPLIER = {
  COVERED: 0.3,      // 70% reduction with health coverage
  NOT_COVERED: 1.0,  // baseline
} as const;

/** Per-citizen death context returned by SimulationLoop callback. */
export interface DeathContext {
  /** Hospital death-rate multiplier (0.3 = full coverage, 1.0 = no benefit) */
  hospitalMult: number;
  /** Pollution death-rate multiplier (1.0 = no extra risk, up to 1.5 = high pollution uncovered) */
  pollutionMult: number;
  /**
   * 條例對死亡機率的乘數（禁菸令、免費診所）。1 = 沒有條例。
   *
   * 跟 hospitalMult 分開帶著:那一欄是醫院負荷算出來的，兩者乘在一起的話，帳面上
   * 會看不出死亡率是被醫院蓋住的還是被條例壓下去的。
   */
  policyMult: number;
}

/** Elderly age threshold and rate factor */
export const ELDERLY = {
  AGE_THRESHOLD: 240,
  RATE_FACTOR: 0.25,
} as const;

/** Elderly multiplier: ramps up death rate above AGE_THRESHOLD life-weeks */
export function getElderlyMultiplier(age: number): number {
  if (age <= ELDERLY.AGE_THRESHOLD) return 1;
  if (age > MAX_AGE) return Infinity;
  return 1 + (age - ELDERLY.AGE_THRESHOLD) * ELDERLY.RATE_FACTOR;
}

/** Data-driven education progression rules — no age/lifeStage restriction, anyone can learn. */
export interface EducationRule {
  requiredEducation: EducationLevel;
  nextEducation: EducationLevel;
  schoolKey: 'elementary' | 'highSchool' | 'university';
}

/** Minimum age to enroll in school (babies excluded). */
export const MIN_SCHOOL_AGE = LIFE_STAGE_AGE.BABY_MAX + 1; // 9 life-weeks

/** Progress scale factor — all progress/thresholds use ×100 for integer math. */
export const EDUCATION_SCALE = 100;

/** Graduation thresholds (×100 scale) — scaled for compressed life-week aging.
 *  Child: 150 ticks, Teen: 120 ticks, Adult(uni): ~303 ticks. */
export const GRADUATION_TICKS: Record<EducationRule['schoolKey'], number> = {
  elementary: 150 * EDUCATION_SCALE,  // 15,000 → child 150, adult ~455, senior 750 ticks
  highSchool: 120 * EDUCATION_SCALE,  // 12,000 → child 120, adult ~364, senior 600 ticks
  university: 100 * EDUCATION_SCALE,  // 10,000 → child 100, adult ~303, senior 500 ticks
};

/** Learning speed points per tick by life stage */
export const LEARNING_SPEED = {
  YOUNG: 100,   // children & teens: full speed
  ADULT: 33,    // adults: ~3x slower
  SENIOR: 20,   // seniors: 5x slower
} as const;

/** Base speed points per tick. Younger = faster, older = slower. */
export function getLearningSpeed(age: number): number {
  if (age <= LIFE_STAGE_AGE.TEEN_MAX) return LEARNING_SPEED.YOUNG;
  if (age <= LIFE_STAGE_AGE.ADULT_MAX) return LEARNING_SPEED.ADULT;
  return LEARNING_SPEED.SENIOR;
}

/**
 * 義務教育階段的學習速度加成。
 *
 * 全日、強制出席跟有一天沒一天地來上課的差別 —— 同一間學校、同一個老師，把學生
 * 推得比較快。
 */
export const COMPULSORY_SPEED_BONUS = 1.5;

/** Jitter range for per-tick learning speed (80%~120%) to stagger graduations. */
export const LEARNING_JITTER = { MIN: 0.8, MAX: 1.2 } as const;

/** Apply jitter to base speed: returns integer speed with 80%~120% random variation. */
export function jitteredSpeed(baseSpeed: number): number {
  const jitter = LEARNING_JITTER.MIN + Math.random() * (LEARNING_JITTER.MAX - LEARNING_JITTER.MIN);
  return Math.round(baseSpeed * jitter);
}

export const EDUCATION_PROGRESSION: readonly EducationRule[] = [
  { requiredEducation: EducationLevel.NONE, nextEducation: EducationLevel.ELEMENTARY, schoolKey: 'elementary' },
  { requiredEducation: EducationLevel.ELEMENTARY, nextEducation: EducationLevel.HIGH_SCHOOL, schoolKey: 'highSchool' },
  { requiredEducation: EducationLevel.HIGH_SCHOOL, nextEducation: EducationLevel.UNIVERSITY, schoolKey: 'university' },
];

export class CitizenManager {
  private citizens: Citizen[] = [];
  private nextId = 1;
  /** Residential capacity — updated by SimulationLoop each slowTick.
   *  Defaults to Infinity so tests / save-loading work without explicit setup. */
  private residentialCapacity = Infinity;

  /** Hook called after citizens are evicted from a building. Subscribers handle cleanup (e.g. commute cache). */
  onEvicted?: (citizenIds: number[]) => void;

  /** Update the housing capacity gate. Call each slowTick from SimulationLoop. */
  updateResidentialCapacity(cap: number): void {
    this.residentialCapacity = cap;
  }

  /** Create a citizen if housing capacity allows. Returns null when at capacity. */
  createCitizen(overrides: Partial<Citizen> = {}, currentTick = 0): Citizen | null {
    if (this.citizens.length >= this.residentialCapacity) return null;
    return this._addCitizen(overrides, currentTick);
  }

  /**
   * Add a citizen whose home has ALREADY been shown to have room.
   *
   * The gate in createCitizen compares the whole citizen list against total
   * residential capacity, and that list includes citizens with homeId === null
   * — the homeless, and everyone waiting for assignCitizenHousing. So a city
   * carrying any homeless population reported itself full while individual
   * houses still had free rooms, and birthTick — which runs once a MONTH,
   * against migration's once every 6 ticks — was the one that lost the race.
   * Natural birth degenerated into a residual mechanism.
   *
   * Only for callers that have verified per-building occupancy against the
   * building's own capacity, which is the stronger check: if such a room
   * exists, the city is not actually full.
   */
  createCitizenInKnownVacancy(overrides: Partial<Citizen> = {}, currentTick = 0): Citizen {
    return this._addCitizen(overrides, currentTick);
  }

  /** Unconditionally restore a citizen (save-loading). Bypasses capacity check. */
  restoreCitizen(overrides: Partial<Citizen> = {}, currentTick = 0): Citizen {
    return this._addCitizen(overrides, currentTick);
  }

  private _addCitizen(overrides: Partial<Citizen>, currentTick: number): Citizen {
    const age = overrides.age ?? 100; // default mid-ADULT (life-weeks)
    const education = overrides.education ?? EducationLevel.NONE;
    const citizen: Citizen = {
      id: this.nextId++,
      birthTick: overrides.birthTick ?? Math.round(currentTick - age / AGE_PER_TICK),
      age,
      lifeStage: getLifeStage(age),
      education,
      happiness: 50,
      health: 80,
      homeId: null,
      workplaceId: null,
      unemployedSince: null,
      homelessSince: null,
      emigrationTolerance: calculateEmigrationTolerance(education),
      educationProgress: 0,
      ...overrides,
    };
    // Legacy saves may not have emigrationTolerance — assign fallback
    if (citizen.emigrationTolerance === undefined || citizen.emigrationTolerance === null) {
      citizen.emigrationTolerance = EMIGRATION_TOLERANCE.FALLBACK;
    }
    if (citizen.id >= this.nextId) this.nextId = citizen.id + 1;
    this.citizens.push(citizen);
    return citizen;
  }

  removeCitizen(id: number): void {
    const idx = this.citizens.findIndex((c) => c.id === id);
    if (idx >= 0) {
      // 立墓碑。拿著物件參照的切片器要看得出這個人已經不在了。
      this.citizens[idx]!.removed = true;
      this.citizens.splice(idx, 1);
    }
  }

  /** Batch-remove citizens by id set. Single-pass compaction — no intermediate arrays. */
  removeCitizens(ids: Set<number>): void {
    if (ids.size === 0) return;
    let write = 0;
    for (let read = 0; read < this.citizens.length; read++) {
      const c = this.citizens[read]!;
      if (ids.has(c.id)) {
        c.removed = true;   // 立墓碑，理由見 removeCitizen
      } else {
        this.citizens[write++] = c;
      }
    }
    this.citizens.length = write;
  }

  getCitizen(id: number): Citizen | undefined {
    return this.citizens.find((c) => c.id === id);
  }

  getPopulation(): number {
    return this.citizens.length;
  }

  /**
   * Citizens currently holding a job.
   *
   * The city's job VACANCIES are totalJobs minus this — not totalJobs minus
   * the population. Using the population treated every baby, schoolchild and
   * retiree as if it filled a post, so a city with a normal age pyramid
   * reported no openings while a large share of its offices stood empty.
   */
  getEmployedCount(): number {
    let n = 0;
    for (const c of this.citizens) if (c.workplaceId !== null) n++;
    return n;
  }

  getCitizens(): readonly Citizen[] {
    return this.citizens;
  }

  /** Count currently enrolled students per school type. */
  getEnrolledCounts(): Record<EducationRule['schoolKey'], number> {
    const counts: Record<EducationRule['schoolKey'], number> = { elementary: 0, highSchool: 0, university: 0 };
    for (const c of this.citizens) {
      if (c.educationProgress <= 0) continue;
      for (const r of EDUCATION_PROGRESSION) {
        if (c.education === r.requiredEducation) {
          counts[r.schoolKey]++;
          break;
        }
      }
    }
    return counts;
  }

  getAverageHappiness(): number {
    if (this.citizens.length === 0) return 0;
    let sum = 0;
    for (const c of this.citizens) sum += c.happiness;
    return sum / this.citizens.length;
  }

  getCitizensByHome(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.homeId === buildingKey);
  }

  getCitizensByWorkplace(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.workplaceId === buildingKey);
  }

  /** Evict all citizens from a demolished building at the given position key.
   *  Nullifies homeId / workplaceId so citizens become homeless / unemployed.
   *  @param currentTick Current simulation tick — records homelessSince for duration tracking. */
  evictBuilding(posKey: string, currentTick?: number): number[] {
    const evictedIds: number[] = [];
    for (const c of this.citizens) {
      let affected = false;
      if (c.homeId === posKey) {
        c.homeId = null;
        c.homelessSince = currentTick ?? null;
        affected = true;
      }
      if (c.workplaceId === posKey) {
        c.workplaceId = null;
        // Record the unemployment start, symmetrically with homelessSince above.
        // Happiness escalates the unemployment penalty by duration (-15, then
        // -25 after 30 ticks, then -100) and reads this field; leaving it null
        // pinned demolition-driven unemployment at the mildest tier forever, and
        // hid these citizens from the unemployment figure in DemographicsPage.
        // The three other unemployment paths all record it (BUG-075).
        c.unemployedSince = currentTick ?? null;
        affected = true;
      }
      if (affected) evictedIds.push(c.id);
    }
    if (evictedIds.length > 0) this.onEvicted?.(evictedIds);
    return evictedIds;
  }

  /** Called once per game day: recompute all citizen ages from birthTick.
   *  Using birthTick avoids float accumulation errors. */
  updateAges(currentTick: number): void {
    const retired: number[] = [];
    for (const c of this.citizens) {
      c.age = (currentTick - c.birthTick) * AGE_PER_TICK;
      c.lifeStage = getLifeStage(c.age);
      // Retire citizens who have aged out of working age. Job assignment filters
      // to working-age citizens, but nothing ever released a post by age, and
      // workOccupancy counts every citizen holding a workplaceId — so retirees
      // permanently occupied jobs that could never be reassigned, while staying
      // invisible in unemploymentRate (which only counts working-age citizens).
      // unemployedSince stays null: retirement is not unemployment, and stamping
      // it would apply the happiness penalty ladder to every senior (BUG-076).
      //
      // Deliberately `age > ADULT_MAX` rather than `!isWorkingAge(age)`: the
      // latter also covers children and teens, who never hold a job in a running
      // game (assignment filters by working age) but do in tests that use a low
      // age as shorthand. Retirement is the upper boundary only.
      if (c.workplaceId !== null && c.age > LIFE_STAGE_AGE.ADULT_MAX) {
        c.workplaceId = null;
        retired.push(c.id);
      }
    }
    // Every other path that clears workplaceId also drops the commute cache
    // entry — eviction via onEvicted, death, emigration, moving house, changing
    // job, unreachable workplace. Retirement did not, so the retiree's route
    // kept its routeRefCount and went on feeding the congestion predictor,
    // which writes trafficDensity and therefore noise pollution, happiness and
    // land value. The seat it vacated was refilled and counted a second time,
    // and the ghost survived until the citizen died (BUG-119).
    if (retired.length > 0) this.onEvicted?.(retired);
  }

  /** Called once per game day: bathtub-curve death check.
   *  Callback returns per-citizen death context with hospital load and pollution multipliers.
   *  finalRate = baseRate × elderlyMult × hospitalMult × pollutionMult
   *  Returns array of { id, homeId } so callers can look up death location. */
  deathTick(getDeathContext: (citizen: Citizen) => DeathContext): Array<{ id: number; homeId: string | null }> {
    const dead: Array<{ id: number; homeId: string | null }> = [];
    for (const c of this.citizens) {
      if (c.age > MAX_AGE) {
        dead.push({ id: c.id, homeId: c.homeId });
        continue;
      }
      const baseRate = DAILY_DEATH_RATE[c.lifeStage];
      const elderlyMult = getElderlyMultiplier(c.age);
      const ctx = getDeathContext(c);
      const finalRate = baseRate * elderlyMult * ctx.hospitalMult * ctx.pollutionMult
        * ctx.policyMult;
      if (Math.random() < finalRate) {
        dead.push({ id: c.id, homeId: c.homeId });
      }
    }
    if (dead.length > 0) this.removeCitizens(new Set(dead.map(d => d.id)));
    return dead;
  }

  /**
   * Two-phase education tick with capacity limits and graduation time.
   * Phase 1: advance enrolled students, graduate those who reach the threshold, drop those who lost coverage.
   * Phase 2: enroll new students up to remaining capacity.
   */
  educateTick(
    isSchoolCovered: (x: number, y: number, schoolKey: EducationRule['schoolKey']) => boolean,
    capacityBySchoolKey: Record<EducationRule['schoolKey'], number>,
    /**
     * 國民教育辦到學制的第幾階（義務教育條例）。0 = 沒有。
     *
     * 站在第 `rung` 階（0 起算）的學生，只有 `rung < compulsoryStages` 時才享有
     * 加成 —— 那一階在義務範圍之內。範圍之外的自己唸自己的。
     */
    compulsoryStages = 0,
  ): void {
    const enrolledCount: Record<EducationRule['schoolKey'], number> = { elementary: 0, highSchool: 0, university: 0 };

    // Phase 1 — advance enrolled students, pause if homeless/uncovered (never reset progress)
    for (const c of this.citizens) {
      if (c.educationProgress <= 0) continue;
      const rung = EDUCATION_PROGRESSION.findIndex(r => c.education === r.requiredEducation);
      const matched = rung >= 0 ? EDUCATION_PROGRESSION[rung] : undefined;
      if (!matched) continue;
      // Graduate immediately if already past threshold (handles save migration threshold changes)
      if (c.educationProgress >= GRADUATION_TICKS[matched.schoolKey]) {
        c.education = matched.nextEducation;
        c.educationProgress = 0;
        continue;
      }
      if (c.age < MIN_SCHOOL_AGE || !c.homeId) continue; // paused, keep progress
      const pos = parsePosKeyUnsafe(c.homeId);
      if (!isSchoolCovered(pos.x, pos.y, matched.schoolKey)) continue; // paused, keep progress
      c.educationProgress += jitteredSpeed(
        getLearningSpeed(c.age) * (rung < compulsoryStages ? COMPULSORY_SPEED_BONUS : 1));
      if (c.educationProgress >= GRADUATION_TICKS[matched.schoolKey]) {
        c.education = matched.nextEducation;
        c.educationProgress = 0; // only graduation resets progress
      } else {
        enrolledCount[matched.schoolKey]++;
      }
    }

    // Phase 2 — enroll new students (remaining capacity)
    const remaining: Record<EducationRule['schoolKey'], number> = {
      elementary: capacityBySchoolKey.elementary - enrolledCount.elementary,
      highSchool: capacityBySchoolKey.highSchool - enrolledCount.highSchool,
      university: capacityBySchoolKey.university - enrolledCount.university,
    };

    for (const c of this.citizens) {
      if (!c.homeId || c.educationProgress > 0 || c.age < MIN_SCHOOL_AGE) continue;
      const rung = EDUCATION_PROGRESSION.findIndex(r => c.education === r.requiredEducation);
      const rule = rung >= 0 ? EDUCATION_PROGRESSION[rung] : undefined;
      if (rule && remaining[rule.schoolKey] > 0) {
        const pos = parsePosKeyUnsafe(c.homeId);
        if (isSchoolCovered(pos.x, pos.y, rule.schoolKey)) {
          c.educationProgress = jitteredSpeed(
            getLearningSpeed(c.age) * (rung < compulsoryStages ? COMPULSORY_SPEED_BONUS : 1));
          remaining[rule.schoolKey]--;
        }
      }
    }
  }
}
