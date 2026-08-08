/**
 * Pure function for calculating citizen health score.
 * Extracted from SimulationLoop for SRP compliance.
 */

/** Health calculation constants. */
export const HEALTH = {
  BASE: 50,
  HOME_BONUS: 10,
  HOSPITAL_MAX_BONUS: 30,
  PARK_BONUS: 5,
  POLLUTION_MAX_PENALTY: 15,
  /** Full-scale value of the `pollution` factor — the grid cell range, not 100. */
  POLLUTION_SCALE: 255,
  AGE_THRESHOLD: 200,
  AGE_RANGE: 60,
  AGE_MAX_PENALTY: 10,
} as const;

/** Factors that influence a citizen's health score. */
export interface HealthFactors {
  /** Hospital cost ratio: -1=uncovered, 0=nearest, 1=farthest */
  hospitalCostRatio: number;
  /** Whether the citizen's home has park coverage */
  hasParkCoverage: boolean;
  /** Cell pollution at home (0–255) */
  pollution: number;
  /** Whether the citizen has a home */
  hasHome: boolean;
  /** Citizen age in ticks */
  age: number;
}

/**
 * Calculate a citizen's health score (0–100).
 * Pure function — no side effects, no state dependencies.
 */
export function calculateCitizenHealth(factors: HealthFactors): number {
  let health = HEALTH.BASE;

  if (factors.hasHome) {
    // Hospital coverage: 0–30 (linear with distance)
    if (factors.hospitalCostRatio >= 0) {
      health += (1 - factors.hospitalCostRatio) * HEALTH.HOSPITAL_MAX_BONUS;
    }

    // Park coverage: +5
    if (factors.hasParkCoverage) {
      health += HEALTH.PARK_BONUS;
    }

    // Pollution penalty: 0–15.
    // The divisor must match the field's range. `pollution` is the 0-255 grid
    // value (SimulationLoop writes min(CELL_VALUE_MAX, ground + water + noise)),
    // so dividing by 100 turned POLLUTION_MAX_PENALTY into a rate rather than a
    // maximum: 255 pollution cost 38.25 points, 2.5x the stated cap, and
    // industrial neighbourhoods routinely exceed 100 (BUG-083).
    health -= (Math.min(factors.pollution, HEALTH.POLLUTION_SCALE) / HEALTH.POLLUTION_SCALE)
      * HEALTH.POLLUTION_MAX_PENALTY;

    // Has home: +10
    health += HEALTH.HOME_BONUS;
  }

  // Senior age penalty: linear 0–10 for age 201–260
  if (factors.age > HEALTH.AGE_THRESHOLD) {
    health -= Math.min(
      HEALTH.AGE_MAX_PENALTY,
      ((factors.age - HEALTH.AGE_THRESHOLD) / HEALTH.AGE_RANGE) * HEALTH.AGE_MAX_PENALTY,
    );
  }

  return Math.max(0, Math.min(100, Math.round(health)));
}
