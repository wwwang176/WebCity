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

export function calculateDamage(
  disaster: Disaster,
  buildingX: number,
  buildingY: number,
): number {
  const dx = buildingX - disaster.epicenterX;
  const dy = buildingY - disaster.epicenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  switch (disaster.type) {
    case DisasterType.EARTHQUAKE: {
      if (distance >= disaster.radius) return 0;
      return Math.max(0, disaster.intensity * (1 - distance / disaster.radius));
    }

    case DisasterType.TORNADO: {
      // Tornado affects a path 3 cells wide from epicenter outward
      // Using distance from epicenter line; path width = 3
      const pathHalfWidth = 1.5;
      if (distance >= disaster.radius) return 0;
      // Simple model: damage based on proximity to center line and distance along path
      const perpendicularDist = Math.abs(dy) < pathHalfWidth ? Math.abs(dy) : pathHalfWidth + 1;
      if (perpendicularDist > pathHalfWidth) return 0;
      const widthFactor = 1 - perpendicularDist / pathHalfWidth;
      const distanceFactor = 1 - distance / disaster.radius;
      return Math.max(0, disaster.intensity * widthFactor * distanceFactor);
    }

    case DisasterType.TSUNAMI: {
      // Affects coastal/low elevation areas; damage decreases with distance
      if (distance >= disaster.radius) return 0;
      return Math.max(0, disaster.intensity * (1 - distance / disaster.radius) * 0.8);
    }

    case DisasterType.FOREST_FIRE: {
      // Spreads to adjacent forest cells; damage decreases with distance
      if (distance >= disaster.radius) return 0;
      return Math.max(0, disaster.intensity * (1 - distance / disaster.radius) * 0.7);
    }

    case DisasterType.METEOR: {
      // High damage at impact, moderate within radius
      if (distance >= disaster.radius) return 0;
      if (distance <= 1) {
        // Direct impact zone
        return disaster.intensity;
      }
      // Moderate falloff within radius
      return Math.max(0, disaster.intensity * 0.6 * (1 - distance / disaster.radius));
    }

    default:
      return 0;
  }
}
