import { type Disaster, calculateDamage } from './Disaster';

export interface DamageState {
  buildingId: number;
  damageLevel: number; // 0-1
  repairCost: number;
  destroyed: boolean;
}

export interface BuildingPosition {
  id: number;
  x: number;
  y: number;
}

/** Damage system configuration constants */
export const DAMAGE = {
  /** Base repair cost per unit of damage */
  BASE_REPAIR_COST: 2000,
  /** Damage level at which building is considered destroyed */
  DESTRUCTION_THRESHOLD: 0.9,
  /** Minimum damage level for road destruction */
  ROAD_DAMAGE_THRESHOLD: 0.3,
} as const;

export function applyDamage(
  buildings: BuildingPosition[],
  disaster: Disaster,
): DamageState[] {
  return buildings.map((building) => {
    const damageLevel = calculateDamage(disaster, building.x, building.y);
    const repairCost = Math.round(damageLevel * DAMAGE.BASE_REPAIR_COST);
    const destroyed = damageLevel >= DAMAGE.DESTRUCTION_THRESHOLD;

    return {
      buildingId: building.id,
      damageLevel,
      repairCost,
      destroyed,
    };
  });
}

export function repairBuilding(
  damageState: DamageState,
  funds: number,
): { repaired: boolean; cost: number } {
  if (funds < damageState.repairCost) {
    return { repaired: false, cost: 0 };
  }
  return { repaired: true, cost: damageState.repairCost };
}

export function isRoadDamaged(
  x: number,
  y: number,
  disaster: Disaster,
): boolean {
  const damage = calculateDamage(disaster, x, y);
  return damage > DAMAGE.ROAD_DAMAGE_THRESHOLD;
}
