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

  it('should emit nothing when there is no garbage and no landfill', () => {
    const garbage = new GarbageService();
    garbage.tick();
    expect(garbage.getPollutionSources()).toHaveLength(0);
  });
});
