import { euclideanDistance } from '../grid/GridHelpers';

export interface WarningTower {
  x: number;
  y: number;
  radius: number;
}

export interface WarningSystem {
  towers: WarningTower[];
}

export function createWarningSystem(): WarningSystem {
  return { towers: [] };
}

export function addWarningTower(
  system: WarningSystem,
  x: number,
  y: number,
  radius: number,
): void {
  system.towers.push({ x, y, radius });
}

export function isWarned(system: WarningSystem, x: number, y: number): boolean {
  return system.towers.some((tower) => euclideanDistance(x, y, tower.x, tower.y) <= tower.radius);
}

export function calculateEvacuationTarget(
  citizenX: number,
  citizenY: number,
  shelters: { x: number; y: number }[],
): { x: number; y: number } | null {
  if (shelters.length === 0) return null;

  let nearest: { x: number; y: number } | null = null;
  let minDist = Infinity;

  for (const shelter of shelters) {
    const dist = euclideanDistance(citizenX, citizenY, shelter.x, shelter.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = shelter;
    }
  }

  return nearest;
}

export const WARNING = {
  /** Warning coverage reduces casualty by this factor */
  CASUALTY_REDUCTION: 0.5,
} as const;
