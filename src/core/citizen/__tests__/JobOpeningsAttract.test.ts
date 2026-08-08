import { describe, it, expect } from 'vitest';
import { calculateAttractiveness, IMMIGRATION } from '../Migration';

/**
 * countJobOpenings became `totalJobs - employed` rather than
 * `totalJobs - population` (BUG-140's sibling). For calculateRCIDemand that is
 * the right number — RCI.JOB_MULTIPLIER is documented as "each job OPENING adds
 * this much", and a vacancy count is literally that.
 *
 * calculateAttractiveness was never recalibrated for it. Under the old
 * definition, `jobOpenings > 0` implied totalJobs > population, which implied
 * unemployment was structurally low: the two were coupled, and the population
 * term was the only supply-side brake the model had. They are now independent,
 * and the weights were not written for that — JOB_SCORE is +20 while the entire
 * unemployment penalty maxes at 15. A single permanently unfillable desk was
 * therefore worth net +5 at 100% unemployment (BUG-166).
 *
 * Concretely: zone an industrial park reachable only across an unbuilt link.
 * 400 jobs, 200 filled, 30% unemployment — attractiveness 43 against a
 * threshold of 40, so immigration continues, rDemand stays pinned near max,
 * developers keep building houses, vacantHomes rises, more people arrive, and
 * none of them can reach the work.
 */
const CITY = {
  jobOpenings: 0, vacantHomes: 0, avgHappiness: 60, taxRate: 9,
  pollution: 30, crimeRate: 40, unemploymentRate: 0,
};

describe('job openings attract people who could actually take them', () => {
  it('should reward openings in a city with work for everyone', () => {
    const withJobs = calculateAttractiveness({ ...CITY, jobOpenings: 200 });
    const without = calculateAttractiveness({ ...CITY, jobOpenings: 0 });
    expect(withJobs).toBeGreaterThan(without);
  });

  it('should reward nothing for openings nobody can reach', () => {
    // 100% unemployment with jobs on the books: the jobs exist and are not
    // attainable, which is the state an unreachable industrial park produces.
    const stranded = calculateAttractiveness({ ...CITY, jobOpenings: 400, unemploymentRate: 1 });
    const none = calculateAttractiveness({ ...CITY, jobOpenings: 0, unemploymentRate: 1 });
    expect(stranded).toBe(none);
  });

  it('should never let an unfillable job outweigh the unemployment it causes', () => {
    // The defect stated as an inequality: a city with jobs and total
    // unemployment must not be more attractive than the same city with neither.
    const stranded = calculateAttractiveness({ ...CITY, jobOpenings: 400, unemploymentRate: 1 });
    const healthy = calculateAttractiveness({ ...CITY, jobOpenings: 0, unemploymentRate: 0 });
    expect(stranded).toBeLessThan(healthy);
  });

  it('should fall away smoothly as unemployment rises', () => {
    const at = (rate: number) =>
      calculateAttractiveness({ ...CITY, jobOpenings: 400, unemploymentRate: rate });
    const scores = [0, 0.25, 0.5, 0.75, 1].map(at);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!, `unemployment ${i}`).toBeLessThan(scores[i - 1]!);
    }
  });

  it('should stop the runaway loop the review described', () => {
    // 400 jobs, 200 filled, 30% unemployment — the reachability-capped
    // industrial park. It used to score above the immigration threshold.
    const score = calculateAttractiveness({
      jobOpenings: 200, vacantHomes: 40, avgHappiness: 60, taxRate: 9,
      pollution: 30, crimeRate: 40, unemploymentRate: 0.3,
    });
    expect(score).toBeLessThanOrEqual(IMMIGRATION.ATTRACTIVENESS_THRESHOLD);
  });

  it('should treat a missing unemployment figure as full employment', () => {
    // Callers that do not track it must not silently lose the job bonus.
    const known = calculateAttractiveness({ ...CITY, jobOpenings: 200, unemploymentRate: 0 });
    const { unemploymentRate: _drop, ...noRate } = { ...CITY, jobOpenings: 200 };
    expect(calculateAttractiveness(noRate)).toBe(known);
  });
});
