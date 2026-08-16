import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager';
import { dragToPan } from './renderer/cameraPan';
import { TerrainRenderer } from './renderer/TerrainRenderer';
import { RoadRenderer } from './renderer/RoadRenderer';
import { BuildingRenderer } from './renderer/BuildingRenderer';
import { VehicleRenderer, type VehicleData } from './renderer/VehicleRenderer';
import { TrafficLightRenderer } from './renderer/TrafficLightRenderer';
import { syncTrafficLightsWithGrid } from './core/traffic/TrafficLights';
import { OverlayRenderer, type ElevatedOverlayCell } from './renderer/OverlayRenderer';
import { GridCursor } from './renderer/GridCursor';
import { WeatherRenderer } from './renderer/WeatherRenderer';
import { createGameState, type GameState } from './core/simulation/GameState';
import { SimulationLoop } from './core/simulation/SimulationLoop';
import { GameClock, type GameSpeed } from './core/simulation/GameClock';
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType, ROAD_CONFIGS } from './core/road/types';
import { ZoneType, isCommercialZone } from './core/grid/types';
import { normalizeRect, countRoadTiles, getLShapedPath, parseLevelFromKey, parsePosKey, parsePosKeyUnsafe, toPosKey, getDirectionFlag } from './core/grid/GridHelpers';
import { planRezone } from './core/zone/RezonePlan';
import { ZoneManager } from './core/zone/ZoneManager';
import { OverlayType } from './renderer/OverlayRenderer';
import { PALETTE } from './ColorPalette';
import { AudioManager, SoundType } from './audio/AudioManager';
import { type BuildingType } from './core/building/types';
import { WorkplaceDistanceClient } from './core/workplace/WorkplaceDistanceClient';
import { WorkplaceDistanceCache } from './core/workplace/WorkplaceDistanceCache';
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { exportSaveToFile } from './core/save/ImportExport';
import { serializeGameState, snapshotGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { getTotalTransportOperatingCost } from './core/transport/TransportRegistry';
import { tryRandomDisaster, formatDisasterMessage, applyDisasterDamage } from './core/climate/Disaster';
import { getSpeedLimitForCell } from './core/traffic/TrafficSimulation';
import { findLanePath } from './core/traffic/LaneGraphPathfinder';
import { getBuildingType } from './core/building/types';
import type { TransportStop, TransportRoute } from './core/transport/types';
import { classifyVehicleType } from './core/traffic/VehicleClassification';
import type { ServiceVehicleType } from './core/traffic/TrafficSimulation';
import { getInfraConfig, getInfraConfigById, getInfraBuildingId, getRotatedSize, isInfrastructureBuilding, isInfraType, isZoneBuilding, type InfraType, type Rotation } from './core/building/InfraConfig';
import { canPlaceInfra, placeInfraOnGrid, removeInfraFromGrid, findPrimaryCell, forEachMultiCell, ROTATION_RESERVED, ABANDONED } from './core/building/InfraPlacement';
import { PlacementPreview } from './renderer/PlacementPreview';
import { HighlightManager } from './renderer/HighlightManager';
import { ROAD_COVERAGE } from './core/service/RoadCoverageFlood';
import { isResidentialZone } from './core/grid/types';
import { TransportRouteRenderer } from './renderer/TransportRouteRenderer';
import { MetroTunnelRenderer } from './renderer/MetroTunnelRenderer';
import { type AirportSize } from './core/transport/AirportSystem';
import { collectTransportVehicles } from './core/transport/collectTransportVehicles';
import { collectTransportRoutes, filterRoutesForViewMode } from './core/transport/collectTransportRoutes';
import { PedestrianRenderer, cullPedestrians } from './renderer/PedestrianRenderer';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from './core/building/InfraServiceActions';
import { getInfraDetails as getInfraDetailsFromCtx, type InfraDetailContext } from './core/building/InfraDetails';
import { classifyBuilding } from './core/building/BuildingClassifier';
import { classifyDemolishCell } from './core/building/DemolishClassifier';
import { getEconomyBreakdown as computeEconomyBreakdown } from './core/economy/EconomyBreakdown';
import { buildEconomyBreakdownContext } from './core/economy/EconomyBreakdownContext';
import { buildIncomeCalcDeps } from './core/economy/IncomeCalcAdapter';
import { calculateSingleBuildingIncome } from './core/economy/IncomeCalculator';

import {
  ViewMode,
  VIEW_MODE_OPACITY,
  getTransportFocusMode,
  STOP_NAMES,
  type TransportStopKind,
} from './core/ViewMode';
import { computeTunnelSegments } from './core/transport/MetroTunnelPath';
import { getBuildReasonMessage, formatBuildFailure } from './core/grid/BuildReasonMessages';
import { getZoneBlocker, summariseZoneBlockers, ZONE_BLOCKER_MESSAGES, type ZoneBlocker, type ZoneBlockerDeps } from './core/zone/ZoneBlocker';
import { collectBuildingUtilityWarnings } from './core/building/BuildingUtilityWarning';
import { buildOverlayValue, type OverlayBuildContext } from './core/overlay/OverlayBuilders';
import { DEFAULT_JOB_RELOCATION_CONFIG } from './core/citizen/JobRelocation';
import { getTransitSystems } from './core/transport/TransportRegistry';

/**
 * 通勤圖層的滿格值（tick）。
 *
 * 與換工作的門檻同一個數字：紅色代表「這裡的人已經在想換工作了」。刻度是絕對值
 * 不是相對最大值 —— 相對刻度會讓一座通勤全都很好的城市裡最慢的那一格照樣變紅。
 */
const COMMUTE_OVERLAY_MAX = DEFAULT_JOB_RELOCATION_CONFIG.commuteTimeThreshold;
import { getCoverageService, OVERLAY_SCALE } from './core/overlay/CoverageOverlay';
import { getTrafficStats as computeTrafficStats } from './core/traffic/TrafficStats';
import { canPlaceTransportStop, findAdjacentRoadCell, placeTransportStopOnGrid, TRANSPORT_TO_INFRA_TYPE } from './core/transport/TransportPlacement';
import { generateTerrain } from './core/grid/TerrainGenerator';
import { type MapConfig, STARTING_FUNDS_MAP, DISASTER_CHANCE_MAP, resolveTerrainConfig } from './core/config/MapConfig';
import { isWater, getGroundwaterLevel, isShorePosition } from './core/grid/Terrain';
import { FerryAnimator } from './renderer/FerryAnimator';
import { TrackRenderer } from './renderer/TrackRenderer';
import { ElevatedRoadRenderer } from './renderer/ElevatedRoadRenderer';
import { RailBuilder } from './core/rail/RailBuilder';
import { RailNetwork, rebuildRailNetworkFromGrid } from './core/rail/RailNetwork';
import { RAIL } from './core/rail/types';
import { LevelCrossingSystem } from './core/rail/LevelCrossingSystem';
import { LevelCrossingRenderer } from './renderer/LevelCrossingRenderer';
import { TrainAnimator } from './renderer/TrainAnimator';
import { AirplaneAnimator } from './renderer/AirplaneAnimator';
import { ElevationManager, ElevatedRoadBuilder, ElevatedRailBuilder, ELEVATION_COST, type ElevatedPosition, getElevatedPath, validateElevatedPath } from './core/elevation';
import { rebuildElevatedRailNetwork } from './core/elevation/ElevatedRailBuilder';
import { UnifiedRoadLookup } from './core/road/UnifiedRoadLookup';
import { canAdvanceThrough } from './core/traffic/CanAdvance';
import { getTotalServiceMaintenanceCost } from './core/service/ServiceRegistry';
import { calculateDistrictPolicyCost } from './core/economy/ExpenseCalculator';
import { calculateElevatedMaintenance } from './core/elevation/ElevationMaintenance';

export type PlacementMode = 'ground' | 'elevated';



/** Map service vehicle types to renderer vehicle type keys. */
const SERVICE_TYPE_TO_VEHICLE_TYPE: Record<ServiceVehicleType, VehicleData['type']> = {
  police: 'police_car',
  fire: 'firetruck',
  health: 'ambulance',
  garbage: 'garbage_truck',
};

export type ToolType = 'select' | 'road' | 'road_rural' | 'road_2lane' | 'road_4lane' | 'road_6lane' | 'road_highway' | 'rail_track' | 'zone_r' | 'zone_rh' | 'zone_c' | 'zone_ch' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery' | 'district' | 'bus_stop' | 'metro_station' | 'train_station' | 'ferry_dock' | 'airport_s' | 'airport_m' | 'airport_l';

/** Camera and input tuning constants */
export const CAMERA_INPUT = {
  PAN_SPEED: 15,
  ORBIT_SENSITIVITY: 0.005,
  ZOOM_SENSITIVITY: 0.05,
  /** Sync building meshes every N ticks */
  BUILDING_SYNC_INTERVAL: 6,
  /** Max tick accumulator = tickInterval × this */
  ACCUMULATOR_CAP_FACTOR: 10,
} as const;

/** Map airport tool types to AirportSize. */
const AIRPORT_TOOL_SIZE: Partial<Record<ToolType, AirportSize>> = {
  airport_s: 'SMALL', airport_m: 'MEDIUM', airport_l: 'LARGE',
};
function isAirportTool(tool: ToolType): boolean { return tool in AIRPORT_TOOL_SIZE; }
function getAirportToolSize(tool: ToolType): AirportSize { return AIRPORT_TOOL_SIZE[tool] ?? 'SMALL'; }

/** Map airport tool to InfraType. */
const AIRPORT_TOOL_INFRA: Partial<Record<ToolType, InfraType>> = {
  airport_s: 'airport_s', airport_m: 'airport_m', airport_l: 'airport_l',
};

/** Map of tool types that directly delegate to placeInfrastructure (DRY). */
const TOOL_TO_INFRA: Partial<Record<ToolType, InfraType>> = {
  power: 'power', water: 'water', police: 'police', fire: 'fire',
  hospital: 'hospital', school: 'school', school_high: 'school_high',
  school_univ: 'school_univ', park: 'park', garbage: 'garbage',
  sewage: 'sewage', cemetery: 'cemetery',
};

/** Map of tool types that directly delegate to placeTransportStop (DRY). */
const TOOL_TO_TRANSPORT: Partial<Record<ToolType, 'bus' | 'metro' | 'rail' | 'ferry' | 'airport'>> = {
  bus_stop: 'bus', metro_station: 'metro', train_station: 'rail',
  ferry_dock: 'ferry', airport_s: 'airport', airport_m: 'airport', airport_l: 'airport',
};

/** Map of zone tool types to ZoneType (DRY). */
const TOOL_TO_ZONE: Partial<Record<ToolType, ZoneType>> = {
  zone_r: ZoneType.RESIDENTIAL_LOW, zone_rh: ZoneType.RESIDENTIAL_HIGH,
  zone_c: ZoneType.COMMERCIAL_LOW, zone_ch: ZoneType.COMMERCIAL_HIGH,
  zone_i: ZoneType.INDUSTRIAL, zone_o: ZoneType.OFFICE,
};

/** Map of road tool types to RoadType (OCP: add new road types here). */
const TOOL_TO_ROAD_TYPE: Partial<Record<ToolType, RoadType>> = {
  road: RoadType.TWO_LANE, road_rural: RoadType.RURAL,
  road_2lane: RoadType.TWO_LANE, road_4lane: RoadType.FOUR_LANE,
  road_6lane: RoadType.SIX_LANE, road_highway: RoadType.HIGHWAY,
};

/** Zone tool preview highlight colors. */
const ZONE_PREVIEW_COLORS: Record<string, number> = {
  zone_r: PALETTE.ZONE.RES_LOW, zone_rh: PALETTE.ZONE.RES_HIGH,
  zone_c: PALETTE.ZONE.COM_LOW, zone_ch: PALETTE.ZONE.COM_HIGH,
  zone_i: PALETTE.ZONE.IND_PREVIEW, zone_o: PALETTE.ZONE.OFFICE_PREVIEW,
};

/** Key-to-tool bindings (OCP: add new keyboard shortcuts here). */
const KEY_TO_TOOL: Record<string, ToolType> = {
  '1': 'select', '2': 'road_2lane', '3': 'zone_r', '4': 'zone_c',
  '5': 'zone_i', '6': 'zone_o', '7': 'road_rural', '8': 'power',
  '9': 'water', '0': 'demolish', 'delete': 'demolish',
};

/** Key-to-overlay bindings (OCP: add new overlay shortcuts here). */
const KEY_TO_OVERLAY: Record<string, OverlayType> = {
  'f1': OverlayType.POWER, 'f2': OverlayType.WATER, 'f3': OverlayType.POLLUTION,
  'f4': OverlayType.LAND_VALUE, 'f5': OverlayType.TRAFFIC, 'f6': OverlayType.ZONE,
};

/** Tool-to-cursor-color mapping (OCP: add new tool colors here). */
const TOOL_CURSOR_COLORS: Record<ToolType, number> = {
  select: PALETTE.TOOL.SELECT,
  road: PALETTE.TOOL.ROAD, road_rural: PALETTE.TOOL.ROAD, road_2lane: PALETTE.TOOL.ROAD,
  road_4lane: PALETTE.TOOL.ROAD, road_6lane: PALETTE.TOOL.ROAD, road_highway: PALETTE.TOOL.ROAD,
  rail_track: PALETTE.TOOL.RAIL_TRACK,
  zone_r: PALETTE.ZONE.RES_LOW, zone_rh: PALETTE.ZONE.RES_HIGH,
  zone_c: PALETTE.ZONE.COM_LOW, zone_ch: PALETTE.ZONE.COM_HIGH,
  zone_i: PALETTE.ZONE.IND, zone_o: PALETTE.ZONE.OFFICE,
  demolish: PALETTE.TOOL.DEMOLISH,
  power: PALETTE.INFRA.POWER, water: PALETTE.INFRA.WATER, police: PALETTE.INFRA.POLICE, fire: PALETTE.INFRA.FIRE,
  hospital: PALETTE.INFRA.HOSPITAL, school: PALETTE.INFRA.SCHOOL, school_high: PALETTE.INFRA.SCHOOL_HIGH,
  school_univ: PALETTE.INFRA.SCHOOL_UNIV, park: PALETTE.INFRA.PARK, garbage: PALETTE.INFRA.GARBAGE,
  sewage: PALETTE.INFRA.SEWAGE, cemetery: PALETTE.INFRA.CEMETERY,
  district: PALETTE.TOOL.DISTRICT,
  bus_stop: PALETTE.TRANSPORT.BUS, metro_station: PALETTE.TRANSPORT.METRO, train_station: PALETTE.INFRA.SCHOOL,
  ferry_dock: PALETTE.TRANSPORT.FERRY_DOCK,
  // Three airport sizes are separate tools; the single `airport` key here was
  // a tool that does not exist, so all three fell through to the default.
  airport_s: PALETTE.TOOL.AIRPORT, airport_m: PALETTE.TOOL.AIRPORT, airport_l: PALETTE.TOOL.AIRPORT,
};

/** Map of tool types to auto-activated overlay (OCP: add new overlay mappings here). */
const TOOL_TO_OVERLAY: Partial<Record<ToolType, OverlayType>> = {
  power: OverlayType.POWER, water: OverlayType.WATER, police: OverlayType.POLICE, fire: OverlayType.FIRE,
  hospital: OverlayType.HEALTH, school: OverlayType.EDUCATION, school_high: OverlayType.EDUCATION,
  school_univ: OverlayType.EDUCATION, park: OverlayType.PARK, garbage: OverlayType.GARBAGE,
  district: OverlayType.DISTRICT,
};

/**
 * Per-service coverage ratio for the selected building.
 * -1 = no coverage, 0.0 = nearest (best), 1.0 = farthest (worst).
 * Power/water/sewage use 0 (covered) or -1 (not covered).
 *
 * Defined in core so it can be built and tested without Three.js; re-exported
 * here because the UI has always imported it from Game.
 */
export type { ServiceStatus } from './core/service/ServiceStatusView';
import { buildServiceStatus, type ServiceStatus } from './core/service/ServiceStatusView';
import type { SaveCompleteMessage } from './core/save/SaveWorkerHandler';
import { classifySaveError } from './core/save/SaveFailure';
import { findWaterPlantSites } from './core/building/WaterPlantSites';
import { reconcileGameState, isClean } from './core/simulation/Reconcile';
import { GROUNDWATER_SEARCH_RANGE } from './core/grid/Terrain';

export interface SelectedZoneBuilding {
  kind: 'zone';
  x: number;
  y: number;
  buildingType: BuildingType;
  zoneType: ZoneType;
  landValue: number;
  pollution: number;
  pollutionGround: number;
  pollutionWater: number;
  pollutionNoise: number;
  serviceCoverage: number;
  services: ServiceStatus;
  abandonmentStress: number;
  isAbandoned: boolean;
  /** Commercial: supply ratio (0~1). */
  freightRatio?: number;
  /** Commercial: supply source ('local' | 'imported' | 'none'). */
  freightSource?: 'local' | 'imported' | 'none';
  /** Industrial: surplus ratio (0~1). */
  freightSurplusRatio?: number;
  /** Industrial: whether surplus is being exported. */
  freightExporting?: boolean;
  /** Residential: shopping access ratio (0~1). */
  shoppingRatio?: number;
  /** Residential: has any commercial reachable. */
  shoppingAccess?: boolean;
  /** Commercial: customer ratio (0~1). */
  customerRatio?: number;
  /** Commercial: has any residential reachable. */
  hasCustomers?: boolean;
  /** Actual worker count in this building. */
  workerCount: number;
  /** Max worker capacity of this building type. */
  workerCapacity: number;
  /** Pre-calculated actual tax income for this building. */
  taxIncome: number;
  /** City-wide garbage load ratio (totalLoad / totalCapacity). >1 = overflowing. */
  garbageLoadRatio: number;
  /** City-wide hospital load ratio (> 1 means overloaded). */
  hospitalLoadRatio: number;
  /** City-wide police load ratio (> 1 means overloaded). */
  policeLoadRatio: number;
  /** City-wide fire load ratio (> 1 means overloaded). */
  fireLoadRatio: number;
  /** Number of dead bodies at this building awaiting hearse pickup. */
  pendingDeaths: number;
  /** Number of garbage bags at this building awaiting truck pickup. */
  pendingGarbage: number;
}

export interface SelectedInfraBuilding {
  kind: 'infra';
  x: number;
  y: number;
  /** Primary (anchor) cell coordinates for detail lookup */
  primaryX: number;
  primaryY: number;
  infraType: InfraType;
  name: string;
  cost: number;
  /** Service-specific details to display */
  details: Record<string, string | number>;
  hasPower: boolean;
  hasWater: boolean;
}

export interface SelectedTransportStop {
  kind: 'transport';
  x: number;
  y: number;
  transportType: TransportStopKind;
  name: string;
  routes: number;
  vehicles: number;
  ridersPerDay: number;
  hasPower: boolean;
  hasWater: boolean;
}

/**
 * An EMPTY zoned cell the player clicked to ask "why is nothing being built
 * here?".
 *
 * Selecting one used to do nothing at all — handleSelectClick required
 * `buildingId > 0` — which left the question with no way to be asked, let alone
 * answered.
 */
export interface SelectedEmptyZone {
  kind: 'emptyZone';
  x: number;
  y: number;
  zoneType: number;
  /** null when the cell is fine and simply has not been picked for growth yet. */
  blocker: ZoneBlocker | null;
  reason: string;
  hasPower: boolean;
  hasWater: boolean;
  /** How many other empty zoned cells across the city share this blocker. */
  sameBlockerCount: number;
}

export type SelectedBuilding = SelectedZoneBuilding | SelectedInfraBuilding | SelectedTransportStop | SelectedEmptyZone;

export class Game {
  // The renderers below are built in the 'Preparing graphics...' step of
  // buildInitSteps(), which the async initPhases() runs after construction so
  // the loading bar can report real progress. TypeScript cannot follow that,
  // so `!` records that they are set before any method that reads them runs.
  private sceneManager!: SceneManager;
  private terrainRenderer!: TerrainRenderer;
  private roadRenderer!: RoadRenderer;
  private buildingRenderer!: BuildingRenderer;
  private vehicleRenderer!: VehicleRenderer;
  private pedestrianRenderer!: PedestrianRenderer;
  private trafficLightRenderer!: TrafficLightRenderer;
  private overlayRenderer!: OverlayRenderer;
  private weatherRenderer!: WeatherRenderer;
  private gridCursor!: GridCursor;
  private placementPreview!: PlacementPreview;
  private highlightManager!: HighlightManager;
  /** Cached overlay building highlight cells (reapplied every frame). */
  private overlayHighlightCells: { x: number; y: number; color: number }[] = [];
  /** 上一次重建通勤圖層時的統計版本。見 updateRenderers 的重建判斷。 */
  private lastCommuteStatsVersion = -1;
  private transportRouteRenderer!: TransportRouteRenderer;
  /** Currently selected transfer route label for map overlay (null = none). */
  private selectedTransferRoute: string | null = null;
  private transferOverlayLines: THREE.Line[] = [];
  /** Cached transfer highlight cells (reapplied every frame like overlayHighlightCells). */
  private transferHighlightCells: { x: number; y: number; color: number }[] = [];
  private metroTunnelRenderer!: MetroTunnelRenderer;
  private trackRenderer!: TrackRenderer;
  private elevatedRoadRenderer!: ElevatedRoadRenderer;
  private levelCrossingRenderer!: LevelCrossingRenderer;
  private levelCrossingSystem: LevelCrossingSystem;
  private state: GameState;
  private simLoop: SimulationLoop;
  private roadBuilder: RoadBuilder;
  private railBuilder: RailBuilder;
  private railNetwork: RailNetwork;
  private elevationManager: ElevationManager;
  private elevatedRoadBuilder: ElevatedRoadBuilder;
  private roadLookup!: UnifiedRoadLookup;
  private elevatedRailBuilder: ElevatedRailBuilder;
  private zoneManager: ZoneManager;
  private audioManager: AudioManager;
  private autoSaver: AutoSaver;
  private saveWorker: Worker | null = null;
  private roadCoverageDirty = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tickAccumulator = 0;
  private elapsedTime = 0;
  private dirty = new class {
    /** Full road rebuild (load game / disaster). Use markRoadCellsDirty() for incremental. */
    private _roadsFull = true;
    private _dirtyRoadCells: Set<string> | null = null;
    get roads() { return this._roadsFull; }
    set roads(v: boolean) {
      if (v) { this._roadsFull = true; this._dirtyRoadCells = null; }
      else { this._roadsFull = false; this._dirtyRoadCells = null; }
    }
    markRoadCellsDirty(cells: string[]): void {
      if (this._roadsFull) return;
      if (!this._dirtyRoadCells) this._dirtyRoadCells = new Set();
      for (const c of cells) this._dirtyRoadCells.add(c);
    }
    get dirtyRoadCells(): Set<string> | null { return this._roadsFull ? null : this._dirtyRoadCells; }
    get hasRoadChanges(): boolean { return this._roadsFull || (this._dirtyRoadCells !== null && this._dirtyRoadCells.size > 0); }

    /** Elevated road incremental update cells. */
    private _elevatedDirtyCells: string[] | null = null;
    elevatedRoadsFull = true;
    markElevatedCellsDirty(cells: string[]): void {
      if (this.elevatedRoadsFull) return;
      if (!this._elevatedDirtyCells) this._elevatedDirtyCells = [];
      this._elevatedDirtyCells.push(...cells);
    }
    get elevatedDirtyCells(): string[] | null { return this.elevatedRoadsFull ? null : this._elevatedDirtyCells; }
    get hasElevatedChanges(): boolean { return this.elevatedRoadsFull || (this._elevatedDirtyCells !== null && this._elevatedDirtyCells.length > 0); }
    clearElevated(): void { this.elevatedRoadsFull = false; this._elevatedDirtyCells = null; }

    tracks = true;
    crossings = true;
    private _buildings = true;
    terrain = true;
    trafficLights = true;
    overlay = true;
    get buildings() { return this._buildings; }
    set buildings(v: boolean) { this._buildings = v; if (v) this.terrain = true; }
  };

  // UI state
  currentTool: ToolType = 'select';
  currentRoadType: RoadType = RoadType.TWO_LANE;
  placementMode: PlacementMode = 'ground';
  elevationLevel = 1; // target elevation level when in elevated mode (1-3)
  paused = false;
  speed = 1;
  selectedBuilding: SelectedBuilding | null = null;
  notification: string | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private spacePanning = false;
  private onUIUpdate: (() => void) | null = null;
  private previewLine: THREE.Line | null = null;
  private lastMilestoneId: string | null = null;
  /** Highest milestone population ever reached — milestones never un-unlock. */
  private highestMilestonePop = 0;
  private notificationTimer = 0;
  private vehicleTypes = new Map<number, VehicleData['type']>();
  /** Reusable per-frame vehicle data array (avoids .map().filter() allocation). */
  private vehicleDataScratch: VehicleData[] = [];
  /** Reusable per-frame merged vehicle array. */
  private allVehiclesScratch: VehicleData[] = [];
  /** Reusable per-frame train positions array. */
  private trainPosScratch: { x: number; y: number }[] = [];

  /** Bound canAdvance callback (avoids per-frame closure creation). */
  private readonly _canAdvance = (cur: string, next: string, via?: string): boolean =>
    canAdvanceThrough(this.state.trafficLights, this.levelCrossingSystem, cur, next, via);
  /** Bound speed limit callback (avoids per-frame closure creation). */
  private readonly _getSpeedLimit = (key: string): number => getSpeedLimitForCell(this.roadLookup ?? this.state.grid, key);
  /** 渡輪渲染端動畫（純 LERP，不靠 tick） */
  private ferryAnimator = new FerryAnimator();
  /** 火車渲染端動畫（純 LERP，不靠 tick） */
  private trainAnimator = new TrainAnimator();
  /** 飛機起降渲染端動畫 */
  private airplaneAnimator = new AirplaneAnimator();
  previewCost: number | null = null; // estimated cost during road drag
  activeDistrictId: string | null = null; // currently selected district for painting
  currentRotation: Rotation = 0; // infrastructure placement rotation (R key cycles)
  viewMode: ViewMode = ViewMode.NORMAL;

  /** Which save slot this game was loaded from (null = new game) */
  loadedSlotId: number | null = null;
  /** Name of the save slot this game was loaded from */
  loadedSaveName: string | null = null;
  mapConfig: MapConfig | null = null;

  constructor(container: HTMLElement, loadedState?: GameState, mapConfig?: MapConfig) {
    const mapSize = loadedState ? loadedState.grid.width : 60;

    // Audio
    this.audioManager = new AudioManager();
    this.audioManager.init();
    this.audioManager.startAmbient();

    // Auto-save every 100 ticks
    this.autoSaver = new AutoSaver(100);
    try {
      this.saveWorker = new Worker(new URL('./workers/save.worker.ts', import.meta.url), { type: 'module' });
      // Every SAVE_COMPLETE — success AND failure — used to be discarded,
      // because nothing was ever listening. A player whose storage filled up
      // kept building for as long as they liked on a city that had silently
      // stopped being written to disk.
      this.saveWorker.onmessage = (e: MessageEvent) => {
        this.handleSaveComplete(e.data as SaveCompleteMessage);
      };
      // A worker that dies takes autosave with it, just as silently.
      this.saveWorker.onerror = () => {
        this.saveWorker = null;
        this.showNotification(
          'Autosave stopped working. Use Save in the menu, or export the city to a file.', 10,
        );
      };
    } catch { this.saveWorker = null; }

    if (loadedState) {
      this.state = loadedState;
      this.paused = false;
      this.speed = 1;
      this.state.clock.paused = false;
      this.state.clock.speed = 1;
    } else {
      this.state = createGameState(mapSize, mapSize);
      if (mapConfig) {
        this.mapConfig = mapConfig;
        this.state.budget.funds = STARTING_FUNDS_MAP[mapConfig.startingFunds];
      }
    }
    this.simLoop = new SimulationLoop(this.state);

    // Pathfinding worker: zero-GC A* off the main thread via SharedArrayBuffer
    try {
      const pfWorker = new Worker(
        new URL('./workers/pathfinding.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.simLoop.setPathfindingWorker(pfWorker);
    } catch {
      // Worker not available — pathfinding requests will be skipped until next tick
    }

    // Workplace distance cache: off-thread reverse Dijkstra for O(1) relocation lookups
    try {
      const wdWorker = new Worker(
        new URL('./workers/workplace-distance.worker.ts', import.meta.url),
        { type: 'module' },
      );
      const wdClient = new WorkplaceDistanceClient(wdWorker);
      const wdCache = new WorkplaceDistanceCache(wdClient);
      this.simLoop.setWorkplaceDistanceCache(wdCache);
    } catch {
      // Worker not available (e.g. test environment) — falls back to sync Dijkstra
    }
    // Restore abandonment stress from loaded save
    const extra = (loadedState as unknown as { _extra?: import('./core/save/Serializer').DeserializedExtra } | undefined)?._extra;
    if (extra?.abandonmentStress) {
      this.simLoop.abandonmentStress = extra.abandonmentStress;
    }
    if (extra?.transferHistory) {
      this.simLoop.setTransferHistory(extra.transferHistory);
    }
    // elevationData is restored after elevationManager is initialized (below)
    this.simLoop.onTerrainChanged = () => {
      this.dirty.terrain = true;
      // Power and water coverage is recomputed on the slow cycle, and a change
      // there is exactly what makes a zoned cell start or stop being able to
      // develop — so the diagnosis tint has to follow it. This is the case that
      // went unseen: connect a road to the grid and the cells that were dark
      // yellow have to stop being dark yellow.
      this.invalidateZoneBlockers();
    };
    // Fine-grained building callbacks — incremental O(1) updates,
    // no need to set dirty.buildings (avoids redundant full rebuild)
    this.simLoop.onBuildingAdded = (x, y, zoneType, level) => {
      // 密度不在回呼裡，但格子上的 buildingId 知道 —— 同一個物件同時帶著
      // level 與 density（core/building/types.ts）。少了它，辦公區 15 人與
      // 160 人的建築會用同一個高度渲染（BUG-220）。
      const density = getBuildingType(this.state.grid.getCell(x, y)?.buildingId ?? 0)?.density ?? 'LOW';
      this.buildingRenderer.addBuilding(x, y, zoneType, density, level, false);
      this.buildingRenderer.removeZoneOverlay(x, y);
      this.dirty.terrain = true;
    };
    this.simLoop.onBuildingRemoved = (x, y) => {
      this.buildingRenderer.removeBuilding(x, y);
      // Otherwise a badge for a building that no longer exists keeps blinking
      // over bare ground until the next slow-cycle refresh.
      this.utilityWarningsDirty = true;
    };
    this.simLoop.onBuildingUpdated = (x, y, zoneType, level, burned, abandoned) => {
      const density = getBuildingType(this.state.grid.getCell(x, y)?.buildingId ?? 0)?.density ?? 'LOW';
      this.buildingRenderer.updateBuilding(x, y, zoneType, density, level, burned, abandoned);
    };
    // Sync light spots when facility operational status changes (power/water dependency)
    this.simLoop.transferTracker.onDataChanged = () => {
      if (this.selectedTransferRoute) {
        this.selectTransferRoute(this.selectedTransferRoute);
      }
    };
    this.simLoop.onFacilityOperationalChanged = (changes) => {
      for (const { x, y, operational } of changes) {
        if (operational) this.buildingRenderer.addLightSpot(x, y);
        else this.buildingRenderer.removeLightSpot(x, y);
      }
    };
    // When a bus route is dissolved (stop removed → <2 stops), clean up TrafficSimulation vehicles
    this.state.bus.onRouteDissolvedHook = (routeId) => {
      this.state.traffic.removeBusVehicles(routeId);
    };
    this.elevationManager = new ElevationManager();
    if (extra?.elevationData) {
      this.elevationManager.fromJSON(extra.elevationData as any);
    }
    this.roadBuilder = new RoadBuilder(this.state.grid, undefined, this.elevationManager);
    this.railNetwork = new RailNetwork();
    this.railBuilder = new RailBuilder(this.state.grid, this.railNetwork, this.elevationManager);
    // The rail network goes in because demolition sends every elevated cell
    // here, elevated railways included.
    this.elevatedRoadBuilder = new ElevatedRoadBuilder(
      this.state.grid, this.elevationManager, null, this.railNetwork,
    );
    this.elevatedRailBuilder = new ElevatedRailBuilder(this.state.grid, this.elevationManager, this.railNetwork);
    this.simLoop.setElevationManager(this.elevationManager);
    this.roadLookup = new UnifiedRoadLookup(this.state.grid, this.elevationManager);
    this.simLoop.setRoadLookup(this.roadLookup);
    this.state.shopping.setRoadLookup(this.roadLookup);
    this.state.power.setRoadLookup(this.roadLookup);
    this.state.water.setRoadLookup(this.roadLookup);
    this.state.sewage.setRoadLookup(this.roadLookup);
    this.state.garbage.setRoadLookup(this.roadLookup);
    this.state.deathCare.setRoadLookup(this.roadLookup);
    this.state.rail.setRailNetwork(this.railNetwork);
    this.levelCrossingSystem = new LevelCrossingSystem();
    // Pedestrians must respect closed barriers too. PedestrianManager's blocking
    // logic and PedestrianState.WAITING_CROSSING were fully implemented and unit
    // tested, but nothing ever supplied a lookup — the constructor call in
    // SimulationLoop passed a literal null with a comment saying Game.ts would
    // connect it, and Game.ts never did. Pedestrians walked straight through
    // closed level crossings in front of oncoming trains (BUG-105).
    this.state.pedestrianManager.setLevelCrossings(this.levelCrossingSystem);
    this.zoneManager = new ZoneManager(this.state.grid);
    this.zoneManager.setElevationManager(this.elevationManager);

    // 設定渡輪系統的水域網格（A* 水面導航）
    const grid = this.state.grid;
    this.state.ferry.setWaterGrid({
      width: grid.width,
      height: grid.height,
      isWater: (x: number, y: number) => isWater(grid, x, y),
    });

    // Defer heavy init to async initPhases() for real loading progress
    this._container = container;
    this._loadedState = loadedState;
    this._mapSize = mapSize;
  }

  private _container!: HTMLElement;
  private _loadedState?: GameState;
  private _mapSize!: number;

  /** Build the ordered list of initialization steps.
   *  Each step has a label and a function to execute.
   *  Steps with sub-progress pass a callback to report 0-1 within the step. */
  private buildInitSteps(): Array<{ label: string; run: (onSub?: (ratio: number) => void) => void | Promise<void> }> {
    const loadedState = this._loadedState;
    const mapSize = this._mapSize;
    const container = this._container;
    const steps: Array<{ label: string; run: (onSub?: (ratio: number) => void) => void | Promise<void> }> = [];

    if (loadedState) {
      steps.push({ label: 'Setting up roads...', run: () => {
        rebuildRailNetworkFromGrid(this.state.grid, this.railNetwork);
        // Elevated track is never written to the grid, so the grid scan above
        // cannot see it — without this a bridge vanishes from the routing graph
        // on every load, and rail cannot cross water at all (BUG-065).
        rebuildElevatedRailNetwork(this.elevationManager, this.railNetwork);
      }});
      steps.push({ label: 'Preparing city services...', run: () => {
        this.recalculateAllRoadCoverage();
      }});
      steps.push({ label: 'Connecting utilities...', run: () => {
        this.state.power.calculateDemand(this.state.grid);
        this.state.power.calculateCoverage(this.state.grid);
        this.state.water.calculateDemand(this.state.grid);
        this.state.water.calculateCoverage(this.state.grid);
      }});
      steps.push({ label: 'Planning traffic routes...', run: async (onSub) => {
        // Discard warmup's counters — the step runner only awaits completion.
        await this.simLoop.warmup(0.2, onSub);
      }});
    } else {
      steps.push({ label: 'Creating landscape...', run: () => {
        generateTerrain(
          this.state.grid,
          this.mapConfig?.seed,
          this.mapConfig ? resolveTerrainConfig(this.mapConfig) : undefined,
        );
      }});
    }

    steps.push({ label: 'Preparing graphics...', run: () => {
      this.sceneManager = new SceneManager(container);
      this.terrainRenderer = new TerrainRenderer();
      this.roadRenderer = new RoadRenderer();
      this.buildingRenderer = new BuildingRenderer();
      this.vehicleRenderer = new VehicleRenderer();
      this.pedestrianRenderer = new PedestrianRenderer();
      this.trafficLightRenderer = new TrafficLightRenderer();
      this.overlayRenderer = new OverlayRenderer();
      this.transportRouteRenderer = new TransportRouteRenderer();
      this.metroTunnelRenderer = new MetroTunnelRenderer();
      this.trackRenderer = new TrackRenderer();
      this.elevatedRoadRenderer = new ElevatedRoadRenderer();
      this.levelCrossingRenderer = new LevelCrossingRenderer();
      this.weatherRenderer = new WeatherRenderer(this.sceneManager, mapSize);
    }});

    steps.push({ label: 'Building your city...', run: () => {
      this.terrainRenderer.build(this.sceneManager.scene, this.state.grid);
      this.vehicleRenderer.build(this.sceneManager.scene);
      // 車輛的 mesh 是 frustumCulled = false（`InstancedMesh` 整組共用一個
      // 包圍盒，three.js 沒辦法逐台判斷），所以逐台的視錐判斷得自己做，
      // 否則滿載的 2000 台每一台每一幀都要算頂點，即使鏡頭在城市另一頭。
      this.vehicleRenderer.setCullCamera(this.sceneManager.camera);
      this.pedestrianRenderer.build(this.sceneManager.scene);
      this.transportRouteRenderer.build(this.sceneManager.scene);
      this.metroTunnelRenderer.build(this.sceneManager.scene);
      this.gridCursor = new GridCursor(this.sceneManager.scene, mapSize, mapSize);
      this.placementPreview = new PlacementPreview(
        this.sceneManager.scene,
        this.buildingRenderer,
        (x, y) => this.state.grid.getCell(x, y)?.elevation ?? 0,
      );
      this.highlightManager = new HighlightManager(
        this.sceneManager.scene,
        (x, y) => this.state.grid.getCell(x, y)?.elevation ?? 0,
      );
    }});

    if (loadedState) {
      steps.push({ label: 'Checking the city over...', run: () => {
        // Ask the question rather than trusting that every removal path
        // cleaned up after itself. Each of BUG-056, BUG-086, BUG-119 and
        // BUG-164 was one path that did not, and a save carries the damage
        // forward for ever. Only ever removes; never invents a building.
        const report = reconcileGameState(this.state);
        if (!isClean(report)) {
          console.warn('[load] reconciled a save with dangling references:', report);
        }
      }});
    }

    steps.push({ label: 'Almost ready...', run: () => {
      this.sceneManager.setCameraTarget(mapSize / 2, mapSize / 2);
      const loadedMilestone = getMilestone(this.state.citizens.getPopulation());
      this.lastMilestoneId = loadedMilestone?.id ?? null;
      // Deriving this from the CURRENT population alone means a save taken after
      // a population dip replays every milestone on the way back up — the same
      // defect BUG-094 fixed within a session, surviving across the save
      // boundary. The high-water mark is persisted, so take the greater of the
      // two and stay correct for saves written before this field existed
      // (BUG-123).
      this.highestMilestonePop = Math.max(
        loadedMilestone?.populationRequired ?? 0,
        (loadedState as unknown as { _extra?: { highestMilestonePop?: number } } | undefined)
          ?._extra?.highestMilestonePop ?? 0,
      );
      this.setupInput(container);
      this.sceneManager.onUpdate((dt) => this.update(dt));
      this.sceneManager.start();
    }});

    return steps;
  }

  /** Async phased initialization. Runs each step with a requestAnimationFrame
   *  between steps so the browser can repaint the loading progress.
   *  Steps with sub-progress report granular updates within a step.
   *  @param onProgress called with (percentage, label) as progress updates */
  async initPhases(onProgress?: (pct: number, label: string) => void): Promise<void> {
    const steps = this.buildInitSteps();
    const stepSize = 100 / steps.length;
    for (let i = 0; i < steps.length; i++) {
      const basePct = Math.round(i * stepSize);
      const step = steps[i]!;
      onProgress?.(basePct, step.label);
      await new Promise(r => requestAnimationFrame(r));
      const result = step.run((subRatio) => {
        const subPct = Math.round(basePct + subRatio * stepSize);
        onProgress?.(subPct, step.label);
      });
      if (result instanceof Promise) await result;
    }
  }

  private setupInput(_container: HTMLElement): void {
    const canvas = this.sceneManager.getCanvas();

    canvas.addEventListener('mousemove', (e) => {
      // Middle-button drag → orbit camera
      if (e.buttons & 4) {
        this.sceneManager.orbitCamera(e.movementX * CAMERA_INPUT.ORBIT_SENSITIVITY, e.movementY * CAMERA_INPUT.ORBIT_SENSITIVITY);
        return;
      }
      // 右鍵拖曳，或 space + 左鍵拖曳 → 平移相機。
      //
      // 右鍵這條以前只存在於 mousedown 裡一個空的 if 加一句「handled in
      // mousemove」的註解，而 mousemove 從來沒有處理過它（BUG-236）。
      if ((e.buttons & 2) || (this.spacePanning && (e.buttons & 1))) {
        const view = this.sceneManager.camera.top - this.sceneManager.camera.bottom;
        const p = dragToPan(e.movementX, e.movementY, view, canvas.clientHeight);
        this.sceneManager.panCamera(p.x, p.z);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
      this.gridCursor.update(this.raycaster, this.groundPlane);
      this.updatePreviewLine();
      this.updatePlacementPreview();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.spacePanning) {
        // Clamp drag start to map bounds (start point always inside map)
        const w = this.state.grid.width, h = this.state.grid.height;
        this.dragStart = {
          x: Math.max(0, Math.min(w - 1, this.gridCursor.gridX)),
          y: Math.max(0, Math.min(h - 1, this.gridCursor.gridY)),
        };
        this.updatePlacementPreview();
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.dragStart) {
        this.handleToolAction(
          this.dragStart.x, this.dragStart.y,
          this.gridCursor.gridX, this.gridCursor.gridY,
        );
        this.dragStart = null;
        this.clearPreviewLine();
        this.updatePlacementPreview();
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sceneManager.zoomCamera(e.deltaY * CAMERA_INPUT.ZOOM_SENSITIVITY);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      // Prevent default for F1-F6 (overlay toggles)
      if (/^f[1-6]$/i.test(e.key)) e.preventDefault();
      // PageUp/PageDown: adjust elevation level during elevated drag
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        if (this.placementMode === 'elevated' && this.isDragBuildTool()) {
          this.elevationLevel = e.key === 'PageUp'
            ? Math.min(3, this.elevationLevel + 1)
            : Math.max(1, this.elevationLevel - 1);
          this.updatePreviewLine();
          this.onUIUpdate?.();
        }
        return;
      }
      // Space: ignore if focus is on an input element
      if (e.key === ' ') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        this.spacePanning = true;
        canvas.style.cursor = 'grab';
        return;
      }
      this.keys.add(e.key.toLowerCase());
      this.handleKeyDown(e.key.toLowerCase());
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spacePanning = false;
        canvas.style.cursor = '';
        return;
      }
      this.keys.delete(e.key.toLowerCase());
    });
  }

  private handleKeyDown(key: string): void {
    // Data-driven tool selection
    const toolBinding = KEY_TO_TOOL[key];
    if (toolBinding) { this.setTool(toolBinding); return; }

    // Data-driven overlay toggle
    const overlayBinding = KEY_TO_OVERLAY[key];
    if (overlayBinding) { this.toggleOverlay(overlayBinding); return; }

    switch (key) {
      case 'q': this.sceneManager.rotateCamera(-Math.PI / 4); break;
      case 'e': this.sceneManager.rotateCamera(Math.PI / 4); break;
      case 'escape': this.setTool('select'); this.dragStart = null; break;
      case 'r': this.cycleRotation(); break;
      case 'p': this.togglePause(); break;
      case '+':
      case '=': this.changeSpeed(1); break;
      case '-': this.changeSpeed(-1); break;
    }
  }

  private handleToolAction(x1: number, y1: number, x2: number, y2: number): void {
    // Only road/rail tools allow endpoint beyond map edge; clamp for everything else
    const isRoadOrRail = TOOL_TO_ROAD_TYPE[this.currentTool] !== undefined || this.currentTool === 'rail_track';
    if (!isRoadOrRail) {
      const w = this.state.grid.width, h = this.state.grid.height;
      x1 = Math.max(0, Math.min(w - 1, x1));
      y1 = Math.max(0, Math.min(h - 1, y1));
      x2 = Math.max(0, Math.min(w - 1, x2));
      y2 = Math.max(0, Math.min(h - 1, y2));
    }
    switch (this.currentTool) {
      case 'select':
        this.handleSelectClick(x1, y1);
        break;
      case 'demolish': {
        // Demolish elevated segments first across entire drag area
        const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
        let anyElevatedRemoved = false;
        const elevatedKeys: string[] = [];
        for (let dy = minY; dy <= maxY; dy++) {
          for (let dx = minX; dx <= maxX; dx++) {
            if (this.elevationManager.hasElevatedSegment(dx, dy)) {
              const level = this.elevationManager.getHighestLevel(dx, dy);
              if (level > 0) elevatedKeys.push(`${dx},${dy},${level}`);
              this.elevatedRoadBuilder.removeElevated(dx, dy);
              anyElevatedRemoved = true;
            }
          }
        }
        if (anyElevatedRemoved) {
          this.dirty.tracks = true;
        }
        // Then demolish ground-level items (markAllDirty called inside)
        const demolishedRoadCells = this.collectRoadCells(x1, y1, x2, y2);
        const { evictedCitizenIds, buildingCells } = this.demolish(x1, y1, x2, y2);
        // 必須呼叫：workplace 距離的路網圖以 commuteCache.roadGeneration 為鍵
        // 快取（SimulationLoop.getCellGraph），而 ElevationManager 自己沒有
        // 事件機制。少了這一行，拆掉的橋還留在圖裡，而且是靜默的 —— 市民只是
        // 「莫名其妙還走得到已經不存在的路」。見
        // simulation/__tests__/ElevatedRoadInvalidatesGraph.test.ts。
        this.simLoop.markLaneGraphDirty([...elevatedKeys, ...demolishedRoadCells, ...buildingCells]);
        // Restore incremental AFTER demolish's markAllDirty (which sets full rebuild)
        if (anyElevatedRemoved) {
          // Normalize "x,y,level" keys to "x,y" for ground road renderer
          const groundKeys = elevatedKeys.map(k => { const { x, y } = parsePosKeyUnsafe(k); return toPosKey(x, y); });
          this.dirty.elevatedRoadsFull = false;
          this.dirty.markElevatedCellsDirty(elevatedKeys);
          this.dirty.markRoadCellsDirty(groundKeys);
        }
        this.audioManager.playSfx(SoundType.DEMOLISH);
        break;
      }
      case 'district':
        this.paintDistrict(x1, y1, x2, y2);
        this.audioManager.playSfx(SoundType.ZONE);
        break;
      default: {
        // Data-driven road building (OCP: add new road types in TOOL_TO_ROAD_TYPE)
        if (TOOL_TO_ROAD_TYPE[this.currentTool] !== undefined) {
          if (this.placementMode === 'elevated') {
            const result = this.elevatedRoadBuilder.buildElevatedRoad(
              { x: x1, y: y1 }, { x: x2, y: y2 },
              this.currentRoadType, this.state.budget.funds, this.elevationLevel,
            );
            this.handleBuildResult(result, 'elevated road', () => {
              if (result.affectedCells) {
                // 必須呼叫：理由同拆除那一處 —— 圖以 roadGeneration 為鍵，
                // 少了它蓋好的橋不會進圖，市民莫名其妙找不到工作。
                this.simLoop.markLaneGraphDirty(result.affectedCells, true);
                this.dirty.markElevatedCellsDirty(result.affectedCells);
                // Ramp connects to ground → update ground road visuals at affected positions
                this.dirty.markRoadCellsDirty(result.affectedCells);
              }
            });
          } else {
            const result = this.roadBuilder.buildRoad(
              { x: x1, y: y1 }, { x: x2, y: y2 },
              this.currentRoadType,
              this.state.budget.funds,
            );
            this.handleBuildResult(result, 'road', () => {
              const allAffected = [...(result.affectedCells ?? []), ...(result.demolishedCells ?? [])];
              this.simLoop.markLaneGraphDirty(allAffected, true);
              this.roadCoverageDirty = true;
              this.dirty.markRoadCellsDirty(allAffected);
              if (result.demolishedCells) {
                for (const pos of result.demolishedCells) {
                  this.state.citizens.evictBuilding(pos, this.state.clock.tick);
                  const [px, py] = pos.split(',').map(Number);
                  this.buildingRenderer.removeBuilding(px!, py!);
                }
              }
              // buildRoad also clears zoneType on zoned-but-EMPTY cells, and those
              // are deliberately not reported in demolishedCells (no building was
              // destroyed). Nothing then removed their overlay instance: the road
              // surface is only 0.5-0.95 wide against a 0.9 overlay quad, so a
              // coloured fringe stayed visible along the new road until the next
              // rezone or demolish happened to call rebuildZoneOverlays.
              // removeZoneOverlay is O(1) and a no-op for cells without one
              // (BUG-111).
              for (const pos of result.affectedCells ?? []) {
                const [px, py] = pos.split(',').map(Number);
                this.buildingRenderer.removeZoneOverlay(px!, py!);
              }
            });
            this.dirty.crossings = true;
            this.dirty.trafficLights = true;
            this.dirty.terrain = true;
            // A new road changes NO_ROAD and ROAD_TOO_SMALL for everything
            // within reach of it — including the block that sent the player
            // here to build it.
            this.invalidateZoneBlockers();
          }
          break;
        }
        // Rail track building
        if (this.currentTool === 'rail_track') {
          if (this.placementMode === 'elevated') {
            const result = this.elevatedRailBuilder.buildElevatedTrack(
              { x: x1, y: y1 }, { x: x2, y: y2 },
              this.state.budget.funds, this.elevationLevel,
            );
            this.handleBuildResult(result, 'elevated track');
            this.dirty.tracks = true;
          } else {
            const result = this.railBuilder.buildTrack(
              { x: x1, y: y1 }, { x: x2, y: y2 },
              this.state.budget.funds,
            );
            this.handleBuildResult(result, 'track', () => {
              if (result.demolishedCells) {
                for (const pos of result.demolishedCells) {
                  this.state.citizens.evictBuilding(pos, this.state.clock.tick);
                  const [px, py] = pos.split(',').map(Number);
                  this.buildingRenderer.removeBuilding(px!, py!);
                }
                this.simLoop.markLaneGraphDirty(result.demolishedCells, true);
              }
              // Same as the road path: buildTrack clears zoneType on
              // zoned-but-EMPTY cells too, and those are not in
              // demolishedCells, so their overlay quad outlived the zone
              // (BUG-111). removeZoneOverlay is O(1) and a no-op without one.
              for (const pos of result.affectedCells ?? []) {
                const [px, py] = pos.split(',').map(Number);
                this.buildingRenderer.removeZoneOverlay(px!, py!);
              }
            });
            this.dirty.tracks = true;
            this.dirty.crossings = true;
            this.dirty.terrain = true;
            this.invalidateZoneBlockers();
          }
          break;
        }
        const zoneType = TOOL_TO_ZONE[this.currentTool];
        if (zoneType !== undefined) {
          this.applyZone(x1, y1, x2, y2, zoneType);
          this.audioManager.playSfx(SoundType.ZONE);
          break;
        }
        const infraType = TOOL_TO_INFRA[this.currentTool];
        if (infraType) {
          this.placeInfrastructure(x1, y1, infraType);
          break;
        }
        const transportType = TOOL_TO_TRANSPORT[this.currentTool];
        if (transportType) {
          this.placeTransportStop(x1, y1, transportType);
          break;
        }
        break;
      }
    }
    this.onUIUpdate?.();
  }

  private markAllDirty(): void {
    this.dirty.roads = true;
    this.dirty.elevatedRoadsFull = true;
    this.dirty.tracks = true;
    this.dirty.crossings = true;
    this.dirty.terrain = true;
    this.dirty.trafficLights = true;
    this.dirty.overlay = true;
  }

  /** Check funds and deduct if sufficient. Returns false with notification if insufficient (DRY). */
  private tryDeductFunds(cost: number): boolean {
    if (this.state.budget.funds < cost) {
      this.showNotification(`Insufficient funds (need $${cost})`, 3);
      return false;
    }
    this.state.budget.funds -= cost;
    return true;
  }

  /** Handle build result: deduct cost on success, show notification on failure (DRY). */
  private handleBuildResult(
    result: { success: boolean; cost?: number; reason?: string },
    label: string,
    onSuccess?: () => void,
  ): void {
    if (result.success) {
      if (result.cost) this.state.budget.funds -= result.cost;
      onSuccess?.();
      this.audioManager.playSfx(SoundType.BUILD);
    } else if (!result.success && result.reason) {
      this.showNotification(`Cannot build ${label}: ${getBuildReasonMessage(result.reason)}`);
    }
  }

  /**
   * Everything that must be forgotten when a building leaves a cell.
   *
   * Shared by demolish() and applyZone(). They used to do slightly different
   * things: rezoning never cleared the deathcare and garbage per-position
   * queues, so a body or a rubbish pile stayed pending at an address that no
   * longer had a building, permanently occupying a hearse/truck slot and
   * counting toward the uncollected-garbage pollution penalty.
   */
  private forgetBuildingAt(x: number, y: number, posKey: string): number[] {
    const evicted = this.state.citizens.evictBuilding(posKey, this.state.clock.tick);
    this.buildingRenderer.removeBuilding(x, y);
    // Abandonment stress is keyed by position, not by building identity, so a
    // replacement building inherits the pressure that killed the last one
    // (BUG-087).
    this.simLoop.clearBuildingState(x, y);
    this.state.deathCare.clearPendingAt(x, y);
    this.state.garbage.clearPendingAt(x, y);
    return evicted;
  }

  private applyZone(x1: number, y1: number, x2: number, y2: number, zoneType: ZoneType): void {
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    // Which cells the rezone will ACTUALLY clear. Deciding that here with a
    // local copy of the condition ignored setZone's three placement guards, so
    // rezoning a block whose road had been pulled up evicted and un-rendered
    // every building while leaving them on the grid — see RezonePlan.
    const evictedIds: number[] = [];
    const buildingCells = planRezone(
      this.state.grid, this.zoneManager, { minX, minY, maxX, maxY }, zoneType,
    );
    for (const posKey of buildingCells) {
      const [px, py] = posKey.split(',').map(Number);
      evictedIds.push(...this.forgetBuildingAt(px!, py!, posKey));
    }
    if (buildingCells.length > 0) {
      this.simLoop.markLaneGraphDirty(buildingCells, true);
    }
    this.zoneManager.setZoneRect({ x: minX, y: minY }, { x: maxX, y: maxY }, zoneType);
    this.refreshZoneOverlays();
    this.dirty.terrain = true;
  }

  /**
   * Why an empty zoned cell is not developing, for the overlay tint and the
   * selection panel.
   *
   * A cell that can never develop used to be drawn exactly like one waiting its
   * turn. The information — isPowered / isWatered / road reach / demand — all
   * existed; nothing carried it to the screen.
   */
  private zoneBlockerDeps = (): ZoneBlockerDeps => ({
    isPowered: (cx: number, cy: number) => this.state.power.isPowered(cx, cy),
    isWatered: (cx: number, cy: number) => this.state.water.isSupplied(cx, cy),
    rciDemand: this.state.rciDemand,
    canBuildHere: (cx: number, cy: number, zoneType: ZoneType) => {
      const d = this.state.districts.getDistrictAt(cx, cy);
      return !d || this.state.policies.canBuildInDistrict(d.id, zoneType);
    },
  });

  private zoneBlockerAt = (x: number, y: number) =>
    getZoneBlocker(this.state.grid, x, y, this.zoneBlockerDeps());

  /**
   * City-wide blocker counts, cached until something can change them.
   *
   * summariseZoneBlockers walks every cell and runs two (2r+1)² neighbourhood
   * scans per empty zoned cell. The selection panel polls at ~6 Hz, so calling
   * it per poll put a full-grid sweep on the main thread six times a second for
   * as long as the panel was open — on a large city, hundreds of thousands of
   * allocations per second to redraw a number that only moves when the map or
   * the utility networks do.
   */
  private zoneBlockerSummary: Record<ZoneBlocker, number> | null = null;

  private getZoneBlockerSummary(): Record<ZoneBlocker, number> {
    if (!this.zoneBlockerSummary) {
      this.zoneBlockerSummary = summariseZoneBlockers(this.state.grid, this.zoneBlockerDeps());
    }
    return this.zoneBlockerSummary;
  }

  /**
   * How many OTHER empty zoned cells share this blocker. The summary counts
   * the selected cell itself, and the panel labels the number "Also affected".
   */
  private countOtherCellsBlockedBy(blocker: ZoneBlocker | null): number {
    if (!blocker) return 0;
    return Math.max(0, this.getZoneBlockerSummary()[blocker] - 1);
  }

  /**
   * Mark the zone diagnosis stale. Every edit that can change any blocker's
   * answer has to call this — not just the ones that add or remove a zone.
   * Laying the road, building the power plant and switching a district policy
   * are precisely the actions the overlay just told the player to take, so a
   * tint that survives them is worse than no tint at all.
   */
  private invalidateZoneBlockers(): void {
    this.zoneOverlaysDirty = true;
    this.zoneBlockerSummary = null;
    // Outage badges answer the same question one step later in a building's
    // life, and move on exactly the same events.
    this.utilityWarningsDirty = true;
  }

  /** Set when a building's power or water supply may have changed. */
  private utilityWarningsDirty = false;

  private utilityWarningDeps() {
    return {
      isPowered: (x: number, y: number) => this.state.power.isPowered(x, y),
      isWatered: (x: number, y: number) => this.state.water.isSupplied(x, y),
    };
  }

  private refreshUtilityWarnings(): void {
    this.buildingRenderer.setUtilityWarnings(
      this.sceneManager.scene,
      collectBuildingUtilityWarnings(this.state.grid, this.utilityWarningDeps()),
    );
  }


  /** The district modal writes straight to PolicyManager; nothing else sees it. */
  notifyDistrictPolicyChanged(): void {
    this.invalidateZoneBlockers();
  }

  /** Rebuild the zone overlays with a fresh blocker diagnosis. */
  private refreshZoneOverlays(): void {
    this.zoneBlockerSummary = null;
    this.buildingRenderer.rebuildZoneOverlays(
      this.sceneManager.scene, this.state.grid, this.zoneBlockerAt,
    );
  }

  private collectRoadCells(x1: number, y1: number, x2: number, y2: number): string[] {
    const cells: string[] = [];
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.roadType !== RoadType.NONE) {
          cells.push(`${x},${y}`);
        }
      }
    }
    return cells;
  }

  private demolish(x1: number, y1: number, x2: number, y2: number): { evictedCitizenIds: number[]; buildingCells: string[] } {
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    const demolished = new Set<string>(); // track already-demolished multi-cell buildings
    const evictCells: string[] = []; // cells whose citizens need eviction
    const affectedRoadCells: string[] = []; // road cells affected by demolition
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        const primary = cell && isInfrastructureBuilding(cell.buildingId)
          ? findPrimaryCell(this.state.grid, x, y) : null;
        const action = classifyDemolishCell(cell, primary);

        switch (action.action) {
          case 'skip': break;
          case 'multi_cell_infra': {
            const key = `${action.primaryX},${action.primaryY}`;
            if (!demolished.has(key)) {
              demolished.add(key);
              this.removeInfraService(action.infraType, action.primaryX, action.primaryY);
              this.buildingRenderer.removeInfrastructure(this.sceneManager.scene, action.primaryX, action.primaryY);
              removeInfraFromGrid(this.state.grid, x, y);
            }
            break;
          }
          case 'single_cell_infra':
            this.removeInfraService(action.infraType, x, y);
            this.buildingRenderer.removeInfrastructure(this.sceneManager.scene, x, y);
            this.state.grid.setCell(x, y, { buildingId: 0, reserved: 0 });
            break;
          case 'regular':
            if (cell && cell.buildingId !== 0) evictCells.push(`${x},${y}`);
            if (action.hasTrack) this.railBuilder.removeTrack(x, y);
            if (cell && cell.roadType !== RoadType.NONE) {
              const removed = this.roadBuilder.removeRoad(x, y);
              affectedRoadCells.push(...removed);
            }
            this.state.grid.setCell(x, y, {
              zoneType: ZoneType.NONE, buildingId: 0, reserved: 0,
            });
            this.state.deathCare.clearPendingAt(x, y);
            this.state.garbage.clearPendingAt(x, y);
            break;
        }
      }
    }
    // Evict citizens from demolished zone buildings and clear abandonment stress
    const evictedCitizenIds: number[] = [];
    for (const pos of evictCells) {
      const [px, py] = pos.split(',').map(Number);
      evictedCitizenIds.push(...this.forgetBuildingAt(px!, py!, pos));
    }
    if (affectedRoadCells.length > 0) {
      this.roadCoverageDirty = true;
    }
    this.markAllDirty();
    // Mark specific road cells dirty AFTER markAllDirty (which sets roads=true for full rebuild).
    // When road cells are known, downgrade to incremental by clearing full flag first.
    if (affectedRoadCells.length > 0) {
      this.dirty.roads = false;
      this.dirty.markRoadCellsDirty(affectedRoadCells);
    }
    this.refreshZoneOverlays();

    // Refresh overlay cache after demolish
    const activeOverlay = this.overlayRenderer.getOverlay();
    if (activeOverlay !== OverlayType.NONE) {
      this.computeOverlayHighlightCells(activeOverlay);
    }
    return { evictedCitizenIds, buildingCells: evictCells };
  }

  /** Map InfraType → ServiceVehicleType for types that have patrol vehicles. */
  private static readonly INFRA_TO_SERVICE_VEHICLE: Partial<Record<InfraType, import('./core/traffic/TrafficSimulation').ServiceVehicleType>> = {
    police: 'police', fire: 'fire', hospital: 'health', garbage: 'garbage',
  };

  /** Dispatch to data-driven service removal. Callers provide resolved coordinates. */
  private removeInfraService(infraType: InfraType, cx: number, cy: number): void {
    const actions = INFRA_SERVICE_ACTIONS[infraType];
    if (actions) {
      actions.remove(this.state as InfraServiceContext, cx, cy);
    }
    this.recalculateServiceCoverage(infraType);
    // Immediately remove service vehicles if this facility type has them
    const svType = Game.INFRA_TO_SERVICE_VEHICLE[infraType];
    if (svType) {
      this.simLoop.removeServiceVehicles(svType);
    }
  }

  private paintDistrict(x1: number, y1: number, x2: number, y2: number): void {
    // Create a new district if none is active
    if (!this.activeDistrictId) {
      const count = this.state.districts.getAllDistricts().length;
      const d = this.state.districts.createDistrict(`District ${count + 1}`);
      this.activeDistrictId = d.id;
    }
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        this.state.districts.addCellToDistrict(this.activeDistrictId, x, y);
      }
    }
    this.dirty.terrain = true;
    // Painting a district brings its build policies to bear on these cells.
    this.invalidateZoneBlockers();
  }

  createNewDistrict(name?: string): string {
    const count = this.state.districts.getAllDistricts().length;
    const d = this.state.districts.createDistrict(name ?? `District ${count + 1}`);
    this.activeDistrictId = d.id;
    return d.id;
  }

  private placeInfrastructure(x: number, y: number, type: InfraType): void {
    const cfg = getInfraConfig(type);
    if (!cfg) return;

    // Validate multi-cell placement
    const groundwaterFn = (cx: number, cy: number) => getGroundwaterLevel(this.state.grid, cx, cy);
    const check = canPlaceInfra(this.state.grid, x, y, type, this.currentRotation, groundwaterFn);
    if (!check.ok) {
      // Name what was refused. Road failures already read "Cannot build road:
      // ..."; the placement paths printed the bare reason, so a water plant
      // rejected inland just said "No groundwater here" with no subject.
      this.showNotification(formatBuildFailure(cfg.name, check.reason), 3);
      return;
    }

    if (!this.tryDeductFunds(cfg.cost)) return;

    // Auto-demolish zone buildings in the footprint (evict citizens)
    const { w, h } = getRotatedSize(cfg.width, cfg.height, this.currentRotation);
    const footprint: string[] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        footprint.push(`${cx},${cy}`);
        const cell = this.state.grid.getCell(cx, cy);
        if (cell && cell.buildingId !== 0 && isZoneBuilding(cell.buildingId)) {
          this.state.citizens.evictBuilding(`${cx},${cy}`, this.state.clock.tick);
          this.buildingRenderer.removeBuilding(cx, cy);
          this.state.grid.setCell(cx, cy, { buildingId: 0, reserved: 0, zoneType: 0 });
        }
        // placeInfraOnGrid clears zoneType on EVERY footprint cell, not only
        // the ones that held a building — so a facility dropped on zoned-but-
        // empty land left its overlay quads drawn over the footprint until
        // some later edit rebuilt them (BUG-111, in a third path).
        this.buildingRenderer.removeZoneOverlay(cx, cy);
      }
    }

    // Place on grid (multi-cell)
    placeInfraOnGrid(this.state.grid, x, y, type, this.currentRotation);
    // 讓人行道圖看見這棟樓。蓋設施刻意不呼叫 markLaneGraphDirty（設施不改變
    // 路網），所以這裡不通知就沒有人會通知 —— 樓沒有門節點，行人穿過它走。
    this.simLoop.applyBuildingChange(footprint);

    // Register with service layer at top-left coordinates (matches expandFootprint expectation)
    const actions = INFRA_SERVICE_ACTIONS[type];
    if (actions) {
      actions.place(this.state as InfraServiceContext, x, y);
    }

    // Immediately recalculate coverage for road-based services so overlay updates
    this.recalculateServiceCoverage(type);
    // The power plant or water tower the overlay just asked for.
    this.invalidateZoneBlockers();

    this.audioManager.playSfx(SoundType.BUILD);
    this.buildingRenderer.addInfrastructure(this.sceneManager.scene, x, y, type, ROTATION_RESERVED[this.currentRotation]);

    // Refresh overlay if one is active for this service
    const activeOverlay = this.overlayRenderer.getOverlay();
    if (activeOverlay !== OverlayType.NONE) {
      this.setOverlay(activeOverlay);
    }
  }

  /**
   * Immediately recalculate road-based coverage after placing/removing a service building.
   *
   * 電、水、汙水在 switch 外面無條件重算。它們跟其他服務不一樣：這裡問的不是
   * 「這種設施的服務範圍變了嗎」，而是「剛動過的那一格有沒有水電」—— 蓋任何東西
   * 都會讓一個新的格子出現，而它不在上一次算好的集合裡（BUG-284）。
   */
  private recalculateServiceCoverage(infraType: InfraType): void {
    const grid = this.state.grid;
    this.simLoop.recalculateUtilityCoverage();
    switch (infraType) {
      case 'police': this.state.police.recalculateCoverage(grid); break;
      case 'fire': this.state.fire.recalculateCoverage(grid); break;
      case 'garbage': this.state.garbage.recalculateCoverage(grid); break;
      case 'hospital': this.state.health.recalculateCoverage(grid); break;
      case 'school':
      case 'school_high':
      case 'school_univ': this.state.education.recalculateCoverage(grid); break;
      case 'cemetery': this.state.deathCare.recalculateCoverage(grid); break;
      case 'park': this.state.parks.updateConnectedParks(grid); break;
      case 'sewage': this.state.sewage.updateConnectedPlants(grid); break;
    }
  }

  /** Recalculate all road-based service coverage after road topology changes. */
  private recalculateAllRoadCoverage(): void {
    const grid = this.state.grid;
    this.state.police.recalculateCoverage(grid);
    this.state.fire.recalculateCoverage(grid);
    this.state.garbage.recalculateCoverage(grid);
    this.state.health.recalculateCoverage(grid);
    this.state.education.recalculateCoverage(grid);
    this.state.deathCare.recalculateCoverage(grid);
    this.state.parks.updateConnectedParks(grid);
    this.state.sewage.updateConnectedPlants(grid);
  }

  private placeTransportStop(x: number, y: number, type: 'bus' | 'metro' | 'rail' | 'ferry' | 'airport'): void {
    const cell = this.state.grid.getCell(x, y);
    const airportInfra = AIRPORT_TOOL_INFRA[this.currentTool];
    const infraCfg = getInfraConfig(airportInfra ?? TRANSPORT_TO_INFRA_TYPE[type]!);
    const check = canPlaceTransportStop(type, cell, this.state.grid, x, y);
    if (!check.ok) {
      this.showNotification(formatBuildFailure(infraCfg?.name ?? type, check.reason), 3);
      return;
    }
    const cost = infraCfg?.cost ?? 500;
    if (!this.tryDeductFunds(cost)) return;

    if (type === 'bus') {
      const stop = this.state.bus.addStop(x, y);
      // Set adjacent road cell for lane pathfinding
      const adj = findAdjacentRoadCell(this.state.grid, x, y);
      if (adj) {
        stop.roadX = adj.roadX;
        stop.roadY = adj.roadY;
      }
    } else if (type === 'metro') {
      this.state.metro.addStation(x, y);
    } else if (type === 'rail') {
      const station = this.state.rail.buildStation(x, y, this.state.grid);
      if (!station) {
        this.state.budget.funds += cost;
        this.showNotification('Train station must be built on rail track');
        return;
      }
    } else if (type === 'ferry') {
      const waterChecker = { isWater: (fx: number, fy: number) => isShorePosition(this.state.grid, fx, fy) };
      const dock = this.state.ferry.addDock(x, y, waterChecker);
      if (!dock) {
        this.state.budget.funds += cost;
        this.showNotification('Ferry dock must be placed on shore (land next to water)');
        return;
      }
    } else if (type === 'airport') {
      if (!this.placeAirport(x, y, cost)) return;
      return; // skip the default single-cell setCell below
    }
    placeTransportStopOnGrid(
      this.state.grid, x, y,
      infraCfg?.buildingId ?? getInfraBuildingId('bus_stop'),
      ROTATION_RESERVED[this.currentRotation]!,
    );
    // The bare setCell this replaced left zoneType in place and never told the
    // renderer, so a stop dropped on zoned-but-empty land kept its overlay quad
    // drawn underneath it — BUG-111, in a fourth path.
    this.buildingRenderer.removeZoneOverlay(x, y);
    this.invalidateZoneBlockers();
    // 站牌在人行道圖裡就是一棟建築的四個門 —— 行人靠門走進去，涵蓋範圍也從門
    // 往外量。這裡不通知的話，新站牌要等玩家隨手動一次道路才進得了圖，在那之前
    // 它服務不到任何人。刻意不走 markLaneGraphDirty：設施不改變路網。
    this.simLoop.applyBuildingChange([`${x},${y}`]);
    // 面板馬上就會被問「這個站有沒有水電」，而水電是查快取的，六個 tick 才重算
    // 一次（BUG-284）。刻意不塞進 applyBuildingChange：那支連建商蓋房子也會走，
    // 每次成長 tick 都多跑一次全圖 BFS 太貴，而玩家沒點任何東西也看不到差別。
    this.simLoop.recalculateUtilityCoverage();
    const infraType = airportInfra ?? TRANSPORT_TO_INFRA_TYPE[type]!;
    this.buildingRenderer.addInfrastructure(this.sceneManager.scene, x, y, infraType, ROTATION_RESERVED[this.currentRotation]);
    this.audioManager.playSfx(SoundType.BUILD);
  }

  /** Place an airport at (x,y). Returns true on success, false (with funds refunded) on failure. */
  private placeAirport(x: number, y: number, cost: number): boolean {
    const airportSize: AirportSize = getAirportToolSize(this.currentTool);
    const infraType = AIRPORT_TOOL_INFRA[this.currentTool]!;

    // Validate footprint — standard canPlaceInfra (correct dimensions from InfraConfig)
    const check = canPlaceInfra(this.state.grid, x, y, infraType, this.currentRotation);
    if (!check.ok) {
      this.state.budget.funds += cost;
      this.showNotification(formatBuildFailure(getInfraConfig(infraType)?.name ?? 'Airport', check.reason));
      return false;
    }

    const pop = this.state.citizens.getPopulation();
    const result = this.state.airport.build(x, y, airportSize, pop, this.currentRotation);
    if (!result) {
      this.state.budget.funds += cost;
      const req = this.state.airport.getPopulationRequired(airportSize);
      this.showNotification(`Airport requires population >= ${req.toLocaleString()}`);
      return false;
    }

    // Place on grid — standard placeInfraOnGrid (correct dimensions from InfraConfig)
    placeInfraOnGrid(this.state.grid, x, y, infraType, this.currentRotation);
    // placeInfraOnGrid clears zoneType on every footprint cell; nothing told
    // the renderer, so up to 54 overlay quads stayed drawn under the airport
    // until some later edit happened to rebuild them (BUG-111, third path).
    const { w: aw, h: ah } = getRotatedSize(
      getInfraConfig(infraType)?.width ?? 1, getInfraConfig(infraType)?.height ?? 1,
      this.currentRotation,
    );
    const airportCells: string[] = [];
    for (let dy = 0; dy < ah; dy++) {
      for (let dx = 0; dx < aw; dx++) {
        this.buildingRenderer.removeZoneOverlay(x + dx, y + dy);
        airportCells.push(`${x + dx},${y + dy}`);
      }
    }
    // 同 placeInfra：不通知的話這片機場在人行道圖裡不存在。
    this.simLoop.applyBuildingChange(airportCells);
    this.simLoop.recalculateUtilityCoverage();
    this.invalidateZoneBlockers();
    this.audioManager.playSfx(SoundType.BUILD);
    this.buildingRenderer.addInfrastructure(this.sceneManager.scene, x, y, infraType, ROTATION_RESERVED[this.currentRotation]);
    return true;
  }

  private update(dt: number): void {
    this.elapsedTime += dt;

    // Camera movement
    const panSpeed = CAMERA_INPUT.PAN_SPEED * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.sceneManager.panCamera(0, -panSpeed);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.sceneManager.panCamera(0, panSpeed);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.sceneManager.panCamera(-panSpeed, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.sceneManager.panCamera(panSpeed, 0);

    // 縮到遠景就把矮物件與懸挑整層關掉（見 DETAIL_LOD）。每幀的成本是兩個
    // 比較，狀態沒變時直接返回。
    this.buildingRenderer.updateDetailLOD(
      this.sceneManager.camera.top - this.sceneManager.camera.bottom,
    );

    // Simulation tick
    if (!this.paused) {
      const tickInterval = this.state.clock.getTickInterval() / 1000;
      this.tickAccumulator += dt;
      // Cap accumulator to prevent massive backlog when tab regains focus
      if (this.tickAccumulator > tickInterval * CAMERA_INPUT.ACCUMULATOR_CAP_FACTOR) {
        this.tickAccumulator = tickInterval * CAMERA_INPUT.ACCUMULATOR_CAP_FACTOR;
      }
      if (this.tickAccumulator >= tickInterval) {
        this.tickAccumulator -= tickInterval;
        this.simLoop.tick();

        // Push occupancy ratios to building renderer for night lighting
        if (this.simLoop.occupancyRatios.size > 0 && this.state.clock.tick % CAMERA_INPUT.BUILDING_SYNC_INTERVAL === 0) {
          this.buildingRenderer.updateOccupancy(this.simLoop.occupancyRatios);
        }

        // Deferred road coverage recalculation (batched to next slow tick)
        if (this.roadCoverageDirty && this.state.clock.tick % 6 === 0) {
          this.recalculateAllRoadCoverage();
          this.roadCoverageDirty = false;
        }

        // Milestone detection
        this.checkMilestone();

        // Random disaster events (small chance per tick)
        this.checkRandomDisaster();

        // Auto-save (off main thread via SaveWorker)
        if (this.autoSaver.shouldSave(this.state.clock.tick)) {
          const snapshot = snapshotGameState(this.state, { abandonmentStress: this.simLoop.abandonmentStress, elevationManager: this.elevationManager, transferHistory: this.simLoop.getTransferHistory(), highestMilestonePop: this.highestMilestonePop });
          if (this.saveWorker) {
            this.saveWorker.postMessage({ type: 'SAVE', snapshot, slotId: 0, name: 'AutoSave', population: this.state.citizens.getPopulation() });
          } else {
            // Fallback: synchronous save if worker unavailable. The empty
            // `.catch(() => {})` this replaces was the same silence as the
            // missing worker listener, one layer down.
            saveGame(0, 'AutoSave', JSON.stringify(snapshot), this.state.citizens.getPopulation())
              .then(() => { this.lastSaveFailure = null; })
              .catch((err: unknown) => {
                const failure = classifySaveError(err);
                this.lastSaveFailure = {
                  type: 'SAVE_COMPLETE', ok: false, slotId: 0,
                  kind: failure.kind, error: failure.message, detail: failure.detail,
                };
                console.error('[save] autosave fallback failed:', failure.detail);
                this.showNotification(failure.message, 12);
              });
          }
        }

        // Update ambient audio with current city state
        this.audioManager.updateAmbientState(
          this.state.citizens.getPopulation(),
          this.state.traffic.vehicles.length
        );

        this.onUIUpdate?.();
      }
    }

    this.rebuildDirtySubsystems();

    // Update traffic light colors every frame (values() avoids array spread)
    this.trafficLightRenderer.update(this.state.trafficLights.values());
    // Update level crossing lights/gates animation every frame
    this.levelCrossingRenderer.update(this.elapsedTime, this.levelCrossingSystem.getCrossings());

    // Update cursor color based on tool
    this.updateCursorColor();

    this.updateVehiclesAndTransport(dt);

    // Animate terrain (water)
    this.terrainRenderer.update(dt);

    // Notification timeout
    if (this.notificationTimer > 0) {
      this.notificationTimer -= dt;
      if (this.notificationTimer <= 0) {
        this.notification = null;
        this.onUIUpdate?.();
      }
    }

    // Update weather visuals (day/night cycle, rain/snow, seasonal colors)
    const gameSpeed = this.paused ? 0 : this.speed;
    this.weatherRenderer.update(dt, gameSpeed, this.state.clock.getSeason());

    // Update night glow (building light spots + street lamps)
    const sunI = this.weatherRenderer.sunIntensity;
    this.buildingRenderer.update(sunI, dt);
    this.buildingRenderer.updateUtilityWarnings(this.sceneManager.camera.quaternion);
    this.roadRenderer.update(sunI);
    this.elevatedRoadRenderer.update(sunI);
  }

  /** Rebuild renderer meshes for each dirty subsystem, then clear dirty flags. */
  /** Set when utility coverage moved, so the zone-blocker tint can follow it. */
  private zoneOverlaysDirty = false;

  private rebuildDirtySubsystems(): void {
    const d = this.dirty;
    if (this.zoneOverlaysDirty) {
      this.zoneOverlaysDirty = false;
      this.refreshZoneOverlays();
    }
    if (this.utilityWarningsDirty) {
      this.utilityWarningsDirty = false;
      this.refreshUtilityWarnings();
    }
    // 通勤圖層畫的是模擬迴圈每隔一段時間算出來的統計，不是格子上的欄位 ——
    // 沒有任何 dirty 旗標會因為它更新而亮起來。統計換過一版就重建一次，否則
    // 載入後開圖層拿到的是空快照，而蓋了捷運之後顏色也不會跟著變。
    const commuteVersion = this.simLoop.getCommuteStatsVersion();
    if (
      commuteVersion !== this.lastCommuteStatsVersion
      && this.overlayRenderer.getOverlay() === OverlayType.COMMUTE
    ) {
      this.lastCommuteStatsVersion = commuteVersion;
      this.setOverlay(OverlayType.COMMUTE);
    }

    const anyDirty = d.hasRoadChanges || d.hasElevatedChanges || d.tracks || d.crossings || d.buildings || d.terrain || d.trafficLights;
    if (!anyDirty) return;

    if (d.hasRoadChanges) {
      const dirtyCells = d.dirtyRoadCells;
      if (dirtyCells === null) {
        this.roadRenderer.build(this.sceneManager.scene, this.state.grid);
      } else if (dirtyCells.size > 0) {
        this.roadRenderer.updateCells(this.state.grid, [...dirtyCells]);
      }
      if (this.viewMode !== ViewMode.NORMAL) this.roadRenderer.setViewMode(this.viewMode);
      d.roads = false;
    }
    if (d.hasElevatedChanges) {
      const elevCells = d.elevatedDirtyCells;
      if (elevCells === null) {
        this.elevatedRoadRenderer.build(this.sceneManager.scene, this.state.grid, this.elevationManager);
      } else if (elevCells.length > 0) {
        this.elevatedRoadRenderer.updateCells(this.sceneManager.scene, this.state.grid, this.elevationManager, elevCells);
      }
      d.clearElevated();
    }
    if (d.tracks) {
      this.trackRenderer.build(this.sceneManager.scene, this.state.grid);
      // Elevated roads/rails are rebuilt on either road or track dirty
      this.elevatedRoadRenderer.build(this.sceneManager.scene, this.state.grid, this.elevationManager);
      if (this.viewMode !== ViewMode.NORMAL) this.trackRenderer.setViewMode(this.viewMode);
      d.tracks = false;
    }
    if (d.crossings) {
      this.levelCrossingSystem.rebuildFromGrid(this.state.grid);
      this.levelCrossingRenderer.build(this.sceneManager.scene, this.levelCrossingSystem.getCrossings());
      if (this.viewMode !== ViewMode.NORMAL) this.levelCrossingRenderer.setViewMode(this.viewMode);
      d.crossings = false;
    }
    if (d.buildings) {
      // build() redraws the zone overlays too, so it needs the diagnosis as
      // much as rebuildZoneOverlays does. Omitting it here meant every overlay
      // came back untinted on game start, after a save load and after a
      // disaster — and, because this branch runs after the zoneOverlaysDirty
      // one above, it overwrote a correct tint in any frame where both fired.
      this.buildingRenderer.build(this.sceneManager.scene, this.state.grid, this.zoneBlockerAt);
      if (this.viewMode !== ViewMode.NORMAL) this.buildingRenderer.setViewMode(this.viewMode, this.sceneManager.scene);
      d.buildings = false;
    }
    if (d.terrain) {
      this.terrainRenderer.refreshColors();
      d.terrain = false;
    }
    if (d.trafficLights) {
      syncTrafficLightsWithGrid(this.state.grid, this.state.trafficLights);
      this.trafficLightRenderer.build(this.sceneManager.scene, this.state.trafficLights.getLights());
      d.trafficLights = false;
    }

    // Refresh active overlay when relevant subsystems rebuilt
    const currentOverlay = this.overlayRenderer.getOverlay();
    if (currentOverlay && currentOverlay !== OverlayType.NONE) {
      this.setOverlay(currentOverlay);
    }
    // Re-apply highlight after rebuild (new meshes lose aHighlight)
    this.updatePlacementPreview();
  }

  /** Advance vehicles, animate transport systems, and update vehicle renderers. */
  private updateVehiclesAndTransport(dt: number): void {
    // Advance edge-based vehicles every render frame (independent of tick)
    if (!this.paused) {
      const scaledDt = dt * this.speed;
      this.state.trafficLights.tick(scaledDt);
      this.state.traffic.advanceEdgeVehicles(
        scaledDt, this._canAdvance, this._getSpeedLimit,
      );
    }

    // Collect road vehicle positions for rendering (single pass, reusable array)
    const vehicleData = this.vehicleDataScratch;
    vehicleData.length = 0;
    for (const v of this.state.traffic.vehicles) {
      if (v.arrived) continue;
      const pos = this.state.traffic.getVehiclePositionOnEdges(v);
      if (!pos) continue;
      const heading = this.state.traffic.getVehicleHeadingOnEdges(v);
      const type = v.serviceType
        ? SERVICE_TYPE_TO_VEHICLE_TYPE[v.serviceType]
        : v.busState
          ? 'bus' as VehicleData['type']
          : (this.vehicleTypes.get(v.id) ?? (() => { const t = classifyVehicleType(v.length); this.vehicleTypes.set(v.id, t); return t; })());
      // Determine elevation + pitch from vehicle position
      const { elevation, pitch } = this.computeVehicleElevation(v, pos, heading);
      vehicleData.push({ id: v.id, x: pos.x, y: pos.y, heading, type, laneOffset: 0, elevation: elevation || undefined, pitch: pitch || undefined });
    }

    // Collect transport system vehicles (rail/ferry — bus is now in TrafficSimulation)
    const transportVehicles = collectTransportVehicles({
      rail: this.state.rail, ferry: this.state.ferry,
    });

    // Animate ferry and train (render-side LERP, independent of tick)
    const simSpeed = this.paused ? 0 : this.state.clock.speed;
    this.ferryAnimator.update(dt, simSpeed, this.state.ferry, transportVehicles);
    this.trainAnimator.update(dt, simSpeed, this.state.rail, transportVehicles);
    this.airplaneAnimator.update(dt, simSpeed, this.state.airport, transportVehicles);

    // Level crossing proximity trigger (inline collection, no filter+map)
    const trainPositions = this.trainPosScratch;
    trainPositions.length = 0;
    for (const v of transportVehicles) {
      if (v.type === 'rail_train') trainPositions.push({ x: v.x, y: v.y });
    }
    this.levelCrossingSystem.update(dt, simSpeed, trainPositions);

    // Merge road + transport vehicles and render (reusable array, no concat)
    const allVehicles = this.allVehiclesScratch;
    allVehicles.length = 0;
    for (const v of vehicleData) allVehicles.push(v);
    for (const v of transportVehicles) allVehicles.push(v as VehicleData);
    this.vehicleRenderer.update(allVehicles, this.weatherRenderer.sunIntensity, this.elapsedTime, simSpeed);

    // Advance pedestrians every render frame (same pattern as vehicles)
    if (!this.paused) {
      const scaledDt = dt * this.speed;
      this.state.pedestrianManager.tick(scaledDt);
    }

    // Render pedestrians with camera culling
    const camTarget = this.sceneManager.getCameraTarget();
    const pedData = cullPedestrians(
      this.state.pedestrianManager.getPedestrians(),
      camTarget.x, camTarget.z,
    );
    this.pedestrianRenderer.update(pedData);

    // Update transport route lines
    const routeData = collectTransportRoutes({
      bus: this.state.bus, metro: this.state.metro, rail: this.state.rail, ferry: this.state.ferry,
    });
    this.transportRouteRenderer.update(filterRoutesForViewMode(routeData, this.viewMode));

    // Update metro tunnel + train animation
    const vmOp = VIEW_MODE_OPACITY[this.viewMode];
    const metroLines = this.state.metro.getLines();
    const metroLineData = metroLines.map(line => {
      const stops = line.stops.map(s => ({ x: s.x, y: s.y }));
      return { lineId: line.id, stops, segments: computeTunnelSegments(stops), trainCount: line.vehicles };
    });
    const metroSpeedMult = this.paused ? 0 : this.state.clock.speed;
    this.metroTunnelRenderer.update(
      metroLineData, this.state.metro.getStations(), vmOp.metroTunnel, dt * metroSpeedMult,
    );

    // Clean up stale vehicle rendering state (reuses Set from TrafficSimulation)
    const activeIds = this.state.traffic.getActiveVehicleIds();
    for (const id of this.vehicleTypes.keys()) {
      if (!activeIds.has(id)) {
        this.vehicleTypes.delete(id);
      }
    }
  }

  private updateCursorColor(): void {
    this.gridCursor.setColor(TOOL_CURSOR_COLORS[this.currentTool] ?? 0xffffff);
    // Demolish tool gets higher opacity for red highlight preview
    this.gridCursor.setOpacity(this.currentTool === 'demolish' ? 0.6 : 0.3);
  }

  isRoadTool(tool?: ToolType): boolean {
    return TOOL_TO_ROAD_TYPE[tool ?? this.currentTool] !== undefined;
  }

  isRailTool(tool?: ToolType): boolean {
    const t = tool ?? this.currentTool;
    return t === 'rail_track';
  }

  /** True if the current tool uses drag-to-build (road or rail). */
  isDragBuildTool(tool?: ToolType): boolean {
    return this.isRoadTool(tool) || this.isRailTool(tool);
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.currentRotation = 0; // reset rotation when switching tools
    // Reset placement mode when switching away from road/rail tools
    if (!this.isDragBuildTool(tool)) {
      this.placementMode = 'ground';
      this.elevationLevel = 1;
    }
    // Road subtypes set the roadType (data-driven lookup)
    const roadType = TOOL_TO_ROAD_TYPE[tool];
    if (roadType !== undefined) this.currentRoadType = roadType;
    // Update cursor size for infrastructure tools
    this.updateCursorSize();
    // Auto-switch overlay when selecting infrastructure tools
    const autoOverlay = TOOL_TO_OVERLAY[tool];
    if (autoOverlay) {
      this.setOverlay(autoOverlay);
    }
    this.updatePlacementPreview();
    this.onUIUpdate?.();
  }

  setPlacementMode(mode: PlacementMode): void {
    this.placementMode = mode;
    if (mode === 'ground') this.elevationLevel = 1;
    this.onUIUpdate?.();
  }

  getPlacementMode(): PlacementMode { return this.placementMode; }
  getElevationLevel(): number { return this.elevationLevel; }
  getElevationManager(): ElevationManager { return this.elevationManager; }

  /**
   * Ramp ground-side direction lookup.
   * Maps rampAscendDirection flag → the direction that is at ground level (rampLevel - 1).
   * Derived from the bit→vector mapping in the elevation formula.
   */
  private static readonly RAMP_GROUND_SIDE: Record<number, string> = {
    8: 'west',   // WEST  ascend → ground side = west
    4: 'east',   // EAST  ascend → ground side = east
    2: 'north',  // SOUTH ascend → ground side = north
    1: 'south',  // NORTH ascend → ground side = south
  };

  /** Compute vehicle elevation and pitch from its edgePath and XZ position. */
  private computeVehicleElevation(
    v: { edgePath: { from: { cellKey: string; direction?: string }; to: { cellKey: string } }[]; edgeIndex: number },
    pos: { x: number; y: number },
    heading: number,
  ): { elevation: number; pitch: number } {
    if (v.edgePath.length === 0) return { elevation: 0, pitch: 0 };

    const edgeIdx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[edgeIdx]!;
    let cellLevel = parseLevelFromKey(edge.from.cellKey);

    // If from cell is a ramp, determine the effective level based on which side
    // the from point exits from. Ground side = rampLevel - 1, elevated side = rampLevel.
    // This prevents vehicles from "flying" on cross-intersection edges that start
    // from a ramp's ground side (e.g., descending ramp → ground L-bend → north road).
    if (cellLevel > 0 && edge.from.direction) {
      const { x: fx, y: fy } = parsePosKeyUnsafe(edge.from.cellKey);
      const fromRamp = this.elevationManager.get(fx, fy, cellLevel);
      if (fromRamp?.isRamp) {
        const groundSide = Game.RAMP_GROUND_SIDE[fromRamp.rampAscendDirection];
        cellLevel = edge.from.direction === groundSide ? cellLevel - 1 : cellLevel;
      }
    }

    const gx = Math.round(pos.x);
    const gy = Math.round(pos.y);

    // Check if vehicle is on a ramp cell
    const { seg: rampSeg, level: rampLevel } = this.findRampAt(gx, gy, cellLevel);

    if (rampSeg && rampLevel > 0) {
      const ascend = rampSeg.rampAscendDirection;
      const ax = (ascend & 0b1000) ? 1 : (ascend & 0b0100) ? -1 : 0;
      const ay = (ascend & 0b0010) ? 1 : (ascend & 0b0001) ? -1 : 0;
      const along = (pos.x - gx) * ax + (pos.y - gy) * ay;
      const elevation = (rampLevel - 0.5) + along;

      const RAMP_ANGLE = Math.atan2(0.6, 1.0);
      const hx = Math.cos(heading);
      const hy = -Math.sin(heading);
      const dot = hx * ax + hy * ay;
      const pitch = dot > 0 ? RAMP_ANGLE : dot < 0 ? -RAMP_ANGLE : 0;

      return { elevation, pitch };
    }

    return { elevation: cellLevel, pitch: 0 };
  }

  /** Find ramp segment at position, preferring the given level. */
  private findRampAt(gx: number, gy: number, preferLevel: number): { seg: import('./core/elevation/types').ElevatedSegment | null; level: number } {
    if (preferLevel > 0) {
      const seg = this.elevationManager.get(gx, gy, preferLevel);
      if (seg?.isRamp) return { seg, level: preferLevel };
    }
    for (let lv = 1; lv <= 3; lv++) {
      const seg = this.elevationManager.get(gx, gy, lv);
      if (seg?.isRamp) return { seg, level: lv };
    }
    return { seg: null, level: 0 };
  }


  toggleViewMode(mode: ViewMode = ViewMode.UNDERGROUND): void {
    const next = this.viewMode === mode ? ViewMode.NORMAL : mode;
    this.applyViewMode(next);
  }

  /** Apply a ViewMode to all renderers. */
  private applyViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.buildingRenderer.setViewMode(mode, this.sceneManager.scene);
    this.terrainRenderer.setViewMode(mode);
    this.roadRenderer.setViewMode(mode);
    this.elevatedRoadRenderer.setViewMode(mode);
    this.trackRenderer.setViewMode(mode);
    this.levelCrossingRenderer.setViewMode(mode);
    this.trafficLightRenderer.setViewMode(mode);
    this.vehicleRenderer.setViewMode(mode);
    this.weatherRenderer.setViewMode(mode);
    this.onUIUpdate?.();
  }

  /** Handle click in select mode: classify building and show details. */
  private handleSelectClick(x: number, y: number): void {
    const cell = this.state.grid.getCell(x, y);
    if (cell && cell.buildingId > 0) {
      const cls = classifyBuilding(cell.buildingId);
      switch (cls.category) {
        case 'zone': {
          const pLevel = this.state.pollution.getPollutionAt(x, y);
          this.selectedBuilding = {
            kind: 'zone', x, y,
            buildingType: cls.buildingType, zoneType: cell.zoneType,
            landValue: cell.landValue, pollution: cell.pollution,
            pollutionGround: pLevel.ground,
            pollutionWater: pLevel.water,
            pollutionNoise: pLevel.noise,
            serviceCoverage: cell.serviceCoverage,
            services: buildServiceStatus(this.state, x, y),
            abandonmentStress: this.simLoop.getAbandonmentStress(x, y),
            isAbandoned: cell.reserved === ABANDONED,
            workerCount: this.state.citizens.getCitizensByWorkplace(`${x},${y}`).length,
            workerCapacity: cls.buildingType.workers,
            taxIncome: calculateSingleBuildingIncome(buildIncomeCalcDeps(this.state), x, y, cell.buildingId),
            garbageLoadRatio: this.getGarbageLoadRatio(),
            hospitalLoadRatio: this.state.health.getLoadRatio(),
            policeLoadRatio: this.state.police.getLoadRatio(),
            fireLoadRatio: this.state.fire.getLoadRatio(),
            pendingDeaths: this.state.deathCare.getPendingDeathQueue().filter(d => d.x === x && d.y === y).length,
            pendingGarbage: this.state.garbage.getPendingGarbageQueue().filter(g => g.x === x && g.y === y).length,
          };
          this.applyViewMode(ViewMode.NORMAL);
          break;
        }
        case 'transport':
          this.selectTransportStop(x, y, cls.transportType);
          break;
        case 'infra': {
          const primary = findPrimaryCell(this.state.grid, x, y);
          const px = primary?.x ?? x;
          const py = primary?.y ?? y;
          const details = this.getInfraDetails(cls.config.type, px, py);
          this.selectedBuilding = {
            kind: 'infra', x, y, primaryX: px, primaryY: py,
            infraType: cls.config.type, name: cls.config.name,
            cost: cls.config.cost, details,
            hasPower: this.state.power.isPowered(px, py),
            hasWater: this.state.water.isSupplied(px, py),
          };
          this.applyViewMode(ViewMode.NORMAL);
          break;
        }
      }
    } else if (cell && cell.zoneType !== ZoneType.NONE) {
      // An empty zoned cell. This is the click a player makes when a block
      // refuses to develop, and it used to select nothing.
      const blocker = this.zoneBlockerAt(x, y);
      this.selectedBuilding = {
        kind: 'emptyZone', x, y,
        zoneType: cell.zoneType,
        blocker,
        reason: blocker ? ZONE_BLOCKER_MESSAGES[blocker] : 'Ready to develop',
        hasPower: this.state.power.isPowered(x, y),
        hasWater: this.state.water.isSupplied(x, y),
        sameBlockerCount: this.countOtherCellsBlockedBy(blocker),
      };
      this.applyViewMode(ViewMode.NORMAL);
    } else {
      this.selectedBuilding = null;
      this.applyViewMode(ViewMode.NORMAL);
    }
    this.audioManager.playSfx(SoundType.CLICK);
    this.onUIUpdate?.();
  }

  private selectTransportStop(x: number, y: number, type: TransportStopKind): void {
    const system = this.getTransportSystem(type);
    const stops = system?.getStops() ?? [];
    const stop = stops.find(s => s.x === x && s.y === y);
    const routes = system?.getRoutes() ?? [];
    const stopRoutes = stop ? routes.filter(r => r.stops.some(s => s.id === stop.id)) : [];
    const routeCount = stopRoutes.length;
    const vehicleCount = stopRoutes.reduce((sum, r) => sum + r.vehicles, 0);

    this.selectedBuilding = {
      kind: 'transport',
      x, y,
      transportType: type,
      name: STOP_NAMES[type],
      routes: routeCount,
      vehicles: vehicleCount,
      ridersPerDay: Math.round(stop?.smoothedDailyRiders ?? 0),
      hasPower: this.state.power.isPowered(x, y),
      hasWater: this.state.water.isSupplied(x, y),
    };

    this.applyViewMode(getTransportFocusMode(type));
  }

  /** Get the transport system for a given stop type via property lookup (OCP). */
  private getTransportSystem(type: TransportStopKind) {
    return this.state[type as keyof Pick<GameState, 'bus' | 'metro' | 'rail' | 'ferry'>];
  }

  private cycleRotation(): void {
    if (!this.isInfraTool(this.currentTool)) return;
    const rotations: Rotation[] = [0, 90, 180, 270];
    const idx = rotations.indexOf(this.currentRotation);
    this.currentRotation = rotations[(idx + 1) % 4] ?? 0;
    this.updateCursorSize();
    this.updatePlacementPreview();
    this.onUIUpdate?.();
  }

  private isInfraTool(tool: ToolType): boolean {
    return isInfraType(tool) || isAirportTool(tool);
  }

  private updateCursorSize(): void {
    const airportInfra = AIRPORT_TOOL_INFRA[this.currentTool];
    const cfg = airportInfra
      ? getInfraConfig(airportInfra)
      : isInfraType(this.currentTool) ? getInfraConfig(this.currentTool as InfraType) : null;
    if (cfg) {
      const { w, h } = getRotatedSize(cfg.width, cfg.height, this.currentRotation);
      this.gridCursor.setSize(w, h);
    } else {
      this.gridCursor.setSize(1, 1);
    }
  }

  /** Apply white highlight on the currently selected building (select tool). */
  private applySelectHighlight(): void {
    const sel = this.selectedBuilding;
    if (!sel) return;

    const cell = this.state.grid.getCell(sel.x, sel.y);
    if (!cell) return;

    const cells = sel.kind === 'infra'
      ? this.getMultiCellFootprint(sel.x, sel.y)
      : [{ x: sel.x, y: sel.y }];
    if (cells.length === 0) return;
    this.highlightManager.highlightCells(
      cells, 0xffffff,
      this.getAllHighlightMeshes(),
      this.buildingRenderer.buildingInfraGroups,
    );
  }

  /** Apply hover (bottom) → selection (top) for select tool. */
  private applySelectAndHoverHighlight(): void {
    // 1. Hover first (bottom layer within tool — may be overwritten by selection)
    const gx = this.gridCursor.gridX;
    const gy = this.gridCursor.gridY;
    const cell = this.state.grid.getCell(gx, gy);

    let isHoveringSelected = false;
    if (cell && cell.buildingId > 0 && this.selectedBuilding) {
      if (this.selectedBuilding.x === gx && this.selectedBuilding.y === gy) {
        isHoveringSelected = true;
      } else if (this.selectedBuilding.kind === 'infra') {
        const hoverPrimary = findPrimaryCell(this.state.grid, gx, gy);
        const selPrimary = findPrimaryCell(this.state.grid, this.selectedBuilding.x, this.selectedBuilding.y);
        if (hoverPrimary && selPrimary &&
          hoverPrimary.x === selPrimary.x && hoverPrimary.y === selPrimary.y) {
          isHoveringSelected = true;
        }
      }
    }

    if (cell && cell.buildingId > 0 && !isHoveringSelected) {
      const hoverCells = isInfrastructureBuilding(cell.buildingId)
        ? this.getMultiCellFootprint(gx, gy)
        : [{ x: gx, y: gy }];
      if (hoverCells.length > 0) {
        this.highlightManager.hoverHighlight(
          hoverCells, 0xffffff,
          this.getAllHighlightMeshes(),
          this.buildingRenderer.buildingInfraGroups, 0.3,
        );
      }
    }

    // 2. Selection on top (overwrites overlay + hover on selected cells)
    if (this.selectedBuilding) {
      this.applySelectHighlight();
    }
  }

  /** Collect all cells of a multi-cell building footprint (DRY). */
  private getMultiCellFootprint(x: number, y: number): { x: number; y: number }[] {
    const cells: { x: number; y: number }[] = [];
    forEachMultiCell(this.state.grid, x, y, (cx, cy) => cells.push({ x: cx, y: cy }));
    return cells;
  }

  /** Reusable highlight meshes array (sub-renderers cache their own, we just merge). */
  private _highlightMeshesScratch: (THREE.InstancedMesh | THREE.Mesh)[] = [];

  /** Collect all InstancedMeshes that support highlight (buildings + roads + tracks). */
  private getAllHighlightMeshes(): readonly (THREE.InstancedMesh | THREE.Mesh)[] {
    const arr = this._highlightMeshesScratch;
    arr.length = 0;
    for (const m of this.buildingRenderer.buildingMeshes) arr.push(m);
    for (const m of this.roadRenderer.highlightMeshes) arr.push(m);
    for (const m of this.trackRenderer.highlightMeshes) arr.push(m);
    return arr;
  }

  private updatePlacementPreview(): void {
    // Clear all highlights, then layer: overlay (base) → tool (top)
    this.highlightManager.clear();
    this.reapplyOverlayHighlight();

    if (this.isInfraTool(this.currentTool)) {
      const infraType = AIRPORT_TOOL_INFRA[this.currentTool] ?? this.currentTool as InfraType;
      const groundwaterFn = (cx: number, cy: number) => getGroundwaterLevel(this.state.grid, cx, cy);
      this.placementPreview.updateInfra(
        infraType,
        this.currentRotation,
        this.gridCursor.gridX,
        this.gridCursor.gridY,
        this.state.grid,
        this.state.budget.funds,
        groundwaterFn,
      );

      // Coverage preview overwrites overlay with merged data (existing + new)
      this.applyCoverageOverlay(infraType);
    } else if (this.currentTool === 'demolish') {
      if (this.dragStart) {
        this.highlightDragRange(0xff0000);
      } else {
        // Demolish hover: highlight multi-cell building footprint
        const gx = this.gridCursor.gridX;
        const gy = this.gridCursor.gridY;
        const cell = this.state.grid.getCell(gx, gy);
        if (cell && isInfrastructureBuilding(cell.buildingId)) {
          const cells = this.getMultiCellFootprint(gx, gy);
          if (cells.length > 0) {
            this.highlightManager.highlightCells(
              cells, 0xff0000,
              this.getAllHighlightMeshes(),
              this.buildingRenderer.buildingInfraGroups,
            );
          }
        }
      }
    } else if (this.dragStart && this.isZoneTool()) {
      this.highlightDragRange(ZONE_PREVIEW_COLORS[this.currentTool] ?? 0xffffff);
    } else if (this.dragStart && this.isDragBuildTool()) {
      // Road/rail drag preview is managed by updatePreviewLine — don't hide
    } else {
      this.placementPreview.hide();
      if (this.currentTool === 'select') {
        this.applySelectAndHoverHighlight();
      }
    }

    // Step 4: Transfer highlight — highest priority, overwrites hover on transfer buildings
    this.reapplyTransferHighlight();
  }

  /** Re-apply cached transfer route highlight (highest priority layer). */
  private reapplyTransferHighlight(): void {
    if (this.transferHighlightCells.length === 0) return;
    this.highlightManager.hoverHighlightGradient(
      this.transferHighlightCells,
      this.getAllHighlightMeshes(),
      this.buildingRenderer.buildingInfraGroups,
      1.0,
    );
  }

  /** Re-apply cached overlay building highlight (cheap: no grid traversal). */
  private reapplyOverlayHighlight(): void {
    if (this.overlayHighlightCells.length === 0) return;
    this.highlightManager.hoverHighlightGradient(
      this.overlayHighlightCells,
      this.getAllHighlightMeshes(),
      this.buildingRenderer.buildingInfraGroups,
      0.6,
    );
  }

  /** Highlight the drag-selected rectangular area with the given color (DRY). */
  private highlightDragRange(color: number): void {
    if (!this.dragStart) return;
    const minX = Math.min(this.dragStart.x, this.gridCursor.gridX);
    const maxX = Math.max(this.dragStart.x, this.gridCursor.gridX);
    const minY = Math.min(this.dragStart.y, this.gridCursor.gridY);
    const maxY = Math.max(this.dragStart.y, this.gridCursor.gridY);
    this.highlightManager.highlight(
      minX, minY, maxX, maxY, color,
      this.getAllHighlightMeshes(),
      this.buildingRenderer.buildingInfraGroups,
    );
  }

  // ── Coverage highlight (per-building gradient via HighlightManager) ──────

  /** 10-tier gradient: green → yellow → red (pre-computed hex values). */
  private static readonly COV_GRADIENT = (() => {
    const near = new THREE.Color(0x00e676);
    const mid = new THREE.Color(0xffeb3b);
    const far = new THREE.Color(0xff5252);
    const colors: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const c = new THREE.Color();
      if (t < 0.5) c.copy(near).lerp(mid, t * 2);
      else c.copy(mid).lerp(far, (t - 0.5) * 2);
      colors.push(c.getHex());
    }
    return colors;
  })();

  /**
   * Highlight buildings with per-instance gradient color when placing a civic service.
   * Garbage: only residential buildings. Police/Fire: all buildings.
   */
  private applyCoverageOverlay(infraType: InfraType): void {
    const cfg = getInfraConfig(infraType);
    if (!cfg) return;
    const gx = this.gridCursor.gridX;
    const gy = this.gridCursor.gridY;
    const pos = { x: gx, y: gy };
    const grid = this.state.grid;

    let coverageCells: Map<string, number> | null = null;
    let budget = 0;
    switch (infraType) {
      case 'police':
        coverageCells = this.state.police.previewCoverage(pos, grid, cfg.width, cfg.height);
        budget = ROAD_COVERAGE.POLICE_BUDGET;
        break;
      case 'fire':
        coverageCells = this.state.fire.previewCoverage(pos, grid, cfg.width, cfg.height);
        budget = ROAD_COVERAGE.FIRE_BUDGET;
        break;
      case 'garbage':
        coverageCells = this.state.garbage.previewCoverage(pos, grid, cfg.width, cfg.height);
        budget = ROAD_COVERAGE.GARBAGE_BUDGET;
        break;
      case 'hospital':
        coverageCells = this.state.health.previewCoverage(pos, grid, cfg.width, cfg.height);
        budget = ROAD_COVERAGE.HEALTH_BUDGET;
        break;
      case 'school':
        coverageCells = this.state.education.previewCoverage(pos, grid, 'elementary', cfg.width, cfg.height);
        budget = ROAD_COVERAGE.EDUCATION_ELEMENTARY_BUDGET;
        break;
      case 'school_high':
        coverageCells = this.state.education.previewCoverage(pos, grid, 'highschool', cfg.width, cfg.height);
        budget = ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET;
        break;
      case 'school_univ':
        coverageCells = this.state.education.previewCoverage(pos, grid, 'university', cfg.width, cfg.height);
        budget = ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET;
        break;
      case 'cemetery':
        coverageCells = this.state.deathCare.previewCoverage(pos, grid, cfg.width, cfg.height);
        budget = ROAD_COVERAGE.DEATHCARE_BUDGET;
        break;
      default:
        return;
    }

    if (!coverageCells || coverageCells.size === 0) return;

    // Filter to relevant buildings and compute per-cell gradient color
    const isGarbage = infraType === 'garbage';
    const gradientCells: { x: number; y: number; color: number }[] = [];

    for (const [key, cost] of coverageCells) {
      const i = key.indexOf(',');
      const cx = Number(key.slice(0, i));
      const cy = Number(key.slice(i + 1));
      const cell = grid.getCell(cx, cy);
      if (!cell || cell.buildingId === 0) continue;

      // Garbage: only residential. Police/Fire: all buildings.
      if (isGarbage) {
        if (!isResidentialZone(cell.zoneType)) continue;
      } else {
        if (!isZoneBuilding(cell.buildingId) && !isInfrastructureBuilding(cell.buildingId)) continue;
      }

      const ratio = Math.min(1, cost / budget);
      const tier = Math.min(9, Math.floor(ratio * 10));
      gradientCells.push({ x: cx, y: cy, color: Game.COV_GRADIENT[tier]! });
    }

    if (gradientCells.length > 0) {
      this.highlightManager.hoverHighlightGradient(
        gradientCells,
        this.getAllHighlightMeshes(),
        this.buildingRenderer.buildingInfraGroups,
        0.6,
      );
    }
  }

  private isZoneTool(): boolean {
    return TOOL_TO_ZONE[this.currentTool] !== undefined;
  }

  setOverlay(type: OverlayType): void {
    const data = this.buildOverlayData(type);
    const elevated = this.buildElevatedOverlayData(type);
    this.overlayRenderer.setOverlay(type, this.sceneManager.scene, this.state.grid, data, elevated);
    this.computeOverlayHighlightCells(type);
    this.updatePlacementPreview();
    this.onUIUpdate?.();
  }

  toggleOverlay(type: OverlayType): void {
    if (this.overlayRenderer.getOverlay() === type) {
      this.setOverlay(OverlayType.NONE);
    } else {
      this.setOverlay(type);
    }
  }

  private buildOverlayData(type: OverlayType): Map<string, number> | undefined {
    if (type === OverlayType.NONE) return undefined;
    const data = new Map<string, number>();
    // 通勤圖層的資料不在 GameState 上 —— 它是模擬迴圈每隔一段時間算出來的統計。
    const ctx: OverlayBuildContext = Object.assign(
      Object.create(this.state) as OverlayBuildContext,
      {
        commuteByHome: this.simLoop.getCommuteStats().byHome,
        commuteMax: COMMUTE_OVERLAY_MAX,
      },
    );
    this.state.grid.forEachCell((cell, x, y) => {
      const value = buildOverlayValue(ctx, type, cell, x, y);
      if (value > 0) data.set(`${x},${y}`, value);
    });
    return data;
  }

  private static readonly ELEVATED_LEVEL_HEIGHT = 0.6;

  private buildElevatedOverlayData(type: OverlayType): ElevatedOverlayCell[] | undefined {
    if (type !== OverlayType.TRAFFIC) return undefined;
    const entries = this.elevationManager.toJSON();
    if (entries.length === 0) return undefined;
    const cells: ElevatedOverlayCell[] = [];
    const traffic = this.state.traffic;
    const { TRAFFIC_LOG_FACTOR, DISPLAY_MAX } = OVERLAY_SCALE;
    for (const entry of entries) {
      if (entry.data.roadType === 0) continue;
      const flow = traffic.getSegmentDensity(`${entry.x},${entry.y},${entry.level}`);
      const value = flow > 0 ? Math.min(DISPLAY_MAX, Math.log2(1 + flow) * TRAFFIC_LOG_FACTOR) : 0;
      if (value > 0) {
        const isRamp = entry.data.isRamp;
        const height = isRamp
          ? (entry.level - 0.5) * Game.ELEVATED_LEVEL_HEIGHT + 0.1
          : entry.level * Game.ELEVATED_LEVEL_HEIGHT + 0.1;
        cells.push({
          x: entry.x,
          y: entry.y,
          height,
          value,
          isRamp,
          rampAscendDirection: entry.data.rampAscendDirection,
        });
      }
    }
    return cells.length > 0 ? cells : undefined;
  }

  // ── Coverage overlay: building highlight (green→yellow→red gradient) ──

  /** Get road-cost overlay info: cost map + budget for a given overlay type. */
  private getRoadCostOverlay(overlayType: OverlayType): { costMap: ReadonlyMap<string, number>; budget: number; residentialOnly: boolean } | null {
    switch (overlayType) {
      case OverlayType.POLICE: return { costMap: this.state.police.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.POLICE_BUDGET, residentialOnly: false };
      case OverlayType.FIRE: return { costMap: this.state.fire.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.FIRE_BUDGET, residentialOnly: false };
      case OverlayType.GARBAGE: return { costMap: this.state.garbage.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.GARBAGE_BUDGET, residentialOnly: true };
      case OverlayType.HEALTH: return { costMap: this.state.health.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.HEALTH_BUDGET, residentialOnly: false };
      case OverlayType.EDUCATION: return { costMap: this.state.education.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET, residentialOnly: false };
      default: return null;
    }
  }

  /** Compute and cache overlay building highlight cells. Applied every frame by reapplyOverlayHighlight(). */
  private computeOverlayHighlightCells(overlayType: OverlayType): void {
    this.overlayHighlightCells = [];

    /**
     * 通勤圖層：住宅**建築**依住戶的平均通勤時間上色，與警消覆蓋同一套語彙。
     *
     * 畫在建築上而不是地面上，是因為地面會被建築本身擋住 —— 密集住宅區看到的
     * 是屋頂，不是地上的顏色。
     *
     * 站牌另外標成青色。「這片紅色離最近的站有多遠」正是這張圖要回答的問題：
     * 沒有站的位置看到的紅色，就是「這裡缺一條線」。
     */
    if (overlayType === OverlayType.COMMUTE) {
      const byHome = this.simLoop.getCommuteStats().byHome;
      for (const [key, time] of byHome) {
        const i = key.indexOf(',');
        const cx = Number(key.slice(0, i));
        const cy = Number(key.slice(i + 1));
        const ratio = Math.min(1, time / COMMUTE_OVERLAY_MAX);
        const tier = Math.min(9, Math.floor(ratio * 10));
        this.overlayHighlightCells.push({ x: cx, y: cy, color: Game.COV_GRADIENT[tier]! });
      }
      for (const { system } of getTransitSystems(this.state)) {
        for (const stop of system.getStops()) {
          this.overlayHighlightCells.push({ x: stop.x, y: stop.y, color: 0x00e5ff });
        }
      }
      return;
    }

    // Road-based services: green→yellow→red gradient
    const roadInfo = this.getRoadCostOverlay(overlayType);
    if (roadInfo) {
      const { costMap, budget, residentialOnly } = roadInfo;
      if (costMap.size === 0) return;
      const grid = this.state.grid;
      for (const [key, cost] of costMap) {
        const i = key.indexOf(',');
        const cx = Number(key.slice(0, i));
        const cy = Number(key.slice(i + 1));
        const cell = grid.getCell(cx, cy);
        if (!cell || cell.buildingId === 0) continue;
        if (residentialOnly) {
          if (!isResidentialZone(cell.zoneType)) continue;
        } else {
          if (!isZoneBuilding(cell.buildingId) && !isInfrastructureBuilding(cell.buildingId)) continue;
        }
        const ratio = Math.min(1, cost / budget);
        const tier = Math.min(9, Math.floor(ratio * 10));
        this.overlayHighlightCells.push({ x: cx, y: cy, color: Game.COV_GRADIENT[tier]! });
      }
      return;
    }

    // Power overlay: 3-state building highlight (green/yellow/red)
    if (overlayType === 'power') {
      const power = this.state.power;
      const ratio = power.getSupplyRatio();
      this.state.grid.forEachCell((cell, x, y) => {
        if (cell.buildingId === 0) return;
        if (!isZoneBuilding(cell.buildingId) && !isInfrastructureBuilding(cell.buildingId)) return;
        let color: number;
        if (power.isPowered(x, y)) {
          color = 0x00e676; // green: powered
        } else if (ratio < 1 && power.isInCoverage(x, y)) {
          color = 0xffeb3b; // yellow: in coverage but underpowered
        } else {
          color = 0xff5252; // red: no coverage
        }
        this.overlayHighlightCells.push({ x, y, color });
      });
      return;
    }

    // Water overlay: 3-state building highlight (blue/yellow/red)
    if (overlayType === 'water') {
      const water = this.state.water;
      const ratio = water.getSupplyRatio();

      // A city with no plant yet has nothing to colour — and that is exactly
      // the city that needs help. A water plant needs groundwater, i.e. a cell
      // within GROUNDWATER_SEARCH_RANGE of water, and nothing grows at all
      // without water, so an inland start is unwinnable. The only feedback used
      // to be a toast on the click that failed, which says what is wrong but
      // not where to go instead. Selecting the water tool opens this overlay
      // (TOOL_TO_OVERLAY), so this is where the answer belongs.
      if (water.getPlants().length === 0) {
        const sites = findWaterPlantSites(this.state.grid);
        for (const s of sites) {
          this.overlayHighlightCells.push({ x: s.x, y: s.y, color: 0x00e5ff });
        }
        if (sites.length === 0) {
          this.showNotification(
            'Nowhere on this map has groundwater. A water plant must be within '
            + `${GROUNDWATER_SEARCH_RANGE} tiles of a river, lake or coast.`, 8,
          );
        }
        return;
      }
      this.state.grid.forEachCell((cell, x, y) => {
        if (cell.buildingId === 0) return;
        if (!isZoneBuilding(cell.buildingId) && !isInfrastructureBuilding(cell.buildingId)) return;
        let color: number;
        if (water.isSupplied(x, y)) {
          color = 0x42a5f5; // blue: supplied
        } else if (ratio < 1 && water.isInCoverage(x, y)) {
          color = 0xffeb3b; // yellow: in coverage but undersupplied
        } else {
          color = 0xff5252; // red: no coverage
        }
        this.overlayHighlightCells.push({ x, y, color });
      });
      return;
    }

    // Non-road services (park): single-color
    const fallbackColors: Partial<Record<OverlayType, number>> = {
      [OverlayType.PARK]: 0x4caf50,
    };
    const color = fallbackColors[overlayType];
    if (!color) return;
    const service = getCoverageService(this.state as any, overlayType);
    if (!service) return;
    this.state.grid.forEachCell((cell, x, y) => {
      if (!service.getCoverage(x, y)) return;
      if (cell.buildingId === 0) return;
      if (!isZoneBuilding(cell.buildingId) && !isInfrastructureBuilding(cell.buildingId)) return;
      this.overlayHighlightCells.push({ x, y, color });
    });
  }

  setOnUIUpdate(callback: () => void): void {
    this.onUIUpdate = callback;
  }

  /** Cheap identity key for selected building — no data refresh. */
  getSelectedBuildingKey(): string | null {
    const sel = this.selectedBuilding;
    return sel ? `${sel.kind}:${sel.x},${sel.y}` : null;
  }

  getState(): GameState {
    return this.state;
  }

  getAbandonmentStress(x: number, y: number): number {
    return this.simLoop.getAbandonmentStress(x, y);
  }

  // markTransitNetworkDirty() was removed from Game and from all ten of its
  // call sites. Requiring every transit mutation to remember an invalidation
  // call is exactly how the transfer graph went stale for the whole transit UI
  // (BUG-090); BaseTransportSystem now bumps its own version counter and
  // SimulationLoop compares it, so a new mutation site cannot forget.

  /** Create a bus route with traffic pathfinding. Returns the route or null if no path. */
  createBusRoute(stops: readonly TransportStop[], vehicleCount = 1): TransportRoute | null {
    this.simLoop.ensureLaneGraph();
    const lg = this.simLoop.laneGraph;
    const lookup = this.roadLookup;
    const route = this.state.bus.createRouteWithTraffic(
      [...stops],
      vehicleCount,
      (fx, fy, tx, ty) => findLanePath(lg, lookup, { x: fx, y: fy }, { x: tx, y: ty }),
      this.state.traffic,
    );
    return route;
  }

  /** Delete a bus route and remove its vehicles from TrafficSimulation. */
  deleteBusRoute(routeId: number): void {
    this.state.bus.deleteRouteWithTraffic(routeId, this.state.traffic);
  }

  /** Add one bus vehicle to a route in TrafficSimulation. */
  addBusVehicle(routeId: number): void {
    this.state.bus.addVehicleWithTraffic(routeId, this.state.traffic);
  }

  /** Remove one bus vehicle from a route in TrafficSimulation. */
  removeBusVehicle(routeId: number): void {
    this.state.bus.removeVehicleWithTraffic(routeId, this.state.traffic);
  }

  getToolType(): ToolType {
    return this.currentTool;
  }

  getAudioManager(): AudioManager {
    return this.audioManager;
  }

  private getGarbageLoadRatio(): number {
    const facs = this.state.garbage.getFacilities();
    const cap = facs.reduce((s, f) => s + f.capacity, 0);
    const uncollected = this.state.garbage.getUncollected();
    if (cap <= 0) return uncollected > 0 ? Infinity : 0;
    const load = facs.reduce((s, f) => s + f.currentLoad, 0) + uncollected;
    return load / cap;
  }

  private getInfraDetails(type: InfraType, cx: number, cy: number): Record<string, string | number> {
    return getInfraDetailsFromCtx(this.state as InfraDetailContext, type, cx, cy);
  }

  getSelectedBuilding(): SelectedBuilding | null {
    const sel = this.selectedBuilding;
    if (!sel) return null;

    if (sel.kind === 'infra') {
      return { ...sel, details: this.getInfraDetails(sel.infraType, sel.primaryX, sel.primaryY) };
    }

    if (sel.kind === 'transport') {
      const system = this.getTransportSystem(sel.transportType);
      const stops = system?.getStops() ?? [];
      const stop = stops.find(s => s.x === sel.x && s.y === sel.y);
      const routes = system?.getRoutes() ?? [];
      const stopRoutes = stop ? routes.filter(r => r.stops.some(s => s.id === stop.id)) : [];
      return {
        ...sel,
        routes: stopRoutes.length,
        vehicles: stopRoutes.reduce((sum, r) => sum + r.vehicles, 0),
        ridersPerDay: Math.round(stop?.smoothedDailyRiders ?? 0),
      };
    }

    if (sel.kind === 'emptyZone') {
      // Recomputed on every poll like the other kinds. A stale diagnosis is
      // worse than none: connect the road and the panel would still insist the
      // block has no electricity.
      const { x, y } = sel;
      const cell = this.state.grid.getCell(x, y);
      if (!cell || cell.zoneType === ZoneType.NONE || cell.buildingId !== 0) {
        // It developed, or was rezoned away — the panel has nothing to say.
        this.selectedBuilding = null;
        return null;
      }
      const blocker = this.zoneBlockerAt(x, y);
      return {
        ...sel,
        blocker,
        reason: blocker ? ZONE_BLOCKER_MESSAGES[blocker] : 'Ready to develop',
        hasPower: this.state.power.isPowered(x, y),
        hasWater: this.state.water.isSupplied(x, y),
        sameBlockerCount: this.countOtherCellsBlockedBy(blocker),
      };
    }

    if (sel.kind === 'zone') {
      const { x, y } = sel;
      const cell = this.state.grid.getCell(x, y);
      return {
        ...sel,
        landValue: cell?.landValue ?? sel.landValue,
        pollution: cell?.pollution ?? sel.pollution,
        serviceCoverage: cell?.serviceCoverage ?? sel.serviceCoverage,
        services: buildServiceStatus(this.state, x, y),
        abandonmentStress: this.simLoop.getAbandonmentStress(x, y),
        isAbandoned: cell?.reserved === ABANDONED,
        freightRatio: isCommercialZone(sel.zoneType) ? this.state.freight.getSupplyStatus(x, y).ratio : undefined,
        freightSource: isCommercialZone(sel.zoneType) ? this.state.freight.getSupplyStatus(x, y).source : undefined,
        freightSurplusRatio: sel.zoneType === ZoneType.INDUSTRIAL ? this.state.freight.getSurplusRatio() : undefined,
        freightExporting: sel.zoneType === ZoneType.INDUSTRIAL ? this.state.freight.isFactoryExporting(x, y) : undefined,
        shoppingRatio: isResidentialZone(sel.zoneType) ? this.state.shopping.getResidentialAccess(x, y).ratio : undefined,
        shoppingAccess: isResidentialZone(sel.zoneType) ? this.state.shopping.getResidentialAccess(x, y).hasAccess : undefined,
        customerRatio: isCommercialZone(sel.zoneType) ? this.state.shopping.getCommercialCustomers(x, y).ratio : undefined,
        hasCustomers: isCommercialZone(sel.zoneType) ? this.state.shopping.getCommercialCustomers(x, y).hasCustomers : undefined,
        garbageLoadRatio: this.getGarbageLoadRatio(),
        hospitalLoadRatio: this.state.health.getLoadRatio(),
        pendingDeaths: this.state.deathCare.getPendingDeathQueue().filter(d => d.x === x && d.y === y).length,
        pendingGarbage: this.state.garbage.getPendingGarbageQueue().filter(g => g.x === x && g.y === y).length,
      };
    }

    // Every kind is handled above, so `sel` is `never` here. Assigning it to a
    // `never` is what actually makes a new kind a compile error — `return sel`
    // alone does not, since the new member is assignable to the return type and
    // would compile straight into the silent never-refreshing shallow copy this
    // is meant to prevent.
    const unhandled: never = sel;
    return unhandled;
  }

  async saveCurrentGame(slotId: number, name: string): Promise<void> {
    const data = serializeGameState(this.state, { abandonmentStress: this.simLoop.abandonmentStress, elevationManager: this.elevationManager, transferHistory: this.simLoop.getTransferHistory(), highestMilestonePop: this.highestMilestonePop });
    const population = this.state.citizens.getPopulation();
    await saveGame(slotId, name, data, population);
  }

  exportCurrentGame(): void {
    const data = serializeGameState(this.state, { abandonmentStress: this.simLoop.abandonmentStress, elevationManager: this.elevationManager, transferHistory: this.simLoop.getTransferHistory(), highestMilestonePop: this.highestMilestonePop });
    const population = this.state.citizens.getPopulation();
    exportSaveToFile({
      id: 0,
      name: this.loadedSaveName || 'WebCity Save',
      date: new Date().toISOString(),
      data,
      population,
    });
  }

  private updatePreviewLine(): void {
    if (!this.dragStart || !this.isDragBuildTool()) {
      this.clearPreviewLine();
      this.placementPreview.hide();
      this.previewCost = null;
      return;
    }
    this.clearPreviewLine();
    const pathCells = getLShapedPath(this.dragStart, { x: this.gridCursor.gridX, y: this.gridCursor.gridY });
    if (pathCells.length < 2) return;

    // === Elevated mode: use getElevatedPath for exact ramp layout ===
    if (this.placementMode === 'elevated') {
      const from = this.dragStart;
      const to = { x: this.gridCursor.gridX, y: this.gridCursor.gridY };
      const targetLevel = this.elevationLevel;

      // Detect start/end levels (mirrors ElevatedRoadBuilder logic)
      const startCell = this.state.grid.getCell(from.x, from.y);
      const startOnGround = startCell !== null && startCell.roadType !== RoadType.NONE;
      const startOnElevated = this.elevationManager.get(from.x, from.y, targetLevel) !== null
        || this.elevationManager.hasElevatedSegment(from.x, from.y);
      const actualStartLevel = startOnGround && !startOnElevated ? 0 : targetLevel;

      const endCell = this.state.grid.getCell(to.x, to.y);
      const endOnGround = endCell !== null && endCell.roadType !== RoadType.NONE;
      const endLevel = endOnGround ? 0 : undefined;

      const elevPath = getElevatedPath(from, to, actualStartLevel, targetLevel, endLevel);
      if (!elevPath) {
        this.placementPreview.hide();
        this.previewCost = null;
        this.onUIUpdate?.();
        return;
      }

      const roadType = this.isRailTool() ? RoadType.TWO_LANE : this.currentRoadType;
      const flatCells: { x: number; y: number; roadType: number; roadFlags: number }[] = [];
      const rampPreview: { x: number; y: number; level: number; ascendDir: number; roadType: number }[] = [];
      let rampCellCount = 0;
      let bodyCellCount = 0;
      const last = elevPath.length - 1;

      for (let i = 0; i < elevPath.length; i++) {
        const ep = elevPath[i]!;
        // Skip origin (existing road the user started from)
        if (i === 0) continue;
        // Skip landing (existing ground road at the end)
        if (i === last && !ep.isRamp && ep.level !== targetLevel) continue;
        // Skip cells that already have elevated at target level
        if (this.elevationManager.get(ep.x, ep.y, targetLevel)) continue;

        if (ep.isRamp) {
          rampCellCount++;
          const neighbor = ep.rampDirection === 'up'
            ? elevPath[Math.min(i + 1, last)]!
            : elevPath[Math.max(i - 1, 0)]!;
          const ascendDir = getDirectionFlag(ep, neighbor);
          rampPreview.push({
            x: ep.x, y: ep.y,
            level: Math.max(ep.level, ep.targetLevel),
            ascendDir, roadType,
          });
        } else {
          bodyCellCount++;
          let flags = 0;
          if (i > 0) flags |= getDirectionFlag(ep, elevPath[i - 1]!);
          if (i < last) flags |= getDirectionFlag(ep, elevPath[i + 1]!);
          flatCells.push({ x: ep.x, y: ep.y, roadType, roadFlags: flags });
        }
      }

      const baseCost = this.isRailTool()
        ? RAIL.COST_PER_CELL
        : ROAD_CONFIGS[this.currentRoadType].cost;
      this.previewCost = rampCellCount * baseCost * ELEVATION_COST.RAMP
        + bodyCellCount * baseCost * ELEVATION_COST.ELEVATED;
      this.onUIUpdate?.();

      // Validate: mirrors ElevatedRoadBuilder checks
      const pathError = validateElevatedPath(this.state.grid, this.elevationManager, elevPath);
      const valid = !pathError && this.previewCost <= this.state.budget.funds;

      const baseY = targetLevel * 0.6;
      this.placementPreview.updateRoadDrag(flatCells, rampPreview.length > 0 ? rampPreview : undefined, baseY, valid);
      return;
    }

    // === Ground mode ===
    if (this.isRailTool()) {
      this.previewCost = pathCells.length * RAIL.COST_PER_CELL;
    } else {
      const roadConfig = ROAD_CONFIGS[this.currentRoadType];
      this.previewCost = pathCells.length * roadConfig.cost;
    }
    this.onUIUpdate?.();

    const roadType = this.isRailTool() ? RoadType.TWO_LANE : this.currentRoadType;
    const flatCells: { x: number; y: number; roadType: number; roadFlags: number }[] = [];

    for (let i = 0; i < pathCells.length; i++) {
      const c = pathCells[i]!;
      const existing = this.state.grid.getCell(c.x, c.y);
      if (existing && existing.roadType !== RoadType.NONE) continue;

      let flags = 0;
      if (i > 0) flags |= getDirectionFlag(c, pathCells[i - 1]!);
      if (i < pathCells.length - 1) flags |= getDirectionFlag(c, pathCells[i + 1]!);
      flatCells.push({ x: c.x, y: c.y, roadType, roadFlags: flags });
    }

    this.placementPreview.updateRoadDrag(flatCells);
  }

  private clearPreviewLine(): void {
    if (this.previewLine) {
      this.sceneManager.scene.remove(this.previewLine);
      this.previewLine.geometry.dispose();
      (this.previewLine.material as THREE.Material).dispose();
      this.previewLine = null;
    }
  }

  private checkMilestone(): void {
    const pop = this.state.citizens.getPopulation();
    const milestone = getMilestone(pop);
    // Milestones only go up. Comparing ids alone meant a population DROP past a
    // threshold re-announced the lower milestone as newly unlocked, complete
    // with the fanfare — and near a threshold, where immigration, deaths,
    // disasters and abandonment evictions all push the count back and forth,
    // it fired again every tick (BUG-094).
    if (milestone && milestone.populationRequired > this.highestMilestonePop) {
      this.highestMilestonePop = milestone.populationRequired;
      this.lastMilestoneId = milestone.id;
      this.showNotification(`Milestone: ${milestone.name}! (Pop ${milestone.populationRequired}) — Unlocked: ${milestone.unlocks.join(', ')}`, 8);
      this.audioManager.playSfx(SoundType.MILESTONE);
      this.onUIUpdate?.();
    }
  }

  private checkRandomDisaster(): void {
    if (this.mapConfig && !this.mapConfig.disastersEnabled) return;
    const pop = this.state.citizens.getPopulation();
    const chance = this.mapConfig
      ? DISASTER_CHANCE_MAP[this.mapConfig.disasterFrequency]
      : undefined;
    const result = tryRandomDisaster(this.state.grid.width, this.state.grid.height, pop, chance);
    if (!result) return;

    applyDisasterDamage(this.state.grid, result.damagedCells);
    // Evict citizens from destroyed buildings
    for (const { x, y } of result.damagedCells) {
      this.state.citizens.evictBuilding(`${x},${y}`, this.state.clock.tick);
    }
    this.audioManager.playSfx(SoundType.DISASTER);
    this.showNotification(formatDisasterMessage(result.disaster), 10);
    this.dirty.buildings = true;
    this.dirty.terrain = true;
    this.onUIUpdate?.();
  }

  getNotification(): string | null {
    return this.notification;
  }

  showNotification(message: string, duration = 4): void {
    this.notification = message;
    this.notificationTimer = duration;
  }

  /**
   * Report the outcome of an off-thread save.
   *
   * Held long (12s) and worded as a call to action, because the alternative to
   * noticing this is losing everything built since the last successful write.
   */
  private handleSaveComplete(msg: SaveCompleteMessage): void {
    if (!msg || msg.type !== 'SAVE_COMPLETE') return;
    if (msg.ok) {
      this.lastSaveFailure = null;
      return;
    }
    this.lastSaveFailure = msg;
    console.error('[save] slot', msg.slotId, 'failed:', msg.detail);
    this.showNotification(msg.error ?? 'Save failed.', 12);
  }

  /** The most recent unresolved save failure, for the UI to keep showing. */
  lastSaveFailure: SaveCompleteMessage | null = null;

  getEconomyBreakdown() {
    // Assembly lives in core so the "panel total === budget.expenses" invariant
    // can be tested; Game.ts imports Three.js and cannot be (BUG-077).
    return computeEconomyBreakdown(buildEconomyBreakdownContext(this.state, this.elevationManager));
  }

  deselectBuilding(): void {
    this.selectedBuilding = null;
    this.onUIUpdate?.();
  }

  /** 全城通勤統計（圖層與總覽面板共用同一份）。 */
  getCommuteStats() {
    return this.simLoop.getCommuteStats();
  }

  /** 通勤圖層的滿格值，也是換工作的門檻 —— 面板要拿它標示「已經在想換工作」。 */
  get commuteThreshold(): number {
    return COMMUTE_OVERLAY_MAX;
  }

  /** 把鏡頭移到某一格（面板點擊「最糟的住宅區」時用）。 */
  focusCell(x: number, y: number): void {
    this.sceneManager.setCameraTarget(x, y);
  }

  getTrafficStats() {
    return computeTrafficStats({
      vehicleCount: this.state.traffic.getVehicleCount(),
      topCongested: this.state.traffic.getTopCongested(8),
      avgPathLength: this.state.traffic.getAveragePathLength(),
      roadTileCount: countRoadTiles(this.state.grid),
    });
  }

  getTransferStats() {
    return this.simLoop.getTransferStats();
  }

  /**
   * Build highlight cells for the transfer overlay.
   * Zone buildings: white if in highlightSet, dark gray otherwise.
   * Infra buildings: white if main cell in highlightSet (all footprint cells included).
   */
  private buildTransferHighlightCells(
    highlightSet: Set<string>,
  ): { x: number; y: number; color: number }[] {
    const cells: { x: number; y: number; color: number }[] = [];

    this.state.grid.forEachCell((cell, x, y) => {
      if (!cell.buildingId || cell.buildingId <= 0) return;
      const key = `${x},${y}`;

      if (isZoneBuilding(cell.buildingId)) {
        if (highlightSet.has(key)) cells.push({ x, y, color: 0xffffff });
      } else {
        // Infrastructure: highlight if this cell OR its main cell is in the set.
        // MULTI_CELL_OCCUPIED cells share the parent's buildingId area.
        if (highlightSet.has(key)) {
          // Main cell of infra — highlight it + expand footprint
          const cfg = getInfraConfigById(cell.buildingId);
          if (cfg) {
            for (let dx = 0; dx < cfg.width; dx++) {
              for (let dy = 0; dy < cfg.height; dy++) {
                cells.push({ x: x + dx, y: y + dy, color: 0xffffff });
              }
            }
          } else {
            cells.push({ x, y, color: 0xffffff });
          }
        }
        // Non-highlighted infra: leave untouched (no dim)
      }
    });

    return cells;
  }

  getSelectedTransferRoute(): string | null {
    return this.selectedTransferRoute;
  }

  selectTransferRoute(label: string | null): void {
    // Clear previous overlay
    for (const line of this.transferOverlayLines) {
      this.sceneManager.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.transferOverlayLines.length = 0;
    this.highlightManager.clear();

    this.selectedTransferRoute = label;
    this.transferHighlightCells = [];
    if (!label) {
      this.onUIUpdate?.();
      return;
    }

    // Use NORMAL ViewMode (keep original InstancedMesh) so per-instance highlight works.
    // Dim all buildings via highlight, then make transfer buildings bright.
    if (this.viewMode !== ViewMode.NORMAL) this.applyViewMode(ViewMode.NORMAL);

    // ── Build transfer highlight cells (cached, reapplied every frame) ──
    const buildings = this.simLoop.getTransferBuildings(label);
    const highlightSet = new Set([...buildings.homes, ...buildings.works]);

    // Collect transit stop positions + expand to full building footprint
    const stops = this.simLoop.getTransferRouteStops(label);
    for (const s of stops) highlightSet.add(`${s.x},${s.y}`);

    this.transferHighlightCells = this.buildTransferHighlightCells(highlightSet);
    this.reapplyTransferHighlight(); // apply immediately, don't wait for next frame

    // ── Draw route line ──
    if (stops.length >= 2) {
      // Group consecutive same-type legs for coloring
      const LINE_Y = 0.2;
      const typeColors: Record<string, number> = {
        ride: 0x42a5f5, walk: 0xffffff,
      };
      let segStart = 0;
      for (let i = 1; i <= stops.length; i++) {
        if (i < stops.length && stops[i]!.type === stops[segStart]!.type) continue;
        // Draw segment from segStart to i-1
        const points: THREE.Vector3[] = [];
        for (let j = segStart; j < i; j++) {
          points.push(new THREE.Vector3(stops[j]!.x, LINE_Y, stops[j]!.y));
        }
        if (points.length >= 2) {
          const isWalk = stops[segStart]!.type === 'walk';
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineDashedMaterial({
            color: isWalk ? 0xffffff : 0x42a5f5,
            linewidth: 2,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            dashSize: isWalk ? 0.2 : 1000,
            gapSize: isWalk ? 0.15 : 0,
          });
          const line = new THREE.Line(geometry, material);
          line.computeLineDistances();
          line.renderOrder = 10;
          this.sceneManager.scene.add(line);
          this.transferOverlayLines.push(line);
        }
        segStart = i;
      }
    }

    this.onUIUpdate?.();
  }

  /** Toggle pause state (DRY: used by keyboard + UI). */
  togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) this.state.clock.pause();
    else this.state.clock.resume();
    this.onUIUpdate?.();
  }

  /** Set game speed directly (DRY: used by UI speed buttons). */
  setSpeed(s: GameSpeed): void {
    if (s === 0) return;
    this.speed = s;
    this.state.clock.setSpeed(s);
    this.paused = false;
    this.onUIUpdate?.();
  }

  /** Cycle to next/prev speed (DRY: used by keyboard shortcuts). */
  changeSpeed(delta: number): void {
    const speeds = GameClock.SPEEDS;
    const idx = speeds.indexOf(this.speed as GameSpeed);
    const newIdx = Math.max(0, Math.min(speeds.length - 1, (idx === -1 ? 0 : idx) + delta));
    this.speed = speeds[newIdx]!;
    this.state.clock.setSpeed(speeds[newIdx]!);
    this.onUIUpdate?.();
  }

  takeLoan(amount: number): void {
    if (amount <= 0) return;
    this.state.budget.funds += amount;
    this.state.budget.loans += amount;
    this.showNotification(`Loan taken: $${amount.toLocaleString()}`);
    this.onUIUpdate?.();
  }

  repayLoan(amount: number): void {
    if (amount <= 0) return;
    const actual = Math.min(amount, this.state.budget.loans, this.state.budget.funds);
    if (actual <= 0) return;
    this.state.budget.funds -= actual;
    this.state.budget.loans -= actual;
    this.showNotification(`Loan repaid: $${actual.toLocaleString()}`);
    this.onUIUpdate?.();
  }
}
