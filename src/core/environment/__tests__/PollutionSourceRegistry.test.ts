import { describe, it, expect } from 'vitest';
import { collectAllPollutionSources, forEachServicePollutionSource, type PollutionSourceProvider } from '../PollutionSourceRegistry';
import type { PollutionSource, PollutionType } from '../Pollution';

describe('PollutionSourceRegistry', () => {
  describe('collectAllPollutionSources', () => {
    it('returns empty array when no providers are given', () => {
      const result = collectAllPollutionSources([]);
      expect(result).toEqual([]);
    });

    it('collects sources from a single provider', () => {
      const provider: PollutionSourceProvider = {
        getPollutionSources: () => [
          { x: 1, y: 2, amount: 10, type: 'ground' },
        ],
      };
      const result = collectAllPollutionSources([provider]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ x: 1, y: 2, amount: 10, type: 'ground' });
    });

    it('collects sources from multiple providers', () => {
      const providerA: PollutionSourceProvider = {
        getPollutionSources: () => [
          { x: 0, y: 0, amount: 5, type: 'ground' },
        ],
      };
      const providerB: PollutionSourceProvider = {
        getPollutionSources: () => [
          { x: 3, y: 4, amount: 20, type: 'noise' },
          { x: 5, y: 6, amount: 15, type: 'water' },
        ],
      };
      const result = collectAllPollutionSources([providerA, providerB]);
      expect(result).toHaveLength(3);
    });

    it('handles providers that return empty arrays', () => {
      const emptyProvider: PollutionSourceProvider = {
        getPollutionSources: () => [],
      };
      const nonEmptyProvider: PollutionSourceProvider = {
        getPollutionSources: () => [
          { x: 1, y: 1, amount: 10, type: 'ground' },
        ],
      };
      const result = collectAllPollutionSources([emptyProvider, nonEmptyProvider]);
      expect(result).toHaveLength(1);
    });
  });

  describe('forEachServicePollutionSource', () => {
    it('collects sources from garbage, sewage, airport providers on state', () => {
      const collected: PollutionSource[] = [];
      const state = {
        garbage: { getPollutionSources: () => [{ x: 1, y: 2, amount: 10, type: 'ground' as PollutionType }] },
        sewage: { getPollutionSources: () => [{ x: 3, y: 4, amount: 20, type: 'water' as PollutionType }] },
        airport: { getPollutionSources: () => [{ x: 5, y: 6, amount: 15, type: 'noise' as PollutionType }] },
      };
      forEachServicePollutionSource(state, (src) => {
        collected.push(src);
      });
      expect(collected).toHaveLength(3);
      expect(collected[0]).toEqual({ x: 1, y: 2, amount: 10, type: 'ground' });
      expect(collected[1]).toEqual({ x: 3, y: 4, amount: 20, type: 'water' });
      expect(collected[2]).toEqual({ x: 5, y: 6, amount: 15, type: 'noise' });
    });

    it('skips missing providers gracefully', () => {
      const collected: PollutionSource[] = [];
      const state = {
        garbage: { getPollutionSources: () => [{ x: 1, y: 1, amount: 5, type: 'ground' as PollutionType }] },
        // no sewage or airport
      };
      forEachServicePollutionSource(state, (src) => {
        collected.push(src);
      });
      expect(collected).toHaveLength(1);
    });

    it('handles providers returning empty arrays', () => {
      const collected: PollutionSource[] = [];
      const state = {
        garbage: { getPollutionSources: () => [] },
        sewage: { getPollutionSources: () => [] },
        airport: { getPollutionSources: () => [] },
      };
      forEachServicePollutionSource(state, (src) => {
        collected.push(src);
      });
      expect(collected).toHaveLength(0);
    });

    it('should pass through radius property from pollution sources', () => {
      const collected: PollutionSource[] = [];
      const state = {
        airport: { getPollutionSources: () => [{ x: 5, y: 6, amount: 15, type: 'noise' as PollutionType, radius: 5 }] },
      };
      forEachServicePollutionSource(state, (src) => {
        collected.push(src);
      });
      expect(collected[0]!.radius).toBe(5);
    });
  });
});
