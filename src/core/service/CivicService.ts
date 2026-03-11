/**
 * Common interface for all civic services (police, fire, health, etc.).
 * Provides a uniform contract for service lifecycle and cost calculation,
 * improving extensibility (OCP) and reducing coupling (DIP).
 */
export interface CivicService {
  /** Advance the service by one tick. */
  tick(...args: unknown[]): void;
  /** Return the per-tick maintenance cost of this service. */
  getMaintenanceCost(): number;
  /** Serialize service state for save/load. */
  toJSON(): unknown;
}
