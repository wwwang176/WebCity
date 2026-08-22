import type { GameState } from '../simulation/GameState';
import { TRADE } from '../traffic/FreightSystem';
import { ZoneType } from '../grid/types';

/**
 * 貨運供應鏈 —— Overview 的 Freight 頁那一整頁數字。
 *
 * ## 一份，兩個讀者
 *
 * 面板跟 agent API 讀的是這同一支。原本這段算在 `FreightPage.tsx` 的 `createMemo`
 * 裡,只有玩家的螢幕看得到;抄一份到 API 那邊，兩份就會分家（BUG-342 就是這樣來的）。
 *
 * ## 有效供給不是產量
 *
 * 商店真正拿得到的貨是**產量 − 出口 + 進口**。只看 `production` 的話,一座靠進口
 * 撐著的城市會被讀成缺貨。
 */

export interface AirportStat {
  size: string;
  /** 這座機場實際的吞吐。沒水沒電時是 0。 */
  cargo: number;
  operational: boolean;
}

export interface FreightStats {
  /** 本地工廠的產量。 */
  production: number;
  /** 商店的需求。 */
  consumption: number;
  shortage: number;
  imported: number;
  exported: number;
  /** `production − exported + imported` —— 商店真正拿得到的量。 */
  effectiveProduction: number;
  /** `effectiveProduction / consumption`。沒人在消費時是 1。 */
  supplyRatio: number;

  /** 有貨可賣的店家數。 */
  suppliedCount: number;
  /** 其中吃本地貨的。 */
  localCount: number;
  /** 其中吃進口貨的。 */
  importedCount: number;
  /** 沒貨可賣的。收入 ×0.5 而且會累積遺棄壓力。 */
  unsuppliedCount: number;
  /** 蓋起來的商業建築總數。劃了地還沒長的不算。 */
  totalCommercial: number;

  /** 接得到地圖邊界的車站數。 */
  externalStations: number;
  totalStations: number;
  hasRailConnection: boolean;
  railThroughput: number;

  highwayConnections: number;
  hasHighwayConnection: boolean;
  highwayThroughput: number;

  airports: AirportStat[];
  airportThroughput: number;

  /** 三種管道加起來的總容量。 */
  totalThroughput: number;

  /** 產能過剩的比例,以及現在是不是在出口。 */
  surplusRatio: number;
  isExporting: boolean;

  /** 面板底下「Income Impact」那一段的係數。 */
  importIncomeMultiplier: number;
  exportIncomeMultiplier: number;
}

export function buildFreightStats(state: GameState): FreightStats {
  const freight = state.freight;
  const demand = freight.getLastDemand();
  const trade = freight.getLastTrade();

  const effectiveProduction = demand.production - trade.exported + trade.imported;
  // 空城不是缺貨。除以零會變成 NaN，而面板會把它印成「NaN%」。
  const supplyRatio = demand.consumption > 0 ? effectiveProduction / demand.consumption : 1;

  const suppliedCount = freight.getSuppliedCount();

  // 劃了商業區還沒長出建築的地不算店家 —— 算進去會莫名其妙地把供貨率拉低。
  let totalCommercial = 0;
  state.grid.forEachCell((cell) => {
    if (cell.buildingId > 0
      && (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH)) {
      totalCommercial++;
    }
  });

  const rail = state.rail;
  // 「接得到邊界的車站數」本身就是 0 或正數 —— `hasExternalConnection` 跟這個計數
  // 是 `updateExternalConnection()` 同一次設的，再加一道 `hasExternalConnection ?`
  // 的防呆沒有任何可達狀態能把它跟這一行分開。旗標照樣回給呼叫端，因為畫面上
  // 「(no edge connection)」那行字是看它。
  //
  // 反方向倒是真的會岔開:`RailSystem.fromJSON` 還原了旗標卻沒有還原車站集合，
  // 所以剛載入存檔、`updateExternalConnection()` 還沒跑之前，這裡會是 0。
  const externalStations = rail.getExternalStationCount();
  const railThroughput = externalStations * TRADE.RAIL_THROUGHPUT_PER_STATION;

  const airports: AirportStat[] = [];
  let airportThroughput = 0;
  for (const ap of state.airport.getAirports()) {
    // 沒水沒電的機場照樣列出來（玩家要看得到它壞了）,但不貢獻吞吐。
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
