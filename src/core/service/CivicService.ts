/**
 * Common interface for all civic services (police, fire, health, etc.).
 * Provides a uniform contract for cost calculation and serialization.
 *
 * Note: tick() is intentionally excluded (ISP) — each service has its own
 * tick signature (some require population, etc.) and tick calls are made
 * directly through typed GameState properties, not polymorphically.
 */
export interface CivicService {
  /** Return the per-tick maintenance cost of this service. */
  getMaintenanceCost(): number;
  /** Serialize service state for save/load. */
  toJSON(): unknown;
}
