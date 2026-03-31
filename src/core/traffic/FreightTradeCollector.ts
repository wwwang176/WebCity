/**
 * FreightTradeCollector — collects trade infrastructure positions
 * (rail stations, airports, highway edges) and their adjacent road cells
 * for freight vehicle spawning.
 *
 * Extracted from SimulationLoop Slot 5 for SRP — trade position collection
 * is freight domain logic, not simulation orchestration.
 */

import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

export interface TradePosition {
  x: number;
  y: number;
  throughput: number;
  tradeKey: string;
}

interface TradeGridLookup {
  getCell(x: number, y: number): { roadType: number; buildingId: number } | null;
}

/** Infrastructure config lookup — returns width/height for multi-cell buildings. */
type InfraConfigLookup = (buildingId: number) => { width: number; height: number } | null;

export interface TradeInfrastructure {
  railStations: ReadonlyArray<{ x: number; y: number; throughput: number }>;
  airports: ReadonlyArray<{ x: number; y: number; cargoPerTick: number }>;
  highwayCells: ReadonlyArray<{ x: number; y: number; throughput: number }>;
}

export interface TradeCollectionResult {
  positions: TradePosition[];
  totalThroughput: number;
}

/**
 * Collect all trade positions from rail, airport, and highway infrastructure.
 * Returns the positions array and total throughput for freight calculation.
 */
export function collectTradePositions(
  grid: TradeGridLookup,
  infra: TradeInfrastructure,
  infraConfigLookup: InfraConfigLookup | null,
): TradeCollectionResult {
  const positions: TradePosition[] = [];
  let railThroughput = 0;
  let airportThroughput = 0;
  let highwayThroughput = 0;

  for (const station of infra.railStations) {
    railThroughput += station.throughput;
    collectAdjacentRoadCells(grid, station.x, station.y, station.throughput, positions, infraConfigLookup);
  }

  for (const ap of infra.airports) {
    airportThroughput += ap.cargoPerTick;
    collectAdjacentRoadCells(grid, ap.x, ap.y, ap.cargoPerTick, positions, infraConfigLookup);
  }

  for (const cell of infra.highwayCells) {
    highwayThroughput += cell.throughput;
    positions.push({ x: cell.x, y: cell.y, throughput: cell.throughput, tradeKey: toPosKey(cell.x, cell.y) });
  }

  return {
    positions,
    totalThroughput: railThroughput + airportThroughput + highwayThroughput,
  };
}

/**
 * Collect all road cells adjacent to a building (possibly multi-cell).
 * Each road cell shares the same tradeKey so freight A-limit treats them as one node.
 */
export function collectAdjacentRoadCells(
  grid: TradeGridLookup,
  bx: number, by: number,
  throughput: number,
  out: TradePosition[],
  infraConfigLookup: InfraConfigLookup | null,
): void {
  const tradeKey = toPosKey(bx, by);
  const cell = grid.getCell(bx, by);
  const cfg = cell && infraConfigLookup ? infraConfigLookup(cell.buildingId) : null;
  const w = cfg?.width ?? 1;
  const h = cfg?.height ?? 1;
  const found = new Set<string>();

  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      for (const [nx, ny] of FOUR_NEIGHBORS) {
        const rx = bx + dx + nx!;
        const ry = by + dy + ny!;
        const rKey = toPosKey(rx, ry);
        if (found.has(rKey)) continue;
        const rc = grid.getCell(rx, ry);
        if (rc && rc.roadType !== RoadType.NONE) {
          found.add(rKey);
          out.push({ x: rx, y: ry, throughput, tradeKey });
        }
      }
    }
  }

  if (found.size === 0) {
    out.push({ x: bx, y: by, throughput, tradeKey });
  }
}
