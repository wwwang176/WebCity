import type { Game } from '../Game';
import { serializeGameState } from '../core/save/Serializer';
import { AgentApi } from './AgentApi';
import { AgentBudget, type BudgetHost } from './AgentBudget';
import { AgentDistrict, type DistrictHost } from './AgentDistrict';
import { AgentPolicy, type PolicyHost } from './AgentPolicy';
import { AgentRead } from './AgentRead';
import { AgentSession } from './AgentSession';
import { AgentRoutes, type ModeAdapter, type RouteHost } from './AgentRoutes';
import { AgentUi, type CameraTarget, type UiHost } from './AgentUi';
import { buildStatus, type AgentStatus } from './status';
import { RailServiceType } from '../core/transport/RailSystem';
import type { DistrictPaintMode } from '../core/district/DistrictPaint';

export { AgentApi, AGENT_LIMITS } from './AgentApi';
export { AgentBudget } from './AgentBudget';
export { AgentDistrict, PAINT_MODES } from './AgentDistrict';
export { AgentPolicy } from './AgentPolicy';
export { AgentRead } from './AgentRead';
export { AgentRoutes, TRANSIT_MODES } from './AgentRoutes';
export { AgentSession } from './AgentSession';
export { AgentUi } from './AgentUi';
export { buildStatus, type AgentStatus } from './status';
export * from './registry';

/**
 * `window.__agent` —— 遊戲裡看得到、按得到的東西，全部給程式一份。
 *
 * 分四塊:
 *
 * | | 做什麼 |
 * |---|---|
 * | `act()` | 蓋、拆、劃分區。走 `Game.handleToolAction()`，把工具狀態設滿 |
 * | `routes` | 公車／地鐵／鐵路／渡輪的建線、拆線、加減車 |
 * | `budget` | 稅率、借款、還款 |
 * | `policy` | 分區條例、全城條例、城市特化 |
 * | `districts` | 分區的增刪改名換色，以及筆刷指向誰、用什麼模式 |
 * | `ui` | 開關面板、圖層、聚焦視角、工具、暫停與速度、鏡頭 |
 * | `read` | 城市數字、建築、居民、服務、大眾運輸、逐格資料 |
 * | `session` | 存檔清單、存檔、匯出、載入、開新局（**沒有刪除**） |
 * | `status()` | 玩家現在在看什麼:主選單／載入中／遊戲中、哪個面板、教程走到哪 |
 */
export interface AgentRoot {
  /** 玩家現在在看什麼。主選單上也答得出來。 */
  status: () => AgentStatus;
  act: AgentApi['act'];
  history: AgentApi['history'];
  routes: AgentRoutes;
  budget: AgentBudget;
  policy: AgentPolicy;
  districts: AgentDistrict;
  ui: AgentUi;
  read: AgentRead;
  session: AgentSession;
}

/** `Game` 的形狀轉成 `AgentUi` 要的樣子。 */
function uiHost(game: Game): UiHost {
  const g = game as unknown as {
    overlayRenderer: { getOverlay(): string; };
    sceneManager: {
      getCameraState(): { x: number; y: number; size: number; angle: number; elevation: number };
      setCameraState(t: CameraTarget & { y?: number }): void;
    };
  };
  return {
    get currentTool() { return game.currentTool; },
    set currentTool(v) { game.currentTool = v; },
    get viewMode() { return game.viewMode; },
    set viewMode(v) { game.viewMode = v; },
    get paused() { return game.paused; },
    set paused(v) { game.paused = v; },
    get speed() { return game.speed; },
    set speed(v) { game.speed = v; },
    get notification() { return game.notification; },
    set notification(v) { game.notification = v; },
    setTool: (t) => game.setTool(t),
    deselectBuilding: () => game.deselectBuilding(),
    setOverlay: (t) => game.setOverlay(t),
    getOverlay: () => g.overlayRenderer.getOverlay() as never,
    toggleViewMode: (m) => game.toggleViewMode(m),
    togglePause: () => game.togglePause(),
    setSpeed: (s) => game.setSpeed(s),
    camera: () => g.sceneManager.getCameraState(),
    setCamera: (t) => {
      g.sceneManager.setCameraState({ x: t.x, y: t.y, size: t.size, angle: t.angle, elevation: t.elevation });
      return g.sceneManager.getCameraState();
    },
  };
}

/**
 * 四種運具接成同一個形狀。
 *
 * 公車走 `Game`（要車道尋路，那份資料只有 `Game` 拿得到），其餘三種直接走各自的
 * 系統 —— 面板也是這樣呼叫的。
 */
function routeHost(game: Game): RouteHost {
  const s = () => game.getState();

  const bus: ModeAdapter = {
    stops: () => s().bus.getStops(),
    listRoutes: () => s().bus.getRoutes(),
    createRoute: (stops, n) => game.createBusRoute(stops, n),
    deleteRoute: (id) => game.deleteBusRoute(id),
    addVehicle: (id) => game.addBusVehicle(id),
    removeVehicle: (id) => game.removeBusVehicle(id),
  };

  const metro: ModeAdapter = {
    stops: () => s().metro.getStations(),
    listRoutes: () => s().metro.getRoutes(),
    createRoute: (stops, n) => s().metro.createLine([...stops], n),
    deleteRoute: (id) => s().metro.deleteLine(id),
    addVehicle: (id) => s().metro.addVehicleToRoute(id),
    removeVehicle: (id) => s().metro.removeVehicleFromRoute(id),
  };

  const rail: ModeAdapter = {
    stops: () => s().rail.getStations(),
    listRoutes: () => s().rail.getRoutes(),
    // 客運。貨運班次不是玩家開的，是產業自己叫的車。
    createRoute: (stops, n) => s().rail.createLine([...stops], RailServiceType.PASSENGER, n),
    deleteRoute: (id) => s().rail.deleteLine(id),
    addVehicle: (id) => s().rail.addVehicleToRoute(id),
    removeVehicle: (id) => s().rail.removeVehicleFromRoute(id),
  };

  const ferry: ModeAdapter = {
    stops: () => s().ferry.getDocks(),
    listRoutes: () => s().ferry.getRoutes(),
    createRoute: (stops, n) => {
      // 渡輪自己的 createRoute 不驗連通性，會建出一條划不過去的線。面板先驗再建，
      // 這裡照做。
      const docks = [...stops];
      if (!s().ferry.validateRouteConnectivity(docks)) return null;
      return s().ferry.createRoute(docks, n);
    },
    deleteRoute: (id) => s().ferry.deleteRoute(id),
    addVehicle: (id) => s().ferry.addVehicleToRoute(id),
    removeVehicle: (id) => s().ferry.removeVehicleFromRoute(id),
  };

  return { bus, metro, rail, ferry };
}

/**
 * 稅率的兩根旋鈕。
 *
 * 營業稅四個欄位一起動 —— 三個逐區的舊欄位還在被計算，只設 `business` 的話商業區
 * 會照著舊稅率繳，而面板上看不出來。面板的滑桿也是這樣寫的。
 */
function budgetHost(game: Game): BudgetHost {
  const b = () => game.getState().budget;
  const t = () => game.getState().taxRates;
  return {
    taxRates: t,
    setIncomeTax: (r) => { t().residential = r; },
    setBusinessTax: (r) => {
      const rates = t();
      rates.business = r;
      rates.commercial = r;
      rates.industrial = r;
      rates.office = r;
    },
    funds: () => b().funds,
    loans: () => b().loans,
    takeLoan: (n) => game.takeLoan(n),
    repayLoan: (n) => game.repayLoan(n),
  };
}

/** 條例分兩邊放:全城的在 `ordinances`，分區的在 `policies`。 */
function policyHost(game: Game): PolicyHost {
  const s = () => game.getState();
  return {
    districtIds: () => s().districts.getAllDistricts().map(d => d.id),
    cityLevel: (type) => s().ordinances.getLevel(type),
    setCityLevel: (type, level) => s().ordinances.setLevel(type, level),
    districtLevel: (id, type) => s().policies.getPolicyLevel(id, type),
    setDistrictLevel: (id, type, level) => s().policies.setPolicyLevel(id, type, level),
    specialization: () => s().citySpec.getCurrent(),
    chooseSpecialization: (type) => s().citySpec.choose(type, s().citizens.getPopulation()),
    population: () => s().citizens.getPopulation(),
  };
}

/**
 * 分區。
 *
 * 建立走 `Game.createNewDistrict()` 而不是 `DistrictManager.createDistrict()` ——
 * 前者會挑一個沒撞名的號碼，而且順手把筆刷指過去。
 */
function districtHost(game: Game): DistrictHost {
  const dm = () => game.getState().districts;
  const g = game as unknown as {
    activeDistrictId: string | null;
    districtPaintMode: DistrictPaintMode;
  };
  return {
    all: () => dm().getAllDistricts(),
    create: (name) => game.createNewDistrict(name),
    remove: (id) => dm().deleteDistrict(id),
    rename: (id, name) => dm().renameDistrict(id, name),
    setColor: (id, colorIndex) => dm().setDistrictColor(id, colorIndex),
    merge: (keepId, mergedId) => dm().mergeDistricts(keepId, mergedId).id,
    activeId: () => g.activeDistrictId,
    setActive: (id) => game.setActiveDistrict(id),
    paintMode: () => g.districtPaintMode,
    setPaintMode: (mode) => game.setDistrictPaintMode(mode),
  };
}

export function createAgent(game: Game): AgentRoot {
  const api = new AgentApi(game);
  const read = new AgentRead(() => game.getState(), game);
  const ui = new AgentUi(uiHost(game));
  const session = new AgentSession(
    () => serializeGameState(game.getState()),
    () => game.getState().citizens.getPopulation(),
  );

  return {
    status: () => buildStatus(ui),
    act: (action) => api.act(action),
    history: () => api.history(),
    routes: new AgentRoutes(routeHost(game)),
    budget: new AgentBudget(budgetHost(game)),
    policy: new AgentPolicy(policyHost(game)),
    districts: new AgentDistrict(districtHost(game)),
    ui,
    read,
    session,
  };
}
