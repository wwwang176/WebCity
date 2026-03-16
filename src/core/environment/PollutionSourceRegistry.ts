import type { PollutionSource } from './Pollution';

/** Any module that produces pollution sources implements this interface (DIP). */
export interface PollutionSourceProvider {
  getPollutionSources(): PollutionSource[];
}

/** Collect all pollution sources from registered providers. */
export function collectAllPollutionSources(
  providers: readonly PollutionSourceProvider[],
): PollutionSource[] {
  const sources: PollutionSource[] = [];
  for (const provider of providers) {
    for (const src of provider.getPollutionSources()) {
      sources.push(src);
    }
  }
  return sources;
}
