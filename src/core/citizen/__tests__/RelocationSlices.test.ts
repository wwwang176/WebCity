import { describe, it, expect } from 'vitest';
import { relocationTick, DEFAULT_RELOCATION_CONFIG } from '../Relocation';
import { citizenSliceOf } from '../../simulation/CitizenSlicing';
import type { HousingCandidate } from '../HousingScore';
import { EducationLevel, type Citizen } from '../types';

/**
 * One relocation pass scores every unhappy citizen against every home in the city: 195ms measured
 * at 120,000 against the 250ms a tick has at speed 1 (BUG-331).
 *
 * The answer is **bringing part of the population to each evaluation**, more often. What has to
 * be pinned is that slicing does not change the total, and that each slice is an independent
 * meeting — not one list spread across dozens of ticks, which let the candidate homes, the
 * occupancy and who is still alive all go stale, and produced new problems through three rounds
 * of patches.
 */

function citizen(id: number, homeId: string, happiness: number): Citizen {
  return {
    id, name: `c${id}`, age: 100, lifeStage: 'ADULT', education: EducationLevel.NONE,
    educationProgress: 0, homeId, workplaceId: null, happiness, health: 100,
    incomeLevel: 'MEDIUM', unemployedSince: null,
  } as unknown as Citizen;
}

/** `level` decides the score: education NONE prefers level 1, and two levels away is -10. */
function candidate(pos: string, level: number): HousingCandidate {
  return {
    pos, capacity: 50, level, landValue: 128,
    groundPollution: 0, noisePollution: 0, serviceCoverage: 6, hasPark: false,
  };
}

/** A group of unhappy citizens in poor housing (level 3) with better housing (level 1) nearby. */
function scenario(n: number) {
  const citizens: Citizen[] = [];
  for (let i = 0; i < n; i++) citizens.push(citizen(i + 1, 'bad', 10));
  const candidates = [candidate('bad', 3), candidate('good', 1)];
  candidates[1]!.capacity = n * 2;
  const occupancy = new Map<string, number>([['bad', n], ['good', 0]]);
  return { citizens, candidates, occupancy };
}

/** A simple rule splitting ids into N slices. The implementation uses a hash; all that is needed
 *  here is that slicing happens. */
const sliceOf = (n: number) => (c: Citizen) => c.id % n;

describe('分批評估', () => {
  it('should only consider citizens in the given slice', () => {
    // With slicing unwired, one call still takes everyone: the cost does not fall at all while
    // every value-checking assertion stays green.
    const { citizens, candidates, occupancy } = scenario(400);
    const pick = sliceOf(4);
    const { relocatedIds } = relocationTick(citizens, candidates, occupancy,
      undefined, (c) => pick(c) === 0);

    expect(relocatedIds.length).toBeGreaterThan(0);
    for (const id of relocatedIds) {
      const c = citizens.find(x => x.id === id)!;
      expect(pick(c), `市民 ${id} 不在這一批裡卻被搬了家`).toBe(0);
    }
  });

  it('should cover everyone across a full round of the production hash', () => {
    // A full cycle through the **actual** slicing rule, identifying each citizen. Writing an
    // `id % N` in the test and walking all N is trivially true and stays green when the
    // implementation changes.
    const N = 10;
    const { citizens, candidates, occupancy } = scenario(400);
    const seen = new Set<number>();
    for (let s = 0; s < N; s++) {
      for (const c of citizens) if (citizenSliceOf(c.id, N) === s) seen.add(c.id);
    }
    expect(seen.size, '一圈沒有蓋到全部人').toBe(citizens.length);
  });

  it('should keep a whole round within the city-wide 5% cap', () => {
    // **The easiest thing to get wrong about slicing.** Taking 5% per slice does not sum to 5%
    // of the city: `Math.max(1, Math.floor(n * 0.05))` rounds within each slice, and small slices
    // all round up to 1. 400 across 4 slices divides evenly and hides it, so these numbers
    // deliberately leave a remainder.
    for (const [pop, N] of [[100, 10], [390, 10], [37, 10], [1000, 10]] as const) {
      const oneGo = scenario(pop);
      const all = relocationTick(oneGo.citizens, oneGo.candidates, oneGo.occupancy);

      const sliced = scenario(pop);
      const cycleQuota = Math.max(1,
        Math.floor(pop * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
      let total = 0;
      for (let s = 0; s < N; s++) {
        // The caller computes the quota by a staircase, so ten slices sum to exactly cycleQuota.
        const quota = Math.floor((s + 1) * cycleQuota / N) - Math.floor(s * cycleQuota / N);
        total += relocationTick(sliced.citizens, sliced.candidates, sliced.occupancy,
          undefined, (c) => citizenSliceOf(c.id, N) === s, quota).count;
      }
      expect(total, `${pop} 人:一次跑 ${all.count} 位，分 ${N} 批共 ${total} 位`)
        .toBe(all.count);
    }
  });

  it('should honour an explicit quota exactly', () => {
    const { citizens, candidates, occupancy } = scenario(400);
    const { count } = relocationTick(citizens, candidates, occupancy,
      undefined, () => true, 7);
    expect(count, '配額沒有被遵守').toBe(7);
  });

  it('should ask inSlice once per citizen when a quota is given', () => {
    // Without a quota the unhappy citizens are counted first and `inSlice` is asked twice. With
    // one, nothing is counted, so the caller need not guarantee `inSlice` is pure.
    const { citizens, candidates, occupancy } = scenario(200);
    const asked = new Map<number, number>();
    relocationTick(citizens, candidates, occupancy, undefined,
      (c) => { asked.set(c.id, (asked.get(c.id) ?? 0) + 1); return true; }, 3);
    for (const [id, n] of asked) {
      expect(n, `市民 ${id} 被問了 ${n} 次`).toBe(1);
    }
  });

  it('should behave exactly as before when no slice is given', () => {
    // Omitting inSlice means everyone. Existing callers and tests do not pass it.
    const a = scenario(300);
    const withoutArg = relocationTick(a.citizens, a.candidates, a.occupancy);
    const b = scenario(300);
    const withTrue = relocationTick(b.citizens, b.candidates, b.occupancy, undefined, () => true);
    expect(withoutArg.relocatedIds).toEqual(withTrue.relocatedIds);
  });

  it('should not move anyone when the slice is empty', () => {
    const { citizens, candidates, occupancy } = scenario(200);
    const { count } = relocationTick(citizens, candidates, occupancy, undefined, () => false);
    expect(count).toBe(0);
  });
});
