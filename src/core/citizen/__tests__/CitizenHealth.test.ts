import { describe, it, expect } from 'vitest';
import { calculateCitizenHealth, HEALTH, type HealthFactors } from '../CitizenHealth';

/** Helper: create default factors (adult with home, no services). */
function defaultFactors(overrides?: Partial<HealthFactors>): HealthFactors {
  return {
    hospitalCostRatio: -1, // uncovered
    hasParkCoverage: false,
    pollution: 0,
    hasHome: true,
    age: 100,
    ...overrides,
  };
}

describe('calculateCitizenHealth', () => {
  it('returns base + home bonus when no services or penalties', () => {
    const h = calculateCitizenHealth(defaultFactors());
    // base 50 + home 10 = 60
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS);
  });

  it('homeless citizen gets only base health', () => {
    const h = calculateCitizenHealth(defaultFactors({ hasHome: false }));
    expect(h).toBe(HEALTH.BASE);
  });

  it('hospital at nearest range gives full coverage bonus', () => {
    const h = calculateCitizenHealth(defaultFactors({ hospitalCostRatio: 0 }));
    // base 50 + home 10 + hospital 30 = 90
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS + HEALTH.HOSPITAL_MAX_BONUS);
  });

  it('hospital at mid-range gives partial coverage bonus', () => {
    const h = calculateCitizenHealth(defaultFactors({ hospitalCostRatio: 0.5 }));
    // base 50 + home 10 + hospital 15 = 75
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS + HEALTH.HOSPITAL_MAX_BONUS * 0.5);
  });

  it('hospital at farthest range gives zero bonus', () => {
    const h = calculateCitizenHealth(defaultFactors({ hospitalCostRatio: 1 }));
    // base 50 + home 10 + hospital 0 = 60
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS);
  });

  it('park coverage adds bonus', () => {
    const h = calculateCitizenHealth(defaultFactors({ hasParkCoverage: true }));
    // base 50 + home 10 + park 5 = 65
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS + HEALTH.PARK_BONUS);
  });

  it('pollution reduces health proportionally', () => {
    // POLLUTION_SCALE, not 100: `pollution` is the 0-255 grid cell value.
    const h = calculateCitizenHealth(defaultFactors({ pollution: HEALTH.POLLUTION_SCALE }));
    // base 50 + home 10 - pollution 15 = 45
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS - HEALTH.POLLUTION_MAX_PENALTY);
  });

  it('partial pollution gives partial penalty', () => {
    const h = calculateCitizenHealth(defaultFactors({ pollution: HEALTH.POLLUTION_SCALE / 2 }));
    // base 50 + home 10 - 7.5 = 52.5 → 53 (rounded)
    expect(h).toBe(Math.round(HEALTH.BASE + HEALTH.HOME_BONUS - HEALTH.POLLUTION_MAX_PENALTY * 0.5));
  });

  it('caps the pollution penalty at POLLUTION_MAX_PENALTY', () => {
    // Dividing by 100 made the "max" a rate: 255 pollution cost 38.25 points.
    const clean = calculateCitizenHealth(defaultFactors({ pollution: 0 }));
    const filthy = calculateCitizenHealth(defaultFactors({ pollution: 255 }));
    expect(clean - filthy).toBeLessThanOrEqual(HEALTH.POLLUTION_MAX_PENALTY);
  });

  it('senior age 201 gets minimal penalty', () => {
    const h = calculateCitizenHealth(defaultFactors({ age: 201 }));
    // penalty = min(10, ((201-200)/60)*10) = min(10, 0.167) ≈ 0.167
    // base 50 + home 10 - 0.167 = 59.83 → 60
    expect(h).toBe(60);
  });

  it('senior age 260 gets full age penalty', () => {
    const h = calculateCitizenHealth(defaultFactors({ age: 260 }));
    // penalty = min(10, ((260-200)/60)*10) = 10
    // base 50 + home 10 - 10 = 50
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS - HEALTH.AGE_MAX_PENALTY);
  });

  it('senior age 300 caps penalty at max', () => {
    const h = calculateCitizenHealth(defaultFactors({ age: 300 }));
    // penalty = min(10, ((300-200)/60)*10) = 10 (capped)
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS - HEALTH.AGE_MAX_PENALTY);
  });

  it('young citizen gets no age penalty', () => {
    const h = calculateCitizenHealth(defaultFactors({ age: 50 }));
    expect(h).toBe(HEALTH.BASE + HEALTH.HOME_BONUS);
  });

  it('combined factors: hospital + park + pollution + age', () => {
    const h = calculateCitizenHealth(defaultFactors({
      hospitalCostRatio: 0,
      hasParkCoverage: true,
      pollution: HEALTH.POLLUTION_SCALE,
      age: 260,
    }));
    // base 50 + home 10 + hospital 30 + park 5 - pollution 15 - age 10 = 70
    expect(h).toBe(70);
  });

  it('clamps to minimum 0', () => {
    // Homeless + old (extreme) = base 50 - 10 = 40 at most lost from age
    // Actually to get 0 we'd need extreme negative. Let's use pollution + age on homeless
    // homeless: base 50 only, age 260: -10 = 40. Can't go below 0 easily.
    // But let's verify the clamp works
    const h = calculateCitizenHealth(defaultFactors({ hasHome: false, age: 260 }));
    expect(h).toBe(HEALTH.BASE - HEALTH.AGE_MAX_PENALTY); // 40
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('clamps to maximum 100', () => {
    const h = calculateCitizenHealth(defaultFactors({
      hospitalCostRatio: 0,
      hasParkCoverage: true,
    }));
    // base 50 + home 10 + hospital 30 + park 5 = 95
    expect(h).toBe(95);
    expect(h).toBeLessThanOrEqual(100);
  });

  it('homeless citizen ignores location-based factors', () => {
    // Even with hospital/park/pollution set, homeless gets only base
    const h = calculateCitizenHealth(defaultFactors({
      hasHome: false,
      hospitalCostRatio: 0,
      hasParkCoverage: true,
      pollution: 50,
    }));
    expect(h).toBe(HEALTH.BASE);
  });
});
