import type { GameState } from '../simulation/GameState';
import { TRADE } from '../traffic/FreightSystem';
import { ZoneType } from '../grid/types';

/**
 * Freight supply chain — every number on the Freight page of Overview.
 *
 * ## One source, two readers
 *
 * The panel and the agent API both call this. Computing it inside the panel and copying it
 * to the API side leaves two figures that drift apart (BUG-342).
 *
 * ## Effective supply is not production
 *
 * What shops can actually get is **production - exported + imported**. Reading `production`
 * alone makes a city sustained by imports look out of stock.
 */

export interface AirportStat {
  size: string;
  /** This airport's actual throughput. 0 without power or water. */
  cargo: number;
  operational: boolean;
}

export interface FreightStats {
  /** Output of local factories. */
  production: number;
  /** What shops demand. */
  consumption: number;
  shortage: number;
  imported: number;
  exported: number;
  /** `production - exported + imported`: what shops can actually get. */
  effectiveProduction: number;
  /** `effectiveProduction / consumption`. 1 when nothing is being consumed. */
  supplyRatio: number;

  /** Shops with goods to sell. */
  suppliedCount: number;
  /** Of those, the ones fed by local goods. */
  localCount: number;
  /** Of those, the ones fed by imports. */
  importedCount: number;
  /** Shops with nothing to sell. Income x0.5, and abandonment pressure accumulates. */
  unsuppliedCount: number;
  /** Total commercial buildings standing. Zoned land with nothing built does not count. */
  totalCommercial: number;

  /** Stations that reach the map edge. */
  externalStations: number;
  totalStations: number;
  hasRailConnection: boolean;
  railThroughput: number;

  highwayConnections: number;
  hasHighwayConnection: boolean;
  highwayThroughput: number;

  airports: AirportStat[];
  airportThroughput: number;

  /** Combined capacity of all three channels. */
  totalThroughput: number;

  /** The surplus ratio, and whether the city is currently exporting. */
  surplusRatio: number;
  isExporting: boolean;

  /** The coefficients behind the panel's "Income Impact" section. */
  importIncomeMultiplier: number;
  exportIncomeMultiplier: number;
}

export function buildFreightStats(state: GameState): FreightStats {
  const freight = state.freight;
  const demand = freight.getLastDemand();
  const trade = freight.getLastTrade();

  const effectiveProduction = demand.production - trade.exported + trade.imported;
  // An empty city is not short of goods. Dividing by zero gives NaN, which the panel prints
  // as "NaN%".
  const supplyRatio = demand.consumption > 0 ? effectiveProduction / demand.consumption : 1;

  const suppliedCount = freight.getSuppliedCount();

  // Zoned commercial land with nothing built on it is not a shop; counting it drags the
  // supply ratio down for no visible reason.
  let totalCommercial = 0;
  state.grid.forEachCell((cell) => {
    if (cell.buildingId > 0
      && (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH)) {
      totalCommercial++;
    }
  });

  const rail = state.rail;
  // The edge-reachable station count is already 0 or positive: `hasExternalConnection` and
  // this count are set in the same `updateExternalConnection()` pass, so no reachable state
  // separates a `hasExternalConnection ?` guard from this line. The flag is still returned to
  // callers because the panel's "(no edge connection)" line reads it.
  //
  // The reverse direction does diverge: `RailSystem.fromJSON` restores the flag but not the
  // station set, so right after a save is loaded and before `updateExternalConnection()` runs,
  // this reads 0.
  const externalStations = rail.getExternalStationCount();
  const railThroughput = externalStations * TRADE.RAIL_THROUGHPUT_PER_STATION;

  const airports: AirportStat[] = [];
  let airportThroughput = 0;
  for (const ap of state.airport.getAirports()) {
    // An airport without power or water is still listed (the player has to see it is down)
    // but contributes no throughput.
    const operational = state.airport.isAirportOperational(ap.id);
    const cargo = operational ? ap.cargoPerTick : 0;
    airportThroughput += cargo;
    airports.push({ size: String(ap.size), cargo, operational });
  }

  const hc = state.highwayConnection;
  const highwayThroughput = hc.hasExternalConnection ? hc.getThroughput() : 0;

  return {
    production: demand.production,
    consumption: demand.consumption,
    shortage: demand.shortage,
    imported: trade.imported,
    exported: trade.exported,
    effectiveProduction,
    supplyRatio,

    suppliedCount,
    localCount: freight.getLocalSuppliedCount(),
    importedCount: freight.getImportedCount(),
    unsuppliedCount: totalCommercial - suppliedCount,
    totalCommercial,

    externalStations,
    totalStations: rail.getStations().length,
    hasRailConnection: rail.hasExternalConnection,
    railThroughput,

    highwayConnections: hc.getEdgeHighwayCellCount(),
    hasHighwayConnection: hc.hasExternalConnection,
    highwayThroughput,

    airports,
    airportThroughput,

    totalThroughput: railThroughput + airportThroughput + highwayThroughput,

    surplusRatio: freight.getSurplusRatio(),
    isExporting: freight.getIsExporting(),

    importIncomeMultiplier: TRADE.IMPORT_INCOME_MULTIPLIER,
    exportIncomeMultiplier: TRADE.EXPORT_INCOME_MULTIPLIER,
  };
}
