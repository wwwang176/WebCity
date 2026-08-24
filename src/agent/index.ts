import type { Game } from '../Game';
import { gameSignals } from '../ui/store/gameStore';
import { serializeGameState } from '../core/save/Serializer';
import { AgentApi } from './AgentApi';
import { AgentBudget, type BudgetHost } from './AgentBudget';
import { AgentDistrict, type DistrictHost } from './AgentDistrict';
import { AgentPolicy, type PolicyHost } from './AgentPolicy';
import { AgentRead, type StatsHost } from './AgentRead';
import { AgentSession } from './AgentSession';
import { AgentRoutes, type ModeAdapter, type RouteHost } from './AgentRoutes';
import { AgentUi, type CameraTarget, type UiHost } from './AgentUi';
import { buildStatus, type AgentStatus } from './status';
import { RailServiceType } from '../core/transport/RailSystem';
import { RoadType } from '../core/road/types';
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
 * `window.__agent` — everything visible and pressable in the game, given to a program.
 *
 * | | What it does |
 * |---|---|
 * | `act()` | Build, demolish, paint districts. Goes through `Game.handleToolAction()` with the tool state fully set |
 * | `routes` | Create and delete bus / metro / rail / ferry routes and change their vehicle counts |
 * | `budget` | Tax rates, loans, repayments |
 * | `policy` | District policies, city ordinances, city specialization |
 * | `districts` | Create, delete, rename and recolour districts, and the brush's target and mode |
 * | `ui` | Panels, overlays, focus view modes, tools, pause and speed, camera |
 * | `read` | City figures, buildings, citizens, services, transit, per-cell data, elevated segments, connectivity |
 * | `session` | List, save, export, load, and start a new game (**no delete**) |
 * | `status()` | What the player is looking at: menu / loading / in game, which panel, tutorial progress |
 */
export interface AgentRoot {
  /** What the player is looking at. Answerable on the main menu too. */
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

/** Adapts `Game`'s shape to what `AgentUi` needs. */
function uiHost(game: Game): UiHost {
  const g2 = game as unknown as {
    currentRotation: number;
    placementMode: string;
    currentRoadType: number;
    elevationLevel: number;
    loadedSlotId: number | null;
    loadedSaveName: string | null;
  };
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
    rotation: () => g2.currentRotation,
    placementMode: () => g2.placementMode,
    roadType: () => RoadType[g2.currentRoadType] ?? String(g2.currentRoadType),
    elevationLevel: () => g2.elevationLevel,
    // These three are UI signals, not fields on `Game`.
    previewCost: () => gameSignals.previewCost(),
    selectedTransferRoute: () => gameSignals.selectedTransferRoute(),
    selectedCitizenId: () => gameSignals.selectedCitizenId(),
    audio: () => {
      const a = game.getAudioManager();
      return { muted: a.isMuted(), sfxMuted: a.isSfxMuted(), musicMuted: a.isMusicMuted() };
    },
    loadedSave: () => ({ slot: g2.loadedSlotId, name: g2.loadedSaveName }),
    camera: () => g.sceneManager.getCameraState(),
    setCamera: (t) => {
      g.sceneManager.setCameraState({ x: t.x, y: t.y, size: t.size, angle: t.angle, elevation: t.elevation });
      return g.sceneManager.getCameraState();
    },
  };
}

/**
 * Adapts the four transit modes to one shape.
 *
 * Buses go through `Game`, which needs lane pathfinding data only `Game` holds; the other three
 * go straight to their own systems, exactly as the panels call them.
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
    // Passenger service. Freight runs are called by industry, not opened by the player.
    createRoute: (stops, n) => s().rail.createLine([...stops], RailServiceType.PASSENGER, n),
    deleteRoute: (id) => s().rail.deleteLine(id),
    addVehicle: (id) => s().rail.addVehicleToRoute(id),
    removeVehicle: (id) => s().rail.removeVehicleFromRoute(id),
  };

  const ferry: ModeAdapter = {
    stops: () => s().ferry.getDocks(),
    listRoutes: () => s().ferry.getRoutes(),
    createRoute: (stops, n) => {
      // The ferry system's own createRoute does not check connectivity and will create a route
      // no boat can sail. The panel validates first, and so does this.
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
 * The two tax dials.
 *
 * Business tax moves four fields at once: the three older per-zone fields are still used in the
 * calculation, so setting only `business` leaves commercial zones paying the old rate with
 * nothing visible in the panel. The panel's slider does the same.
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

/** Policies live in two places: city-wide in `ordinances`, per-district in `policies`. */
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
 * Districts.
 *
 * Creation goes through `Game.createNewDistrict()` rather than
 * `DistrictManager.createDistrict()`: it picks a non-colliding number and points the brush at
 * the new district.
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

/**
 * `Game`'s statistics plus one it does not have.
 *
 * Chart history lives in the UI store, one entry per day and not saved, so `Game` has no such
 * field. Everything else is one of `Game`'s own methods, forwarded untouched.
 */
function statsHost(game: Game): StatsHost {
  // Written out method by method rather than inheriting via `Object.create(game)`, which would
  // bind `this` to the wrapper instead of the game and silently misdirect any method later
  // changed to write a field.
  return {
    getEconomyBreakdown: () => game.getEconomyBreakdown(),
    getBillableDistricts: () => game.getBillableDistricts(),
    getCommuteStats: () => game.getCommuteStats(),
    getTrafficStats: () => game.getTrafficStats(),
    getTransferStats: () => game.getTransferStats(),
    getAbandonmentStress: (x, y) => game.getAbandonmentStress(x, y),
    getSelectedBuilding: () => game.getSelectedBuilding(),
    // `StatsHost` takes an arbitrary string, since callers may ask for anything, and it narrows
    // to the game's enum here. Unrecognised types return empty downstream rather than being
    // rejected here.
    getOverlayData: (type) => game.getOverlayData(type as never),
    getOverlayColor: (type, value) => game.getOverlayColor(type as never, value),
    getCoverageCosts: (service) => game.getCoverageCosts(service as never),
    getOverlaySourceCells: (type) => game.getOverlaySourceCells(type as never),
    coverageGradient: () => game.coverageGradient(),
    elevatedSegments: () => game.getElevatedSegments(),
    roadCellGraph: () => game.getRoadCellGraph(),
    chartHistory: () => gameSignals.chartHistory(),
  };
}

export function createAgent(game: Game): AgentRoot {
  const api = new AgentApi(game);
  const read = new AgentRead(() => game.getState(), statsHost(game));
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
