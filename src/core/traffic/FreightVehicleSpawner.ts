/**
 * FreightVehicleSpawner — handles freight truck spawning logic
 * with A-limit (per-building) and B-limit (global cap) constraints.
 *
 * Extracted from SimulationLoop.spawnFreightTraffic for SRP — freight
 * vehicle spawning is traffic domain logic, not simulation orchestration.
 */

import { ZoneType, isCommercialZone } from '../grid/types';
import { toPosKey, findNearRoad } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { FreightRouteType } from './FreightSystem';
import { randomInt } from '../utils/random';
import type { LaneEdge } from './LaneGraph';

export interface FreightSpawnContext {
  grid: {
    getCell(x: number, y: number): { roadType: number; zoneType: number } | null;
    width: number;
    height: number;
  };
  /** Total cargo produced by industrial buildings this cycle. */
  production: number;
  /** Total cargo imported this cycle. */
  imported: number;
  /** Total cargo exported this cycle. */
  exported: number;
  /** Maximum concurrent freight vehicles allowed. */
  freightCap: number;
  /** Active zone buildings (excludes ABANDONED/BURNED). */
  buildingPositions: readonly { x: number; y: number; pos: string; buildingId: number }[];
  /** Pre-computed zone type for each building position key. */
  buildingZoneTypes: Map<string, ZoneType>;
  /** Trade infrastructure positions (rail stations, airports, highway edges). */
  cachedTradePositions: readonly { x: number; y: number; throughput: number; tradeKey: string }[];
  /** Reusable map tracking active freight per source key. Mutated in place. */
  activeFreight: Map<string, number>;
  /** Find a lane path between two road cells. Returns null if no path. */
  findPath: (fromRoad: { x: number; y: number }, toRoad: { x: number; y: number }) => LaneEdge[] | null;
  /** Spawn a freight vehicle on the given edge path. */
  addFreightVehicle: (edgePath: LaneEdge[], sourceKey: string) => void;
  /** Throughput units per concurrent freight truck at a trade node. */
  freightTrucksPerThroughput: number;
}

export interface FreightSpawnResult {
  /** Number of freight vehicles spawned this tick. */
  spawned: number;
}

/**
 * Rebuild activeFreight map from live vehicles.
 * @returns total freight vehicles currently on road.
 */
export function rebuildActiveFreight(
  vehicles: readonly { sourceBuildingKey?: string; arrived: boolean }[],
  activeFreight: Map<string, number>,
): number {
  activeFreight.clear();
  let count = 0;
  for (const v of vehicles) {
    if (v.sourceBuildingKey && !v.arrived) {
      activeFreight.set(v.sourceBuildingKey, (activeFreight.get(v.sourceBuildingKey) ?? 0) + 1);
      count++;
    }
  }
  return count;
}

/**
 * Collect available industrial and commercial buildings for freight routing.
 * Industrials with >= 1 truck are excluded (A-limit).
 */
export function collectAvailableSources(
  buildingPositions: readonly { x: number; y: number; pos: string; buildingId: number }[],
  buildingZoneTypes: Map<string, ZoneType>,
  activeFreight: Map<string, number>,
): {
  industrials: { x: number; y: number; key: string }[];
  commercials: { x: number; y: number }[];
} {
  const industrials: { x: number; y: number; key: string }[] = [];
  const commercials: { x: number; y: number }[] = [];

  for (const bp of buildingPositions) {
    const zt = buildingZoneTypes.get(bp.pos);
    if (zt === undefined) continue;
    if (zt === ZoneType.INDUSTRIAL) {
      if ((activeFreight.get(bp.pos) ?? 0) < 1) {
        industrials.push({ x: bp.x, y: bp.y, key: bp.pos });
      }
    } else if (isCommercialZone(zt)) {
      commercials.push(bp);
    }
  }

  return { industrials, commercials };
}

/**
 * Select a freight route type via weighted random based on economic volumes.
 * @returns selected route type, or null if nothing is available.
 */
export function selectFreightRoute(
  availability: { hasLocal: boolean; hasExport: boolean; hasImport: boolean },
  volumes: { localVolume: number; exported: number; imported: number },
): FreightRouteType | null {
  const options: { type: FreightRouteType; weight: number }[] = [];
  if (availability.hasLocal) options.push({ type: FreightRouteType.LOCAL, weight: volumes.localVolume });
  if (availability.hasExport) options.push({ type: FreightRouteType.EXPORT, weight: volumes.exported });
  if (availability.hasImport) options.push({ type: FreightRouteType.IMPORT, weight: volumes.imported });

  const totalWeight = options.reduce((s, o) => s + o.weight, 0);
  if (totalWeight === 0 || options.length === 0) return null;

  let roll = Math.random() * totalWeight;
  for (const o of options) {
    roll -= o.weight;
    if (roll <= 0) return o.type;
  }
  return options[options.length - 1]!.type;
}

/**
 * Spawn freight vehicles for the current tick.
 *
 * Three trade route types:
 * 1. LOCAL: industrial -> commercial
 * 2. EXPORT: industrial -> trade node (station/airport/highway)
 * 3. IMPORT: trade node -> commercial
 *
 * A-limit: each industrial has at most 1 truck; each trade node has at most N trucks.
 * B-limit: total freight trucks <= freightCap.
 */
export function spawnFreightVehicles(ctx: FreightSpawnContext): FreightSpawnResult {
  const {
    grid, production, imported, exported, freightCap,
    buildingPositions, buildingZoneTypes, cachedTradePositions,
    activeFreight, findPath, addFreightVehicle, freightTrucksPerThroughput,
  } = ctx;

  if (production === 0 && imported === 0) return { spawned: 0 };
  if (freightCap <= 0) return { spawned: 0 };
  if (buildingPositions.length === 0) return { spawned: 0 };

  // Rebuild activeFreight is done by the caller (rebuildActiveFreight)
  let freightOnRoad = 0;
  for (const v of activeFreight.values()) freightOnRoad += v;
  if (freightOnRoad >= freightCap) return { spawned: 0 };

  // A-limit: collect available sources
  const { industrials: availableIndustrials, commercials } =
    collectAvailableSources(buildingPositions, buildingZoneTypes, activeFreight);

  // A-limit: collect available trade road cells
  const availableTrade: { x: number; y: number; key: string }[] = [];
  for (const tp of cachedTradePositions) {
    const maxTrucks = Math.ceil(tp.throughput / freightTrucksPerThroughput);
    if ((activeFreight.get(tp.tradeKey) ?? 0) < maxTrucks) {
      availableTrade.push({ x: tp.x, y: tp.y, key: tp.tradeKey });
    }
  }

  // Route weights from economic data
  const localVolume = Math.max(0, production - exported);
  const hasLocal = availableIndustrials.length > 0 && commercials.length > 0 && localVolume > 0;
  const hasExport = availableIndustrials.length > 0 && availableTrade.length > 0 && exported > 0;
  const hasImport = availableTrade.length > 0 && commercials.length > 0 && imported > 0;

  if (!hasLocal && !hasExport && !hasImport) return { spawned: 0 };

  const maxPerTick = Math.min(5, freightCap - freightOnRoad);
  let spawned = 0;

  for (let i = 0; i < maxPerTick; i++) {
    if (freightOnRoad >= freightCap) break;

    const routeType = selectFreightRoute(
      { hasLocal, hasExport, hasImport },
      { localVolume, exported, imported },
    );
    if (!routeType) break;

    let from: { x: number; y: number; key: string };
    let to: { x: number; y: number };

    switch (routeType) {
      case FreightRouteType.LOCAL:
        if (availableIndustrials.length === 0 || commercials.length === 0) continue;
        from = availableIndustrials[randomInt(availableIndustrials.length)]!;
        to = commercials[randomInt(commercials.length)]!;
        break;
      case FreightRouteType.EXPORT:
        if (availableIndustrials.length === 0 || availableTrade.length === 0) continue;
        from = availableIndustrials[randomInt(availableIndustrials.length)]!;
        to = availableTrade[randomInt(availableTrade.length)]!;
        break;
      case FreightRouteType.IMPORT:
        if (availableTrade.length === 0 || commercials.length === 0) continue;
        from = availableTrade[randomInt(availableTrade.length)]!;
        to = commercials[randomInt(commercials.length)]!;
        break;
    }

    const fromRoad = findNearRoad(grid, from.x, from.y, ZONE_ROAD_REACH);
    const toRoad = findNearRoad(grid, to.x, to.y, ZONE_ROAD_REACH);
    if (!fromRoad || !toRoad || (fromRoad.x === toRoad.x && fromRoad.y === toRoad.y)) continue;

    const edgePath = findPath(fromRoad, toRoad);
    if (!edgePath || edgePath.length === 0) continue;

    addFreightVehicle(edgePath, from.key);
    freightOnRoad++;
    spawned++;

    // Update activeFreight for A-limit within this tick
    const newCount = (activeFreight.get(from.key) ?? 0) + 1;
    activeFreight.set(from.key, newCount);

    if (routeType === FreightRouteType.IMPORT) {
      // Remove trade node from available list if it reached its limit
      const tp = cachedTradePositions.find(t => t.tradeKey === from.key);
      const maxTrucks = tp ? Math.ceil(tp.throughput / freightTrucksPerThroughput) : 1;
      if (newCount >= maxTrucks) {
        for (let j = availableTrade.length - 1; j >= 0; j--) {
          if (availableTrade[j]!.key === from.key) availableTrade.splice(j, 1);
        }
      }
    } else {
      // Industrial: max 1, remove from available list
      const idx = availableIndustrials.indexOf(from);
      if (idx >= 0) availableIndustrials.splice(idx, 1);
    }
  }

  return { spawned };
}
