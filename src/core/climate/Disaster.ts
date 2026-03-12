import { euclideanDistance } from '../grid/GridHelpers';

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
  return euclideanDistance(disaster.epicenterX, disaster.epicenterY, buildingX, buildingY);
}

export function calculateDamage(
  disaster: Disaster,
  buildingX: number,
  buildingY: number,
): number {
  const calculator = DISASTER_CALCULATORS[disaster.type];
  return calculator ? calculator(disaster, buildingX, buildingY) : 0;
}

/** Random disaster event configuration. */
export const RANDOM_DISASTER = {
  /** Probability per tick (~0.1%, roughly once per 1000 ticks / ~4 game months) */
  CHANCE_PER_TICK: 0.001,
  /** Minimum population before disasters can occur */
  MIN_POPULATION: 50,
  /** Minimum disaster intensity */
  MIN_INTENSITY: 0.3,
  /** Maximum disaster intensity (min + random * range) */
  MAX_INTENSITY: 0.8,
  /** Damage threshold above which buildings are destroyed */
  DAMAGE_DESTROY_THRESHOLD: 0.5,
  /** Disaster types eligible for random events */
  ELIGIBLE_TYPES: [DisasterType.EARTHQUAKE, DisasterType.TORNADO, DisasterType.FOREST_FIRE] as readonly DisasterType[],
} as const;

/** Disaster display names. */
export const DISASTER_NAMES: Record<string, string> = {
  EARTHQUAKE: 'Earthquake', TORNADO: 'Tornado', FOREST_FIRE: 'Forest Fire',
};

/** Format a disaster event into a human-readable notification message. */
export function formatDisasterMessage(d: Disaster): string {
  return `Disaster: ${DISASTER_NAMES[d.type] ?? d.type} at (${d.epicenterX},${d.epicenterY})! Intensity: ${Math.round(d.intensity * 100)}%`;
}

export interface RandomDisasterResult {
  disaster: Disaster;
  damagedCells: { x: number; y: number }[];
}

/**
 * Roll for a random disaster. Returns null if none triggered.
 * @param gridWidth - grid width for random placement
 * @param gridHeight - grid height for random placement
 * @param population - current city population
 * @param probabilityOverride - override for testing (0-1, default uses CHANCE_PER_TICK)
 */
export function tryRandomDisaster(
  gridWidth: number,
  gridHeight: number,
  population: number,
  probabilityOverride?: number,
): RandomDisasterResult | null {
  const chance = probabilityOverride ?? RANDOM_DISASTER.CHANCE_PER_TICK;
  if (Math.random() > chance) return null;
  if (population < RANDOM_DISASTER.MIN_POPULATION) return null;

  const types = RANDOM_DISASTER.ELIGIBLE_TYPES;
  const type = types[Math.floor(Math.random() * types.length)]!;
  const x = Math.floor(Math.random() * gridWidth);
  const y = Math.floor(Math.random() * gridHeight);
  const intensity = RANDOM_DISASTER.MIN_INTENSITY + Math.random() * (RANDOM_DISASTER.MAX_INTENSITY - RANDOM_DISASTER.MIN_INTENSITY);

  const disaster = createDisaster(type, x, y, intensity);

  // Compute cells that would be damaged above threshold
  const damagedCells: { x: number; y: number }[] = [];
  for (let dy = -disaster.radius; dy <= disaster.radius; dy++) {
    for (let dx = -disaster.radius; dx <= disaster.radius; dx++) {
      const bx = x + dx;
      const by = y + dy;
      if (bx < 0 || bx >= gridWidth || by < 0 || by >= gridHeight) continue;
      const damage = calculateDamage(disaster, bx, by);
      if (damage > RANDOM_DISASTER.DAMAGE_DESTROY_THRESHOLD) {
        damagedCells.push({ x: bx, y: by });
      }
    }
  }

  return { disaster, damagedCells };
}
