import type { PollutionSource, PollutionType } from './Pollution';

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

/**
 * All service keys on GameState that implement PollutionSourceProvider.
 * Adding a new pollution source only requires appending to this array (OCP).
 */
const POLLUTION_PROVIDER_KEYS: readonly string[] = [
  'garbage', 'sewage', 'airport',
];

/**
 * Visit all service-based pollution sources without intermediate arrays (GC-friendly).
 * OCP: adding a new pollution source service only requires updating POLLUTION_PROVIDER_KEYS.
 */
export function forEachServicePollutionSource(
  state: Record<string, unknown>,
  emit: (x: number, y: number, amount: number, type: PollutionType) => void,
): void {
  for (const key of POLLUTION_PROVIDER_KEYS) {
    const provider = state[key] as PollutionSourceProvider | undefined;
    if (!provider) continue;
    for (const src of provider.getPollutionSources()) {
      emit(src.x, src.y, src.amount, src.type);
    }
  }
}
