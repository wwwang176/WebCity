import { CitizenManager, GRADUATION_TICKS } from './CitizenManager';
import { EducationLevel, LIFE_STAGE_AGE } from './types';
import { randomElement, randomInt, pickWeighted } from '../utils/random';

export interface CityAttractiveness {
  jobOpenings: number;
  vacantHomes: number;
  avgHappiness: number;
  taxRate: number;
  pollution: number;
  crimeRate: number;
  unemploymentRate?: number;  // 0.0–1.0, fraction of working-age citizens without a job
  /** Factors that influence immigrant education distribution */
  hasUniversity?: boolean;
  officeRatio?: number;      // 0.0–1.0, fraction of workplaces that are office
  industrialRatio?: number;  // 0.0–1.0, fraction of workplaces that are industrial
  avgLandValue?: number;     // 0–255
}

export const ATTRACTIVENESS = {
  JOB_SCORE: 20,
  VACANT_SCORE: 20,
  HAPPINESS_WEIGHT: 0.3,
  TAX_WEIGHT: 0.5,
  POLLUTION_WEIGHT: 0.2,
  CRIME_WEIGHT: 0.3,
  UNEMPLOYMENT_WEIGHT: 60,
  MIN: 0,
  MAX: 100,
} as const;

export const IMMIGRATION = {
  ATTRACTIVENESS_THRESHOLD: 50,
  POP_CAP_FACTOR: 0.01,
  POP_CAP_MIN: 3,
  DEMAND_CAP_DIVISOR: 10,
  /** Population tier base for log scaling: tier = max(1, floor(log10(pop))) */
  POPULATION_TIER_BASE: 10,
  /** Base multiplier applied to immigration cap */
  IMMIGRATION_BASE_MULTIPLIER: 1.5,
  /** Random jitter range [min, max] applied to immigration count */
  IMMIGRATION_JITTER_MIN: 0.7,
  IMMIGRATION_JITTER_MAX: 1.5,
  EMIGRATION_HAPPINESS_THRESHOLD: 20,
  EMIGRATION_MIN_RATE: 0.01,
  EMIGRATION_MAX_RATE: 0.03,
  EMIGRATION_BASE_MAX: 10,
  /** Natural attrition rate: fraction of population that randomly leaves each tick */
  NATURAL_ATTRITION_RATE: 0.002,
  /** Hard cap on natural attrition per tick, so large cities don't bleed out */
  NATURAL_ATTRITION_CAP: 5,
  IMMIGRANT_MIN_AGE: 55,     // life-weeks (early ADULT)
  IMMIGRANT_AGE_RANGE: 85,   // 55-140 life-weeks (working-age ADULT)
} as const;

/** Vacancy info for a residential building — used by family immigration to find suitable housing. */
export interface HousingVacancy {
  pos: string;       // "x,y"
  capacity: number;  // total residents capacity
  occupied: number;  // current occupants
}

/** Family composition weights: [type, weight] */
export const FAMILY_TYPES = {
  COUPLE_WITH_KIDS: { weight: 40, adults: 2, childRange: [1, 2] as [number, number] },
  YOUNG_COUPLE:     { weight: 30, adults: 2, childRange: [0, 0] as [number, number] },
  SINGLE:           { weight: 30, adults: 1, childRange: [0, 0] as [number, number] },
} as const;

/** A single member in a generated immigrant family */
export interface FamilyMember {
  age: number;
  education: EducationLevel;
  educationProgress: number;
}

/** Generate a random child age and appropriate education + progress */
export function generateChildEducation(age: number): { education: EducationLevel; progress: number } {
  // BABY: no education
  if (age <= LIFE_STAGE_AGE.BABY_MAX) return { education: EducationLevel.NONE, progress: 0 };

  // CHILD (9-32): working on elementary
  if (age <= LIFE_STAGE_AGE.CHILD_MAX) {
    const fraction = (age - LIFE_STAGE_AGE.BABY_MAX) / (LIFE_STAGE_AGE.CHILD_MAX - LIFE_STAGE_AGE.BABY_MAX);
    if (fraction > 0.7 && Math.random() < 0.5) {
      // Late child: 50% chance already graduated elementary, starting HS
      return { education: EducationLevel.ELEMENTARY, progress: Math.floor(Math.random() * 0.3 * GRADUATION_TICKS.highSchool) };
    }
    return { education: EducationLevel.NONE, progress: Math.floor(fraction * 0.9 * GRADUATION_TICKS.elementary) };
  }

  // TEEN (33-52): working on high school
  if (age <= LIFE_STAGE_AGE.TEEN_MAX) {
    const fraction = (age - LIFE_STAGE_AGE.CHILD_MAX) / (LIFE_STAGE_AGE.TEEN_MAX - LIFE_STAGE_AGE.CHILD_MAX);
    if (fraction < 0.3) {
      // Early teen: likely still finishing elementary or just started HS
      if (Math.random() < 0.4) return { education: EducationLevel.NONE, progress: Math.floor((0.7 + Math.random() * 0.3) * GRADUATION_TICKS.elementary) };
      return { education: EducationLevel.ELEMENTARY, progress: Math.floor(fraction * GRADUATION_TICKS.highSchool) };
    }
    if (fraction > 0.7 && Math.random() < 0.5) {
      // Late teen: 50% chance already graduated HS
      return { education: EducationLevel.HIGH_SCHOOL, progress: 0 };
    }
    return { education: EducationLevel.ELEMENTARY, progress: Math.floor(fraction * 0.9 * GRADUATION_TICKS.highSchool) };
  }

  // Shouldn't reach here for children, but fallback
  return { education: EducationLevel.NONE, progress: 0 };
}

/** Generate a random immigrant family — adult education weighted by city characteristics */
export function generateFamily(city?: CityAttractiveness): FamilyMember[] {
  const roll = randomInt(100);
  let type: typeof FAMILY_TYPES[keyof typeof FAMILY_TYPES];
  if (roll < FAMILY_TYPES.COUPLE_WITH_KIDS.weight) {
    type = FAMILY_TYPES.COUPLE_WITH_KIDS;
  } else if (roll < FAMILY_TYPES.COUPLE_WITH_KIDS.weight + FAMILY_TYPES.YOUNG_COUPLE.weight) {
    type = FAMILY_TYPES.YOUNG_COUPLE;
  } else {
    type = FAMILY_TYPES.SINGLE;
  }

  const members: FamilyMember[] = [];

  // Generate adults
  for (let i = 0; i < type.adults; i++) {
    const age = IMMIGRATION.IMMIGRANT_MIN_AGE + randomInt(IMMIGRATION.IMMIGRANT_AGE_RANGE);
    const education = city ? pickImmigrantEducation(city) : randomElement([EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY]);
    members.push({ age, education, educationProgress: 0 });
  }

  // Generate children
  const numChildren = type.childRange[0] + randomInt(type.childRange[1] - type.childRange[0] + 1);
  for (let i = 0; i < numChildren; i++) {
    // Random child age: BABY through TEEN (0 to TEEN_MAX)
    const age = randomInt(LIFE_STAGE_AGE.TEEN_MAX + 1);
    const { education, progress } = generateChildEducation(age);
    members.push({ age, education, educationProgress: progress });
  }

  return members;
}

/** Base education weights for immigrants — adjusted by city characteristics */
export const EDUCATION_WEIGHTS = {
  BASE: { [EducationLevel.NONE]: 30, [EducationLevel.ELEMENTARY]: 25, [EducationLevel.HIGH_SCHOOL]: 25, [EducationLevel.UNIVERSITY]: 20 },
  HAS_UNIVERSITY:       { [EducationLevel.NONE]: 0,   [EducationLevel.ELEMENTARY]: 0,  [EducationLevel.HIGH_SCHOOL]: 5,  [EducationLevel.UNIVERSITY]: 15 },
  HIGH_OFFICE:          { [EducationLevel.NONE]: 0,   [EducationLevel.ELEMENTARY]: 0,  [EducationLevel.HIGH_SCHOOL]: 5,  [EducationLevel.UNIVERSITY]: 10 },
  HIGH_INDUSTRIAL:      { [EducationLevel.NONE]: 10,  [EducationLevel.ELEMENTARY]: 5,  [EducationLevel.HIGH_SCHOOL]: 0,  [EducationLevel.UNIVERSITY]: -10 },
  HIGH_LAND_VALUE:      { [EducationLevel.NONE]: -10, [EducationLevel.ELEMENTARY]: 0,  [EducationLevel.HIGH_SCHOOL]: 0,  [EducationLevel.UNIVERSITY]: 10 },
  LOW_TAX:              { [EducationLevel.NONE]: 0,   [EducationLevel.ELEMENTARY]: 0,  [EducationLevel.HIGH_SCHOOL]: 5,  [EducationLevel.UNIVERSITY]: 5 },
  HIGH_TAX:             { [EducationLevel.NONE]: 5,   [EducationLevel.ELEMENTARY]: 0,  [EducationLevel.HIGH_SCHOOL]: -5, [EducationLevel.UNIVERSITY]: -10 },
} as const;

/** Pick immigrant education level weighted by city characteristics */
export function pickImmigrantEducation(city: CityAttractiveness): EducationLevel {
  const w: Record<EducationLevel, number> = { ...EDUCATION_WEIGHTS.BASE };

  if (city.hasUniversity)                    for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.HAS_UNIVERSITY[k as EducationLevel];
  if ((city.officeRatio ?? 0) > 0.3)         for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.HIGH_OFFICE[k as EducationLevel];
  if ((city.industrialRatio ?? 0) > 0.5)     for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.HIGH_INDUSTRIAL[k as EducationLevel];
  if ((city.avgLandValue ?? 0) > 150)        for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.HIGH_LAND_VALUE[k as EducationLevel];
  if (city.taxRate < 7)                      for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.LOW_TAX[k as EducationLevel];
  if (city.taxRate > 12)                     for (const k in w) w[k as EducationLevel] += EDUCATION_WEIGHTS.HIGH_TAX[k as EducationLevel];

  // Clamp weights to >= 1 (never zero out a level entirely)
  for (const k in w) w[k as EducationLevel] = Math.max(1, w[k as EducationLevel]);

  const levels = [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY] as const;
  const total = levels.reduce((s, l) => s + w[l], 0);
  const pool = levels.map(level => ({ level, weight: w[level] }));
  return pickWeighted(pool, total, e => e.weight).level;
}


export function calculateAttractiveness(city: CityAttractiveness): number {
  let score = 0;
  if (city.jobOpenings > 0) score += ATTRACTIVENESS.JOB_SCORE;
  if (city.vacantHomes > 0) score += ATTRACTIVENESS.VACANT_SCORE;
  score += city.avgHappiness * ATTRACTIVENESS.HAPPINESS_WEIGHT;
  score -= city.taxRate * ATTRACTIVENESS.TAX_WEIGHT;
  score -= city.pollution * ATTRACTIVENESS.POLLUTION_WEIGHT;
  score -= city.crimeRate * ATTRACTIVENESS.CRIME_WEIGHT;
  if (city.unemploymentRate !== undefined) {
    score -= city.unemploymentRate * ATTRACTIVENESS.UNEMPLOYMENT_WEIGHT;
  }
  return Math.max(ATTRACTIVENESS.MIN, Math.min(ATTRACTIVENESS.MAX, score));
}

/**
 * 計算移民上限，根據人口規模、空房數量、吸引力動態縮放。
 * - popCap: 人口的 1%，最低 3
 * - baseDemand: 吸引力超過 50 的部分除以 10，向上取整
 * - populationTier: max(1, floor(log10(pop)))，讓中後期城市成長更快
 * - demandCap = baseDemand × populationTier
 * - 取三者最小值（popCap、vacantHomes、demandCap）
 * - 吸引力 ≤ 50 時回傳 0
 */
export function getImmigrationCap(population: number, vacantHomes: number, attractiveness: number): number {
  if (attractiveness <= IMMIGRATION.ATTRACTIVENESS_THRESHOLD) return 0;
  const popCap = Math.max(IMMIGRATION.POP_CAP_MIN, Math.floor(population * IMMIGRATION.POP_CAP_FACTOR));
  const baseDemand = Math.ceil((attractiveness - IMMIGRATION.ATTRACTIVENESS_THRESHOLD) / IMMIGRATION.DEMAND_CAP_DIVISOR);
  const populationTier = Math.max(1, Math.floor(Math.log10(Math.max(1, population))));
  const demandCap = baseDemand * populationTier;
  return Math.min(popCap, vacantHomes, demandCap);
}

export function migrationTick(
  manager: CitizenManager,
  city: CityAttractiveness,
  population?: number,
  currentTick = 0,
  vacancies?: readonly HousingVacancy[],
): { immigrated: number; emigrated: number; emigratedIds: number[] } {
  let immigrated = 0;
  const emigratedIds: number[] = [];

  const attractiveness = calculateAttractiveness(city);
  // 使用傳入的 population，若未傳入則以 manager 現有人口為準
  const pop = population ?? manager.getPopulation();

  // Immigration — family-based: generate families until headroom is exhausted
  if (attractiveness > IMMIGRATION.ATTRACTIVENESS_THRESHOLD && city.vacantHomes > 0 && city.jobOpenings > 0) {
    const baseCap = getImmigrationCap(pop, city.vacantHomes, attractiveness);
    const jitter = IMMIGRATION.IMMIGRATION_JITTER_MIN +
      Math.random() * (IMMIGRATION.IMMIGRATION_JITTER_MAX - IMMIGRATION.IMMIGRATION_JITTER_MIN);
    const headroom = Math.max(1, Math.floor(baseCap * IMMIGRATION.IMMIGRATION_BASE_MULTIPLIER * jitter));

    // Build mutable vacancy list sorted by available space (largest first)
    const slots = vacancies
      ? vacancies.map(v => ({ ...v })).filter(v => v.capacity - v.occupied > 0).sort((a, b) => (b.capacity - b.occupied) - (a.capacity - a.occupied))
      : null;

    let filled = 0;
    while (filled < headroom) {
      let family = generateFamily(city);
      // If family is too large for remaining headroom, fallback to a single adult
      if (filled + family.length > headroom) {
        if (headroom - filled >= 1) {
          family = generateFamily();
          // Force single adult
          family = [family[0]!];
        } else {
          break;
        }
      }

      // Find housing with enough space for the entire family
      let assignedPos: string | null = null;
      if (slots) {
        const idx = slots.findIndex(v => v.capacity - v.occupied >= family.length);
        if (idx < 0) break; // no housing large enough
        assignedPos = slots[idx]!.pos;
        slots[idx]!.occupied += family.length;
        // Remove slot if full
        if (slots[idx]!.capacity - slots[idx]!.occupied <= 0) slots.splice(idx, 1);
      }

      for (const m of family) {
        manager.createCitizen({
          age: m.age,
          education: m.education,

          educationProgress: m.educationProgress,
          homeId: assignedPos,
        }, currentTick);
        immigrated++;
      }
      filled += family.length;
    }
  }

  // Emigration — citizens leave when happiness < personal emigrationTolerance
  const emigrationRate = IMMIGRATION.EMIGRATION_MIN_RATE +
    Math.random() * (IMMIGRATION.EMIGRATION_MAX_RATE - IMMIGRATION.EMIGRATION_MIN_RATE);
  const base = Math.floor(Math.random() * (IMMIGRATION.EMIGRATION_BASE_MAX + 1));
  const emigrationCap = base + Math.floor(pop * emigrationRate);
  for (const citizen of [...manager.getCitizens()]) {
    if (emigratedIds.length >= emigrationCap) break;
    const threshold = citizen.emigrationTolerance ?? IMMIGRATION.EMIGRATION_HAPPINESS_THRESHOLD;
    if (citizen.happiness < threshold) {
      emigratedIds.push(citizen.id);
      manager.removeCitizen(citizen.id);
    }
  }

  // Natural attrition — scales inversely with attractiveness
  // att ≥ 70: multiplier 0 (great city, nobody leaves randomly)
  // att 50–70: multiplier linearly 1.0→0
  // att < 50: multiplier 1.0 (full attrition)
  const attritionMultiplier = attractiveness >= 70 ? 0 : attractiveness >= 50 ? (70 - attractiveness) / 20 : 1.0;
  const expected = Math.min(IMMIGRATION.NATURAL_ATTRITION_CAP, pop * IMMIGRATION.NATURAL_ATTRITION_RATE * attritionMultiplier);
  // Probabilistic rounding: fractional part becomes chance of +1
  const attritionCount = Math.floor(expected) + (Math.random() < (expected % 1) ? 1 : 0);
  if (attritionCount > 0) {
    const candidates = manager.getCitizens().filter(c => !emigratedIds.includes(c.id));
    for (let i = 0; i < attritionCount && candidates.length > 0; i++) {
      const idx = randomInt(candidates.length);
      const citizen = candidates[idx]!;
      emigratedIds.push(citizen.id);
      manager.removeCitizen(citizen.id);
      candidates.splice(idx, 1);
    }
  }

  return { immigrated, emigrated: emigratedIds.length, emigratedIds };
}
