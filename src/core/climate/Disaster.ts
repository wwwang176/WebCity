export enum DisasterType {
  EARTHQUAKE = 'EARTHQUAKE',
  TORNADO = 'TORNADO',
  TSUNAMI = 'TSUNAMI',
  FOREST_FIRE = 'FOREST_FIRE',
  METEOR = 'METEOR',
}

export interface Disaster {
  type: DisasterType;
  epicenterX: number;
  epicenterY: number;
  intensity: number; // 0-1
  radius: number;
  ticksRemaining: number;
}

interface DisasterDefaults {
  radius: number;
  ticks: number;
}

/** Per-disaster-type damage modifiers */
export const DISASTER_MODIFIERS = {
  TORNADO_PATH_HALF_WIDTH: 1.5,
  TSUNAMI_DAMAGE_FACTOR: 0.8,
  FOREST_FIRE_DAMAGE_FACTOR: 0.7,
  METEOR_FALLOFF_FACTOR: 0.6,
  METEOR_DIRECT_HIT_RADIUS: 1,
} as const;

const DISASTER_DEFAULTS: Record<DisasterType, DisasterDefaults> = {
  [DisasterType.EARTHQUAKE]: { radius: 10, ticks: 5 },
  [DisasterType.TORNADO]: { radius: 15, ticks: 10 },
  [DisasterType.TSUNAMI]: { radius: 20, ticks: 8 },
  [DisasterType.FOREST_FIRE]: { radius: 8, ticks: 15 },
  [DisasterType.METEOR]: { radius: 6, ticks: 3 },
};

export function createDisaster(
  type: DisasterType,
  x: number,
  y: number,
  intensity: number,
): Disaster {
  const clamped = Math.max(0, Math.min(1, intensity));
  const defaults = DISASTER_DEFAULTS[type];
  return {
    type,
    epicenterX: x,
    epicenterY: y,
    intensity: clamped,
    radius: defaults.radius,
    ticksRemaining: defaults.ticks,
  };
}

type DamageCalculator = (disaster: Disaster, buildingX: number, buildingY: number) => number;

/** Data-driven damage calculators per disaster type (OCP). */
export const DISASTER_CALCULATORS: Record<DisasterType, DamageCalculator> = {
  [DisasterType.EARTHQUAKE](disaster, buildingX, buildingY) {
    const distance = getDistance(disaster, buildingX, buildingY);
    if (distance >= disaster.radius) return 0;
    return Math.max(0, disaster.intensity * (1 - distance / disaster.radius));
  },

  [DisasterType.TORNADO](disaster, buildingX, buildingY) {
    const dy = buildingY - disaster.epicenterY;
    const distance = getDistance(disaster, buildingX, buildingY);
    const pathHalfWidth = DISASTER_MODIFIERS.TORNADO_PATH_HALF_WIDTH;
    if (distance >= disaster.radius) return 0;
    const perpendicularDist = Math.abs(dy) < pathHalfWidth ? Math.abs(dy) : pathHalfWidth + 1;
    if (perpendicularDist > pathHalfWidth) return 0;
    const widthFactor = 1 - perpendicularDist / pathHalfWidth;
    const distanceFactor = 1 - distance / disaster.radius;
    return Math.max(0, disaster.intensity * widthFactor * distanceFactor);
  },

  [DisasterType.TSUNAMI](disaster, buildingX, buildingY) {
    const distance = getDistance(disaster, buildingX, buildingY);
    if (distance >= disaster.radius) return 0;
    return Math.max(0, disaster.intensity * (1 - distance / disaster.radius) * DISASTER_MODIFIERS.TSUNAMI_DAMAGE_FACTOR);
  },

  [DisasterType.FOREST_FIRE](disaster, buildingX, buildingY) {
    const distance = getDistance(disaster, buildingX, buildingY);
    if (distance >= disaster.radius) return 0;
    return Math.max(0, disaster.intensity * (1 - distance / disaster.radius) * DISASTER_MODIFIERS.FOREST_FIRE_DAMAGE_FACTOR);
  },

  [DisasterType.METEOR](disaster, buildingX, buildingY) {
    const distance = getDistance(disaster, buildingX, buildingY);
    if (distance >= disaster.radius) return 0;
    if (distance <= DISASTER_MODIFIERS.METEOR_DIRECT_HIT_RADIUS) {
      return disaster.intensity;
    }
    return Math.max(0, disaster.intensity * DISASTER_MODIFIERS.METEOR_FALLOFF_FACTOR * (1 - distance / disaster.radius));
  },
};

function getDistance(disaster: Disaster, buildingX: number, buildingY: number): number {
  const dx = buildingX - disaster.epicenterX;
  const dy = buildingY - disaster.epicenterY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateDamage(
  disaster: Disaster,
  buildingX: number,
  buildingY: number,
): number {
  const calculator = DISASTER_CALCULATORS[disaster.type];
  return calculator ? calculator(disaster, buildingX, buildingY) : 0;
}
