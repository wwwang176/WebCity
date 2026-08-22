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
import type { ChartHistory } from '../core/economy/ChartSeries';
import type { ElevatedSegment } from '../core/elevation/types';
import type { RoadCellGraph } from '../core/road/RoadCellGraph';
import { roadConnectivity, type ConnectivityResult } from '../core/road/RoadConnectivity';
import { buildSummaryStats, type SummaryStats } from '../core/stats/SummaryStats';
import { buildDemographicsStats, type DemographicsStats } from '../core/stats/DemographicsStats';
import { buildEnvironmentStats, type EnvironmentStats } from '../core/stats/EnvironmentStats';
import { buildFreightStats, type FreightStats } from '../core/stats/FreightStats';
import { buildInfraStats, type InfraStats } from '../core/stats/InfraStats';
import { buildServicesStats, type ServicesStats } from '../core/stats/ServiceStats';
import { ABANDONED, BURNED } from '../core/building/InfraPlacement';
import { citizenName } from '../core/citizen/CitizenName';
import { citizenWorkLabel } from '../core/citizen/CitizenPresentation';
import {
  buildCoverage, buildOverlayCells, overlayKind, COVERAGE_SERVICES,
  type CoverageInfo, type CoverageService, type OverlayCellInfo, type OverlayKind,
} from './overlays';

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
  getSelectedBuilding(): unknown;
  /** 某一張圖層每一格的值。不需要那張圖層開著。 */
  getOverlayData(type: string): ReadonlyMap<string, number> | undefined;
  /** 某個數值在那張圖層上的顏色。 */
  getOverlayColor(type: string, value: number): number;
  /** 走馬路成本圖、那個服務的預算，以及逐格的設施負載與服務設施。 */
  getCoverageCosts(service: string): {
    costs: ReadonlyMap<string, number>;
    budget: number;
    loadAt: (x: number, y: number) => number;
    servingFacilityAt: (x: number, y: number) => string | null;
  } | null;
  /** 造成那些顏色的設施。 */
  getOverlaySourceCells(type: string): { x: number; y: number }[];
  /** 建築高亮的 10 階色帶。 */
  coverageGradient(): readonly number[];
  /**
   * 全城的高架段。
   *
   * **這一份不在 `GameState` 裡** —— `ElevationManager` 是 `Game` 的欄位，所以
   * `read` 只能從這裡拿。少了它，程式確認一座橋存在的唯一辦法是故意重蓋一次、
   * 讀 `Elevation level already occupied` 那句錯誤訊息（BUG-367）。
   */
  elevatedSegments(): Array<{ x: number; y: number; level: number; data: ElevatedSegment }>;
  /**
   * 路網的格子層圖，含高架與匝道。`null` = 路網 lookup 還沒接上。
   *
   * 這是 `SimulationLoop` 以 `commuteCache.roadGeneration` 為鍵快取的那一份 ——
   * 服務覆蓋與通勤可達性走的都是它。**不要在這裡重建**，那是 O(路格數)。
   */
  roadCellGraph(): RoadCellGraph | null;
  /**
   * 逐日的圖表歷史。
   *
   * 這一份**不在 `GameState` 裡** —— 它是 UI 的 store 一天記一筆累積起來的，
   * 不進存檔。所以載入存檔之後是空的，開著遊戲跑才會長出來。
   */
  chartHistory(): ChartHistory;
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

/** 一段高架路段/鐵軌。`level` 1–3，`x`/`y` 是它站的那一格。 */
export interface ElevatedInfo extends ElevatedSegment {
  x: number;
  y: number;
  level: number;
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
  /**
   * 面板上印的名字。
   *
   * 從 id 與城市種子算出來的，不存進存檔 —— 所以**同一個 id 在不同城市叫不同名字**。
   * 要指涉某個人請用 `id`,名字只是給人看的。
   */
  name: string;
  age: number;
  /** BABY / CHILD / TEEN / ADULT / SENIOR。 */
  lifeStage: string;
  education: string;
  happiness: number;
  health: number;
  homeId: string | null;
  workplaceId: string | null;
  /**
   * 面板上「Work」那一列的字。
   *
   * 不是 `workplaceId` 的同義詞 —— 沒工作的人分成 `Unemployed`（工作年齡）、
   * `Retired`（超齡）、`Student` 與 `Too young to work`。把後三種讀成失業，
   * 一座滿員的城市點開住宅會看起來像失業率 100%。
   */
  workLabel: string;
  /** 從哪個 tick 開始沒工作。`null` 代表還沒開始找。 */
  unemployedSince: number | null;
  /** 從哪個 tick 開始沒地方住。 */
  homelessSince: number | null;
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
 *
 * **從 `InfraPlacement` 引用，不要自己寫數字。** 這裡原本寫死 `[1, 2]`，而
 * `BURNED` 其實是 3（2 沒有被使用）—— 於是每一棟燒毀的樓都回報 `derelict: false`，
 * `derelictOnly` 一棟也篩不出來，玩家螢幕上明明看得到九棟焦黑的房子（BUG-360）。
 */
const DERELICT_RESERVED: readonly number[] = [ABANDONED, BURNED];

/** `CitizenManager` 吐出來的原始市民。 */
interface RawCitizen {
  id: number;
  age: number;
  lifeStage: unknown;
  education: unknown;
  happiness: number;
  health: number;
  educationProgress: number;
  homeId: string | null;
  workplaceId: string | null;
  unemployedSince: number | null;
  homelessSince: number | null;
}

/**
 * 一個市民，照面板顯示的樣子。
 *
 * 名字與「Work」那一列都問 core 的那兩支 —— 面板讀的就是它們，這裡自己拼一份的話
 * 會出現「API 說 Unemployed、畫面說 Retired」。
 */
function describeCitizen(c: RawCitizen, citySeed: number): CitizenInfo {
  return {
    id: c.id,
    name: citizenName(c.id, citySeed),
    age: c.age,
    lifeStage: String(c.lifeStage),
    education: String(c.education),
    happiness: Math.round(c.happiness),
    health: Math.round(c.health),
    homeId: c.homeId ?? null,
    workplaceId: c.workplaceId ?? null,
    workLabel: citizenWorkLabel(c),
    unemployedSince: c.unemployedSince ?? null,
    homelessSince: c.homelessSince ?? null,
  };
}

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

    let pool: readonly RawCitizen[];
    if (query.homeId) pool = s.citizens.getCitizensByHome(query.homeId) as readonly RawCitizen[];
    else if (query.workplaceId) pool = s.citizens.getCitizensByWorkplace(query.workplaceId) as readonly RawCitizen[];
    else pool = s.citizens.getCitizens() as readonly RawCitizen[];

    const out: CitizenInfo[] = [];
    for (const c of pool) {
      if (out.length >= limit) break;
      if (query.unemployedOnly && c.workplaceId) continue;
      out.push(describeCitizen(c, s.citySeed));
    }
    return out;
  }

  /**
   * 一個人。跟市民詳細面板顯示的是同一份。
   *
   * 找不到就回 `null` —— 市民會死,而 id 不會被回收。
   */
  citizen(id: number): CitizenInfo | null {
    const s = this.getState();
    const c = s.citizens.getCitizen(id) as RawCitizen | undefined;
    return c ? describeCitizen(c, s.citySeed) : null;
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
   * 現在點開的那一棟，跟詳情面板顯示的是同一份。
   *
   * 選取是**點出來的** —— `act({ tool: 'select', x1, y1 })`。這裡只負責讀。
   * 形狀依建築種類而異（`zone` / `infra` / `transport`⋯），所以不在這裡窄化型別。
   */
  selected(): unknown {
    return this.stats.getSelectedBuilding();
  }

  // ── Overview 那八頁 ─────────────────────────────────────────────
  //
  // 一頁一支，跟畫面上的分頁一一對應。**面板讀的是同一支函式** —— 這一層沒有
  // 自己的算式，所以不會有「API 說 75%、螢幕說 68%」那種分家（BUG-342）。
  //
  // 剩下兩頁已經在上面:Economy 是 `economyBreakdown()`，
  // Traffic 是 `trafficStats()` + `transit()` + `transferStats()`。

  /** 總覽:人口、房子與工作、吸引力，以及**扣分最多的那一項**。 */
  summary(): SummaryStats {
    return buildSummaryStats(this.getState());
  }

  /** 人口組成:年齡與教育分佈，加上教育 × 職業、教育 × 住宅等級兩張交叉表。 */
  demographics(): DemographicsStats {
    return buildDemographicsStats(this.getState());
  }

  /** 環境:地面污染、噪音、水污染、火災與廢墟。 */
  environment(): EnvironmentStats {
    return buildEnvironmentStats(this.getState());
  }

  /**
   * 貨運供應鏈:產量、消費、進出口，以及三種對外管道的吞吐。
   *
   * 商店真正拿得到的貨是 `effectiveProduction`（產量 − 出口 + 進口），
   * 不是 `production`。
   */
  freight(): FreightStats {
    return buildFreightStats(this.getState());
  }

  /** 基礎設施:水電供需、掩埋場、污水處理、墓園的存量與流量。 */
  infra(): InfraStats {
    return buildInfraStats(this.getState());
  }

  /**
   * 服務:九項的覆蓋率、每一座設施的載重與容量。
   *
   * `capacity` 只加總**還在運作**的設施 —— 停電的警局不巡邏。壞掉的那幾座照樣
   * 列在 `facilities` 裡（`operational: false`），這樣才看得出覆蓋率為什麼掉。
   *
   * 這跟 `services()` 不一樣:那一支給的是每月維護費。
   */
  serviceStats(): ServicesStats {
    return buildServicesStats(this.getState());
  }

  /**
   * 經濟與人口的逐日歷史 —— Economy 頁那兩張圖的資料。
   *
   * **不進存檔**:這是 UI 一天記一筆累積起來的，載入存檔之後是空的。
   */
  chartHistory(): ChartHistory {
    return this.stats.chartHistory();
  }

  // ── 圖層 ────────────────────────────────────────────────────────

  /**
   * 服務覆蓋 —— **玩家在畫面上看到的建築顏色**。
   *
   * 綠 → 黃 → 紅，10 階。顏色吃的是 `severity` —— **距離與設施負載取比較糟的那一個**。
   * `ratio` 是距離那一半（1 = 剛好在邊界），`load` 是負載那一半（1 = 剛好滿，
   * 2 = 需求兩倍於容量）。`facilityId` 是服務那一格的那座設施:一片紅色要去動
   * 哪一棟，看它。
   *
   * **有出現在 `cells` 裡就代表有覆蓋** —— 所以這一份同時回答了「有沒有」跟
   * 「有多勉強」兩個問題。
   *
   * 不需要那張圖層開著:這是從狀態算的，跟畫面上正在顯示什麼無關。
   */
  coverage(service: string): CoverageInfo | { service: string; reason: string } {
    if (!(COVERAGE_SERVICES as readonly string[]).includes(service)) {
      return { service, reason: `no road-cost coverage for ${service} (have: ${COVERAGE_SERVICES.join(', ')})` };
    }
    const src = this.stats.getCoverageCosts(service);
    if (!src) return { service, reason: `no road-cost coverage for ${service}` };

    return buildCoverage(service as CoverageService, {
      budget: src.budget,
      costs: src.costs,
      loadAt: src.loadAt,
      servingFacilityAt: src.servingFacilityAt,
      sources: this.stats.getOverlaySourceCells(service),
      gradient: this.stats.coverageGradient(),
    });
  }

  /**
   * 地面色塊那一層。
   *
   * `kind` 說這些數字該怎麼讀 —— 覆蓋類的地面層是**二元**的（每格 80 或 0），
   * 那一片一模一樣的 80 不是漏抓，是它本來就只有兩個值。要「有多勉強」請看
   * `coverage()`。
   */
  overlay(type: string): { type: string; kind: OverlayKind; cells: OverlayCellInfo[] } {
    return {
      type,
      kind: overlayKind(type),
      cells: buildOverlayCells(
        this.stats.getOverlayData(type),
        (value) => this.stats.getOverlayColor(type, value),
      ),
    };
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

  /**
   * 高架路段與鐵軌 —— 一段一列，同一格疊了兩層就是兩列。
   *
   * `cells()` 回的 `roadType` / `railType` **全部是地面層**（它吐的是 `Grid`，
   * 而高架住在 `ElevationManager`）。橋、匝道、疊層只有這裡看得到。
   *
   * 順序固定為 y、x、level —— 兩次讀取之間比得出差異。
   */
  elevated(rect?: { x1: number; y1: number; x2: number; y2: number }): ElevatedInfo[] {
    const bounds = rect ? {
      x1: Math.min(rect.x1, rect.x2), x2: Math.max(rect.x1, rect.x2),
      y1: Math.min(rect.y1, rect.y2), y2: Math.max(rect.y1, rect.y2),
    } : null;

    const out: ElevatedInfo[] = [];
    for (const e of this.stats.elevatedSegments()) {
      if (bounds && (e.x < bounds.x1 || e.x > bounds.x2 || e.y < bounds.y1 || e.y > bounds.y2)) continue;
      out.push({ x: e.x, y: e.y, level: e.level, ...e.data });
    }
    out.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.level - b.level));
    return out;
  }

  /**
   * 兩格之間走不走得到。
   *
   * `coverage()` 答不了這件事 —— 它是**有預算上限**的 flood，「0 覆蓋」分不出
   * 「不連通」與「連通但太遠」（BUG-368）。這一支沒有上限。
   *
   * `cost` 與 `coverage()` 是同一把尺，所以拿它跟 `ROAD_COVERAGE` 的預算比得出
   * 「一座警局蓋在這裡罩不罩得到那裡」。走不到是 `-1`。
   *
   * 兩端都不必是道路格 —— 跟分區、公共設施一樣附掛到 2 格內的路上。
   */
  connected(from: { x: number; y: number }, to: { x: number; y: number }): ConnectivityResult {
    const graph = this.stats.roadCellGraph();
    // 路網還沒接上時說「通」會比說「不通」糟糕得多 —— 前者會讓呼叫端把橋當成蓋好了。
    if (!graph) return { connected: false, cost: -1 };
    return roadConnectivity(graph, from, to);
  }
}
