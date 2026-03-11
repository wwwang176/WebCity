import type { Citizen } from './types';

export interface BuildingSlot {
  pos: string;
  capacity: number;
}

/**
 * Count how many citizens are currently assigned to each building position.
 * Generic over the assignment field (homeId or workplaceId) via accessor.
 * Extracted from SimulationLoop for SRP — occupancy counting is independent of simulation.
 */
export function countOccupancy(
  citizens: readonly Citizen[],
  getAssignment: (c: Citizen) => string | null,
): Map<string, number> {
  const occupancy = new Map<string, number>();
  for (const c of citizens) {
    const pos = getAssignment(c);
    if (pos !== null) {
      occupancy.set(pos, (occupancy.get(pos) ?? 0) + 1);
    }
  }
  return occupancy;
}

/**
 * Assign unassigned citizens to buildings that have remaining capacity.
 * Generic over the assignment field via getter/setter callbacks.
 * Mutates citizens and the occupancy map in-place.
 * Extracted from SimulationLoop for SRP — assignment logic is independent of simulation.
 */
export function assignToBuildings(
  citizens: readonly Citizen[],
  buildings: readonly BuildingSlot[],
  occupancy: Map<string, number>,
  getAssignment: (c: Citizen) => string | null,
  setAssignment: (c: Citizen, pos: string) => void,
): void {
  for (const citizen of citizens) {
    if (getAssignment(citizen) !== null) continue;
    for (const b of buildings) {
      const occ = occupancy.get(b.pos) ?? 0;
      if (occ < b.capacity) {
        setAssignment(citizen, b.pos);
        occupancy.set(b.pos, occ + 1);
        break;
      }
    }
  }
}
