/**
 * Traffic light system for intersections.
 * Phase 0: N-S green, E-W red
 * Phase 1: N-S red, E-W green
 */

export interface TrafficLight {
  x: number;
  y: number;
  phase: number; // 0 = NS green / EW red, 1 = NS red / EW green
  timer: number; // ticks remaining in current phase
}

const PHASE_DURATION = 8; // ticks per phase (~2 seconds at 250ms/tick)

export class TrafficLightSystem {
  private lights = new Map<string, TrafficLight>();

  addLight(x: number, y: number): void {
    const key = `${x},${y}`;
    if (this.lights.has(key)) return;
    // Stagger phase start by position hash to avoid all lights syncing
    const stagger = (x * 7 + y * 13) % PHASE_DURATION;
    this.lights.set(key, { x, y, phase: 0, timer: stagger + 1 });
  }

  removeLight(x: number, y: number): void {
    this.lights.delete(`${x},${y}`);
  }

  tick(): void {
    for (const light of this.lights.values()) {
      light.timer--;
      if (light.timer <= 0) {
        light.phase = (light.phase + 1) % 2;
        light.timer = PHASE_DURATION;
      }
    }
  }

  /**
   * Check if a vehicle traveling from (fromX,fromY) to (toX,toY) can enter.
   * Only blocks if (toX,toY) is a traffic-light intersection and the light is red
   * for the vehicle's direction.
   */
  canPass(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const light = this.lights.get(`${toX},${toY}`);
    if (!light) return true;

    const dx = toX - fromX;
    const dy = toY - fromY;
    // N-S movement: dy != 0
    const isNS = dy !== 0;
    if (isNS) return light.phase === 0; // phase 0 = NS green
    return light.phase === 1; // phase 1 = EW green
  }

  getLight(x: number, y: number): TrafficLight | undefined {
    return this.lights.get(`${x},${y}`);
  }

  getLights(): TrafficLight[] {
    return [...this.lights.values()];
  }

  clear(): void {
    this.lights.clear();
  }
}
