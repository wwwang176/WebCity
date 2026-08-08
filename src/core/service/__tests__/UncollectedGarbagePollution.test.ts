import { describe, it, expect } from 'vitest';
import { GarbageService } from '../GarbageService';

/**
 * The uncollected-garbage pollution penalty was spread across operational
 * landfills — and skipped entirely when there were none. That produced a
 * perverse incentive: with no landfill at all, garbage piled up forever and
 * contributed exactly zero pollution, so "do nothing" strictly beat "start
 * handling waste", which immediately added BASE_POLLUTION per landfill cell
 * plus the share of the penalty (BUG-101).
 *
 * getPollutionSources is the only route by which garbage enters the pollution
 * grid, so nothing else compensated.
 */
function pileUpGarbage(): GarbageService {
  const garbage = new GarbageService();
  for (let i = 0; i < 40; i++) {
    garbage.reportGarbage(5 + (i % 3), 5, 4);
  }
  garbage.tick();
  return garbage;
}

describe('uncollected garbage pollutes even with no landfill', () => {
  it('should have an uncollected penalty to account for', () => {
    expect(pileUpGarbage().getPollutionPenalty()).toBeGreaterThan(0);
  });

  it('should emit pollution when the city has no landfill at all', () => {
    const sources = pileUpGarbage().getPollutionSources();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every(s => s.type === 'ground')).toBe(true);
  });

  it('should emit it where the rubbish actually is', () => {
    const sources = pileUpGarbage().getPollutionSources();
    for (const s of sources) {
      expect(s.y).toBe(5);
      expect(s.x).toBeGreaterThanOrEqual(5);
      expect(s.x).toBeLessThanOrEqual(7);
    }
  });

  it('should conserve the penalty instead of scaling with the number of piles', () => {
    // Math.ceil rounded every rubbish-bearing cell up to at least 1, so the total
    // was >= the number of distinct cells — easily 10-20x MAX_POLLUTION_PENALTY
    // in a mid-size city, and growing with city size. It also quantised away the
    // difference between one bag and a hundred (BUG-122).
    // Many positions holding ONE bag each is the shape that exposes it: with
    // perBag < 1, ceil rounds every single position up to a full point.
    const garbage = new GarbageService();
    for (let i = 0; i < 200; i++) garbage.reportGarbage(i % 50, Math.floor(i / 50), 1);
    garbage.tick();

    const total = garbage.getPollutionSources().reduce((s, x) => s + x.amount, 0);

    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(garbage.getPollutionPenalty(), 5);
  });

  it('should put more pollution on a bigger pile', () => {
    const garbage = new GarbageService();
    for (let i = 0; i < 40; i++) garbage.reportGarbage(5, 5, 4);
    for (let i = 0; i < 4; i++) garbage.reportGarbage(9, 5, 4);
    garbage.tick();

    const sources = garbage.getPollutionSources();
    const big = sources.find(s => s.x === 5 && s.y === 5)!;
    const small = sources.find(s => s.x === 9 && s.y === 5)!;

    expect(big.amount).toBeGreaterThan(small.amount);
  });

  it('should emit nothing when there is no garbage and no landfill', () => {
    const garbage = new GarbageService();
    garbage.tick();
    expect(garbage.getPollutionSources()).toHaveLength(0);
  });
});
