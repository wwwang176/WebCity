import { describe, it, expect } from 'vitest';
import { collectAllPollutionSources, type PollutionSourceProvider } from '../PollutionSourceRegistry';
import type { PollutionSource } from '../Pollution';

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
});
