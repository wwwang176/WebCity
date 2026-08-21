import type { GameState } from '../core/simulation/GameState';
import { getBuildingType } from '../core/building/types';
import { ZoneType } from '../core/grid/types';
import { calculateBalance } from '../core/economy/Budget';
import { getCivicServices, getTotalServiceMaintenanceCost } from '../core/service/ServiceRegistry';
import { getTransitSystems } from '../core/transport/TransportRegistry';
import { buildTransitRows, type TransitSystemRow } from '../ui/modals/overview/transitRows';
import type { EconomyBreakdownResult } from '../core/economy/EconomyBreakdown';
import type { TrafficStatsResult } from '../core/traffic/TrafficStats';
import type { CommuteStats } from '../core/citizen/CommuteStats';
import type { TransferStats } from '../core/transport/TransferStatsQuery';

/**
 * 讀城市。
 *
 * ## 這一層吐事實，不吐面板的彙總
 *
 * Overview 那八頁把數字算在各自的 `createMemo` 裡（共兩千多行 TSX）。把它們抄一份
 * 過來就是這個 repo 一再警告的那個錯 —— 同一個數字兩個地方各記一份，然後靜靜地分家
 * （BUG-342 就是這樣來的）。
 *
 * 所以規則是:
 *
 * - **已經抽成純模組的直接重用** —— 大眾運輸走 `transitRows.ts`，那是面板自己也在用的
 *   同一支函式。
 * - **其餘吐原始事實**，彙總留給呼叫端。面板要把一百棟房子縮成一行是因為人只看得下
 *   一行;程式自己會加總。
 * - **`Game` 已經算好的直接轉手** —— 帳本明細、通勤、交通、轉乘、收費分區、遺棄壓力
 *   都是面板正在讀的那一份，原封不動交出去（見 `StatsHost`）。
 */

/**
 * `Game` 上那幾支「面板正在讀」的統計。
 *
 * 用結構型別而不是 `Game` 本身，是為了能在沒有 Three.js 的情況下測 —— `Game.ts`
 * 直接 import Three.js，單元測試載不動它。
 *
 * **回傳值原封不動往外送**，不重算也不複製。同一個數字兩個地方各記一份就會分家，
 * 這個 repo 已經因為那件事開過單（BUG-342）。
 */
export interface StatsHost {
  getEconomyBreakdown(): EconomyBreakdownResult;
  getBillableDistricts(): readonly BillableDistrict[];
  getCommuteStats(): CommuteStats;
  getTrafficStats(): TrafficStatsResult;
  getTransferStats(): TransferStats;
  getAbandonmentStress(x: number, y: number): number;
}

/** 一個收費分區的道路量與付費駕駛數。 */
export interface BillableDistrict {
  id: string;
  roadCells: number;
  chargedDrivers: number;
}

export interface CityInfo {
  season: string;
  week: number;
  day: number;
  hourOfDay: number;
  funds: number;
  /** 每 tick 的淨收支。 */
  balance: number;
  population: number;
  employed: number;
  happiness: number;
  rci: { residential: number; commercial: number; industrial: number };
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
}

export interface BuildingInfo {
  x: number;
  y: number;
  buildingId: number;
  name: string;
  zone: string;
  level: number;
  /** 這一格容納得下幾個人（住宅是住戶，其餘是工作機會）。 */
  capacity: number;
  residents: number;
  workers: number;
  landValue: number;
  pollution: number;
  /** 已經被遺棄或燒毀。 */
  derelict: boolean;
}

export interface CitizenInfo {
  id: number;
  age: number;
  education: string;
  happiness: number;
  homeId: string | null;
  workplaceId: string | null;
}

export interface ServiceInfo {
  key: string;
  maintenance: number;
}

export interface BuildingQuery {
  /** 只要這幾種分區。省略就全部。 */
  zone?: readonly string[];
  /** 只要這個範圍內的。 */
  rect?: { x1: number; y1: number; x2: number; y2: number };
  /** 最多回幾筆。預設 500 —— 一整座城市可能上千棟，整包丟出來讀不完。 */
  limit?: number;
  /** 只要被遺棄或燒毀的。 */
  derelictOnly?: boolean;
}

export interface CitizenQuery {
  limit?: number;
  /** 只要住在這個建築的。鍵是 `"x,y"`。 */
  homeId?: string;
  /** 只要在這個建築上班的。 */
  workplaceId?: string;
  /** 只要沒有工作的。 */
  unemployedOnly?: boolean;
}

const ZONE_NAMES: Record<number, string> = {
  [ZoneType.NONE]: 'none',
  [ZoneType.RESIDENTIAL_LOW]: 'residential_low',
  [ZoneType.RESIDENTIAL_HIGH]: 'residential_high',
  [ZoneType.COMMERCIAL_LOW]: 'commercial_low',
  [ZoneType.COMMERCIAL_HIGH]: 'commercial_high',
  [ZoneType.INDUSTRIAL]: 'industrial',
  [ZoneType.OFFICE]: 'office',
};

const DEFAULT_BUILDING_LIMIT = 500;
const DEFAULT_CITIZEN_LIMIT = 200;

/**
 * `reserved` 欄位裡代表「這棟樓沒在運作」的值。
 *
 * 兩個都畫成深灰、都不發光、都會被建商清掉,對讀的人來說是同一件事。
 */
const DERELICT_RESERVED: readonly number[] = [1 /* ABANDONED */, 2 /* BURNED */];

export class AgentRead {
  constructor(
    private readonly getState: () => GameState,
    private readonly stats: StatsHost,
  ) {}

  city(): CityInfo {
    const s = this.getState();
    const clock = s.clock;
    return {
      season: String(clock.getSeason()),
      week: clock.getWeek() + 1,
      day: clock.getDay(),
      hourOfDay: clock.getHourOfDay(),
      funds: Math.floor(s.budget.funds),
      balance: Math.round(calculateBalance(s.budget)),
      population: s.citizens.getPopulation(),
      employed: s.citizens.getEmployedCount(),
      happiness: Math.round(s.citizens.getAverageHappiness()),
      rci: {
        residential: s.rciDemand?.residential ?? 0,
        commercial: s.rciDemand?.commercial ?? 0,
        industrial: s.rciDemand?.industrial ?? 0,
      },
      power: { supply: s.power.getSupply(), demand: Math.round(s.power.getDemand()) },
      water: { supply: s.water.getSupply(), demand: Math.round(s.water.getDemand()) },
    };
  }

  buildings(query: BuildingQuery = {}): BuildingInfo[] {
    const s = this.getState();
    const grid = s.grid;
    const limit = query.limit ?? DEFAULT_BUILDING_LIMIT;
    const wanted = query.zone ? new Set(query.zone) : null;
    const r = query.rect;
    const out: BuildingInfo[] = [];

    const x1 = r ? Math.min(r.x1, r.x2) : 0;
    const x2 = r ? Math.max(r.x1, r.x2) : grid.width - 1;
    const y1 = r ? Math.min(r.y1, r.y2) : 0;
    const y2 = r ? Math.max(r.y1, r.y2) : grid.height - 1;

    for (let y = Math.max(0, y1); y <= Math.min(grid.height - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(grid.width - 1, x2); x++) {
        if (out.length >= limit) return out;
        const cell = grid.getCell(x, y);
        if (!cell || cell.buildingId <= 0) continue;

        const derelict = DERELICT_RESERVED.includes(cell.reserved);
        if (query.derelictOnly && !derelict) continue;

        const zone = ZONE_NAMES[cell.zoneType] ?? 'none';
        if (wanted && !wanted.has(zone)) continue;

        const bt = getBuildingType(cell.buildingId);
        const key = `${x},${y}`;
        out.push({
          x, y,
          buildingId: cell.buildingId,
          name: bt?.name ?? `#${cell.buildingId}`,
          zone,
          level: bt?.level ?? 0,
          capacity: (bt?.residents ?? 0) + (bt?.workers ?? 0),
          residents: s.citizens.getCitizensByHome(key).length,
          workers: s.citizens.getCitizensByWorkplace(key).length,
          landValue: cell.landValue,
          pollution: cell.pollution,
          derelict,
        });
      }
    }
    return out;
  }

  citizens(query: CitizenQuery = {}): CitizenInfo[] {
    const s = this.getState();
    const limit = query.limit ?? DEFAULT_CITIZEN_LIMIT;

    let pool: readonly { id: number; age: number; education: unknown; happiness: number; homeId?: string | null; workplaceId?: string | null }[];
    if (query.homeId) pool = s.citizens.getCitizensByHome(query.homeId);
    else if (query.workplaceId) pool = s.citizens.getCitizensByWorkplace(query.workplaceId);
    else pool = s.citizens.getCitizens();

    const out: CitizenInfo[] = [];
    for (const c of pool) {
      if (out.length >= limit) break;
      if (query.unemployedOnly && c.workplaceId) continue;
      out.push({
        id: c.id,
        age: c.age,
        education: String(c.education),
        happiness: Math.round(c.happiness),
        homeId: c.homeId ?? null,
        workplaceId: c.workplaceId ?? null,
      });
    }
    return out;
  }

  services(): { total: number; items: ServiceInfo[] } {
    const s = this.getState();
    const keys = ['power', 'water', 'police', 'fire', 'health',
      'education', 'parks', 'garbage', 'sewage', 'deathCare'];
    const svcs = getCivicServices(s);
    return {
      total: Math.round(getTotalServiceMaintenanceCost(s)),
      items: svcs.map((svc, i) => ({
        key: keys[i] ?? `#${i}`,
        maintenance: Math.round(svc.getMaintenanceCost()),
      })),
    };
  }

  /** 大眾運輸。跟 Overview 的 Traffic 頁走同一支 `buildTransitRows()`。 */
  transit(): TransitSystemRow[] {
    const s = this.getState();
    return buildTransitRows(
      getTransitSystems(s).map(({ type, system }) => ({
        type,
        routes: system.getRoutes(),
        stops: system.getStops(),
        seatsPerVehicle: system.getCapacity(),
        speed: system.getSpeed(),
        vehicleCount: system.getVehicles().length,
        operatingCost: system.getOperatingCost(),
        segmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
      })),
    );
  }

  // ── Game 已經算好的 ──────────────────────────────────────────────
  //
  // 這一段全是轉手。**沒有加工的餘地** —— 面板讀的就是這幾支，中間多一層轉換就是
  // 多一份會分家的副本。
  //
  // 有兩個欄位是 `Map` / `Set`（`commuteStats().byHome`、分區的 `cells`），
  // `JSON.stringify` 會把它們變成 `{}`。要跨進程送的話呼叫端自己 `[...map]`。

  /** 帳本明細。收入支出逐項，跟 Economy 面板同一份。 */
  economyBreakdown(): EconomyBreakdownResult {
    return this.stats.getEconomyBreakdown();
  }

  /** 收費分區的道路格數與付費駕駛數。 */
  billableDistricts(): readonly BillableDistrict[] {
    return this.stats.getBillableDistricts();
  }

  /** 通勤時間分佈。`byHome` 是 `Map`。 */
  commuteStats(): CommuteStats {
    return this.stats.getCommuteStats();
  }

  /** 車流量、最塞的路段、平均路徑長度。 */
  trafficStats(): TrafficStatsResult {
    return this.stats.getTrafficStats();
  }

  /** 轉乘率與轉乘熱點。 */
  transferStats(): TransferStats {
    return this.stats.getTransferStats();
  }

  /** 某一格的遺棄壓力。滿了就會變成廢墟 —— 用來在出事前先看出來。 */
  abandonmentStress(x: number, y: number): number {
    return this.stats.getAbandonmentStress(x, y);
  }

  /**
   * 一塊範圍內每一格的原始欄位。
   *
   * 這是最貴的讀法 —— 60×60 全開是 3600 筆。用來看一小塊地能不能蓋，不是用來看全城。
   */
  cells(rect: { x1: number; y1: number; x2: number; y2: number }) {
    const grid = this.getState().grid;
    const x1 = Math.max(0, Math.min(rect.x1, rect.x2));
    const x2 = Math.min(grid.width - 1, Math.max(rect.x1, rect.x2));
    const y1 = Math.max(0, Math.min(rect.y1, rect.y2));
    const y2 = Math.min(grid.height - 1, Math.max(rect.y1, rect.y2));
    const out: Array<{ x: number; y: number } & Record<string, number>> = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const cell = grid.getCell(x, y);
        if (cell) out.push({ x, y, ...cell });
      }
    }
    return out;
  }
}
