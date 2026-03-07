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
  return system.towers.some((tower) => {
    const dx = x - tower.x;
    const dy = y - tower.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= tower.radius;
  });
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
    const dx = citizenX - shelter.x;
    const dy = citizenY - shelter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
      nearest = shelter;
    }
  }

  return nearest;
}

/** Warning coverage reduces casualty by this factor */
export const WARNING_CASUALTY_REDUCTION = 0.5;
