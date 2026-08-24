/**
 * VehicleAnimator — the common interface for vehicle animation on the render side.
 *
 * Every vehicle that interpolates along a path with animation of its own — ferries, metros,
 * aircraft — implements it, so Game.ts drives them all the same way.
 */
export interface VehicleAnimator {
  /**
   * Advances the animation by one frame.
   * @param dt    The frame interval, in seconds.
   * @param speed The game speed multiplier; 0 is paused.
   * @param args  Extra parameters each animator defines for itself.
   */
  update(dt: number, speed: number, ...args: unknown[]): void;

  /** Releases internal state. */
  dispose(): void;
}
