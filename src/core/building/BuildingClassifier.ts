import { getBuildingType, type BuildingType } from './types';
import { getInfraConfigById, type InfraConfig } from './InfraConfig';
import { getTransportStopType, type TransportStopKind } from '../ViewMode';

/**
 * Discriminated union for building classification.
 * Replaces nested if-else chains in Game.ts (SRP + OCP).
 */
export type BuildingClassification =
  | { category: 'zone'; buildingType: BuildingType }
  | { category: 'transport'; transportType: TransportStopKind }
  | { category: 'infra'; config: InfraConfig }
  | { category: 'unknown' };

/**
 * Classify a buildingId into its category.
 * Pure function — no side effects, easily testable.
 */
export function classifyBuilding(buildingId: number): BuildingClassification {
  const bt = getBuildingType(buildingId);
  if (bt) return { category: 'zone', buildingType: bt };

  const transportType = getTransportStopType(buildingId);
  if (transportType) return { category: 'transport', transportType };

  const infraCfg = getInfraConfigById(buildingId);
  if (infraCfg) return { category: 'infra', config: infraCfg };

  return { category: 'unknown' };
}
