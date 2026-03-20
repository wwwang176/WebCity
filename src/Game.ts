import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager';
import { TerrainRenderer } from './renderer/TerrainRenderer';
import { RoadRenderer, ROAD_WIDTHS } from './renderer/RoadRenderer';
import { BuildingRenderer } from './renderer/BuildingRenderer';
import { VehicleRenderer, type VehicleData } from './renderer/VehicleRenderer';
import { TrafficLightRenderer } from './renderer/TrafficLightRenderer';
import { syncTrafficLightsWithGrid } from './core/traffic/TrafficLights';
import { OverlayRenderer } from './renderer/OverlayRenderer';
import { GridCursor } from './renderer/GridCursor';
import { WeatherRenderer } from './renderer/WeatherRenderer';
import { createGameState, type GameState } from './core/simulation/GameState';
import { SimulationLoop } from './core/simulation/SimulationLoop';
import { GameClock, type GameSpeed } from './core/simulation/GameClock';
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType, ROAD_CONFIGS } from './core/road/types';
import { ZoneType } from './core/grid/types';
import { normalizeRect, countRoadTiles, getLShapedPath } from './core/grid/GridHelpers';
import { ZoneManager } from './core/zone/ZoneManager';
import { type OverlayType } from './renderer/OverlayRenderer';
import { AudioManager } from './audio/AudioManager';
import { type BuildingType } from './core/building/types';
import { WorkplaceDistanceClient } from './core/workplace/WorkplaceDistanceClient';
import { WorkplaceDistanceCache } from './core/workplace/WorkplaceDistanceCache';
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { serializeGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { getTotalTransportOperatingCost } from './core/transport/TransportRegistry';
import { tryRandomDisaster, formatDisasterMessage, applyDisasterDamage } from './core/climate/Disaster';
import { getLaneCount, getSpeedLimitForCell } from './core/traffic/TrafficSimulation';
import { gridAStarPath, refineLanePath } from './core/traffic/Pathfinding';
import type { TransportStop, TransportRoute } from './core/transport/types';
import { classifyVehicleType } from './core/traffic/VehicleClassification';
import type { ServiceVehicleType } from './core/traffic/TrafficSimulation';
import { getInfraConfig, getInfraBuildingId, getRotatedSize, isInfrastructureBuilding, isInfraType, isZoneBuilding, type InfraType, type Rotation } from './core/building/InfraConfig';
import { canPlaceInfra, placeInfraOnGrid, removeInfraFromGrid, findPrimaryCell, forEachMultiCell, getInfraCenterById, ROTATION_RESERVED, ABANDONED } from './core/building/InfraPlacement';
import { PlacementPreview } from './renderer/PlacementPreview';
import { HighlightManager } from './renderer/HighlightManager';
import { ROAD_COVERAGE } from './core/service/RoadCoverageFlood';
import { isResidentialZone } from './core/grid/types';
import { TransportRouteRenderer } from './renderer/TransportRouteRenderer';
import { MetroTunnelRenderer } from './renderer/MetroTunnelRenderer';
import { getAirportBuildCost, getAirportFootprint, canPlaceAirport, placeAirportOnGrid, type AirportSize } from './core/transport/AirportSystem';
import { collectTransportVehicles } from './core/transport/collectTransportVehicles';
import { collectTransportRoutes } from './core/transport/collectTransportRoutes';
import { PedestrianRenderer, cullPedestrians } from './renderer/PedestrianRenderer';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from './core/building/InfraServiceActions';
import { getInfraDetails as getInfraDetailsFromCtx, type InfraDetailContext } from './core/building/InfraDetails';
import { classifyBuilding } from './core/building/BuildingClassifier';
import { classifyDemolishCell } from './core/building/DemolishClassifier';
import { getEconomyBreakdown as computeEconomyBreakdown } from './core/economy/EconomyBreakdown';
import { buildIncomeCalcDeps } from './core/economy/IncomeCalcAdapter';

import {
  ViewMode,
  VIEW_MODE_OPACITY,
  getTransportFocusMode,
  STOP_NAMES,
  type TransportStopKind,
} from './core/ViewMode';
import { computeTunnelSegments } from './core/transport/MetroTunnelPath';
import { getBuildReasonMessage } from './core/grid/BuildReasonMessages';
import { buildOverlayValue, type OverlayBuildContext } from './core/overlay/OverlayBuilders';
import { getCoverageService } from './core/overlay/CoverageOverlay';
import { getTrafficStats as computeTrafficStats } from './core/traffic/TrafficStats';
import { canPlaceTransportStop, findAdjacentRoadCell, TRANSPORT_TO_INFRA_TYPE } from './core/transport/TransportPlacement';
import { generateTerrain } from './core/grid/TerrainGenerator';
import { isWater, getGroundwaterLevel, isShorePosition } from './core/grid/Terrain';
import { FerryAnimator } from './renderer/FerryAnimator';
import { TrackRenderer } from './renderer/TrackRenderer';
import { RailBuilder } from './core/rail/RailBuilder';
import { RailNetwork, rebuildRailNetworkFromGrid } from './core/rail/RailNetwork';
import { RAIL } from './core/rail/types';
import { LevelCrossingSystem } from './core/rail/LevelCrossingSystem';
import { LevelCrossingRenderer } from './renderer/LevelCrossingRenderer';
import { TrainAnimator } from './renderer/TrainAnimator';



/** Map service vehicle types to renderer vehicle type keys. */
const SERVICE_TYPE_TO_VEHICLE_TYPE: Record<ServiceVehicleType, VehicleData['type']> = {
  police: 'police_car',
  fire: 'firetruck',
  health: 'ambulance',
  garbage: 'garbage_truck',
};

export type ToolType = 'select' | 'road' | 'road_rural' | 'road_2lane' | 'road_4lane' | 'road_6lane' | 'road_highway' | 'rail_track' | 'zone_r' | 'zone_rh' | 'zone_c' | 'zone_ch' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery' | 'district' | 'bus_stop' | 'metro_station' | 'train_station' | 'ferry_dock' | 'airport';

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
  ferry_dock: 'ferry', airport: 'airport',
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
  zone_r: 0x4caf50, zone_rh: 0x2e7d32,
  zone_c: 0x2196f3, zone_ch: 0x1565c0,
  zone_i: 0xffc107, zone_o: 0x9c27b0,
};

/** Key-to-tool bindings (OCP: add new keyboard shortcuts here). */
const KEY_TO_TOOL: Record<string, ToolType> = {
  '1': 'select', '2': 'road_2lane', '3': 'zone_r', '4': 'zone_c',
  '5': 'zone_i', '6': 'zone_o', '7': 'road_rural', '8': 'power',
  '9': 'water', '0': 'demolish', 'delete': 'demolish',
};

/** Key-to-overlay bindings (OCP: add new overlay shortcuts here). */
const KEY_TO_OVERLAY: Record<string, OverlayType> = {
  'f1': 'power', 'f2': 'water', 'f3': 'pollution',
  'f4': 'landValue', 'f5': 'traffic', 'f6': 'zone',
};

/** Tool-to-cursor-color mapping (OCP: add new tool colors here). */
const TOOL_CURSOR_COLORS: Record<ToolType, number> = {
  select: 0xffffff,
  road: 0x424242, road_rural: 0x424242, road_2lane: 0x424242,
  road_4lane: 0x424242, road_6lane: 0x424242, road_highway: 0x424242,
  rail_track: 0x6d4c2a,
  zone_r: 0x4caf50, zone_rh: 0x2e7d32,
  zone_c: 0x2196f3, zone_ch: 0x1565c0,
  zone_i: 0xffa726, zone_o: 0xab47bc,
  demolish: 0xf44336,
  power: 0xffeb3b, water: 0x03a9f4, police: 0x3f51b5, fire: 0xd32f2f,
  hospital: 0xe91e63, school: 0x795548, school_high: 0x6d4c41,
  school_univ: 0x4e342e, park: 0x4caf50, garbage: 0x795548,
  sewage: 0x607d8b, cemetery: 0x9e9e9e,
  district: 0xab47bc,
  bus_stop: 0xff9800, metro_station: 0x00bcd4, train_station: 0x795548,
  ferry_dock: 0x0288d1, airport: 0x9c27b0,
};

/** Map of tool types to auto-activated overlay (OCP: add new overlay mappings here). */
const TOOL_TO_OVERLAY: Partial<Record<ToolType, OverlayType>> = {
  power: 'power', water: 'water', police: 'police', fire: 'fire',
  hospital: 'health', school: 'education', school_high: 'education',
  school_univ: 'education', park: 'park', garbage: 'garbage',
  district: 'district',
};

/**
 * Per-service coverage ratio for the selected building.
 * -1 = no coverage, 0.0 = nearest (best), 1.0 = farthest (worst).
 * Power/water use 0 (covered) or -1 (not covered).
 */
export interface ServiceStatus {
  power: number;
  water: number;
  police: number;
  fire: number;
  garbage: number;
  health: number;
  education: number;
  deathCare: number;
}

export interface SelectedZoneBuilding {
  kind: 'zone';
  x: number;
  y: number;
  buildingType: BuildingType;
  zoneType: ZoneType;
  landValue: number;
  pollution: number;
  serviceCoverage: number;
  services: ServiceStatus;
  abandonmentStress: number;
  isAbandoned: boolean;
}

export interface SelectedInfraBuilding {
  kind: 'infra';
  x: number;
  y: number;
  infraType: InfraType;
  name: string;
  cost: number;
  /** Service-specific details to display */
  details: Record<string, string | number>;
}

export interface SelectedTransportStop {
  kind: 'transport';
  x: number;
  y: number;
  transportType: TransportStopKind;
  name: string;
  routes: number;
  vehicles: number;
  ridersPerWeek: number;
}

export type SelectedBuilding = SelectedZoneBuilding | SelectedInfraBuilding | SelectedTransportStop;

export class Game {
  private sceneManager: SceneManager;
  private terrainRenderer: TerrainRenderer;
  private roadRenderer: RoadRenderer;
  private buildingRenderer: BuildingRenderer;
  private vehicleRenderer: VehicleRenderer;
  private pedestrianRenderer: PedestrianRenderer;
  private trafficLightRenderer: TrafficLightRenderer;
  private overlayRenderer: OverlayRenderer;
  private weatherRenderer: WeatherRenderer;
  private gridCursor: GridCursor;
  private placementPreview: PlacementPreview;
  private highlightManager: HighlightManager;
  /** Cached overlay building highlight cells (reapplied every frame). */
  private overlayHighlightCells: { x: number; y: number; color: number }[] = [];
  private transportRouteRenderer: TransportRouteRenderer;
  private metroTunnelRenderer: MetroTunnelRenderer;
  private trackRenderer: TrackRenderer;
  private levelCrossingRenderer: LevelCrossingRenderer;
  private levelCrossingSystem: LevelCrossingSystem;
  private state: GameState;
  private simLoop: SimulationLoop;
  private roadBuilder: RoadBuilder;
  private railBuilder: RailBuilder;
  private railNetwork: RailNetwork;
  private zoneManager: ZoneManager;
  private audioManager: AudioManager;
  private autoSaver: AutoSaver;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tickAccumulator = 0;
  private elapsedTime = 0;
  private dirty = {
    roads: true,
    tracks: true,
    crossings: true,
    buildings: true,
    terrain: true,
    trafficLights: true,
    overlay: true,
  };

  // UI state
  currentTool: ToolType = 'select';
  currentRoadType: RoadType = RoadType.TWO_LANE;
  paused = false;
  speed = 1;
  selectedBuilding: SelectedBuilding | null = null;
  notification: string | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private onUIUpdate: (() => void) | null = null;
  private previewLine: THREE.Line | null = null;
  private lastMilestoneId: string | null = null;
  private notificationTimer = 0;
  private vehicleTypes = new Map<number, VehicleData['type']>();
  /** Reusable per-frame vehicle data array (avoids .map().filter() allocation). */
  private vehicleDataScratch: VehicleData[] = [];
  /** Reusable per-frame merged vehicle array. */
  private allVehiclesScratch: VehicleData[] = [];
  /** Reusable per-frame train positions array. */
  private trainPosScratch: { x: number; y: number }[] = [];

  /** Bound canAdvance callback (avoids per-frame closure creation). */
  private readonly _canAdvance = (cur: string, next: string): boolean => {
    const ci = cur.indexOf(',');
    const cx = Number(cur.slice(0, ci));
    const cy = Number(cur.slice(ci + 1));
    const ni = next.indexOf(',');
    const nx = Number(next.slice(0, ni));
    const ny = Number(next.slice(ni + 1));
    const dx = Math.abs(nx - cx), dy = Math.abs(ny - cy);
    if (dx + dy === 2) {
      const ix = (cx + nx) / 2;
      const iy = (cy + ny) / 2;
      if (Number.isInteger(ix) && Number.isInteger(iy)) {
        if (!this.state.trafficLights.canPass(cx, cy, ix, iy)) return false;
        if (this.levelCrossingSystem.isCrossingBlocked(ix, iy)) return false;
      }
    }
    if (!this.state.trafficLights.canPass(cx, cy, nx, ny)) return false;
    if (this.levelCrossingSystem.isCrossingBlocked(nx, ny)) return false;
    return true;
  };
  /** Bound speed limit callback (avoids per-frame closure creation). */
  private readonly _getSpeedLimit = (key: string): number => getSpeedLimitForCell(this.state.grid, key);
  /** 渡輪渲染端動畫（純 LERP，不靠 tick） */
  private ferryAnimator = new FerryAnimator();
  /** 火車渲染端動畫（純 LERP，不靠 tick） */
  private trainAnimator = new TrainAnimator();
  previewCost: number | null = null; // estimated cost during road drag
  activeDistrictId: string | null = null; // currently selected district for painting
  currentRotation: Rotation = 0; // infrastructure placement rotation (R key cycles)
  selectedAirportSize: AirportSize | null = null; // selected airport size for placement
  viewMode: ViewMode = ViewMode.NORMAL;

  /** Which save slot this game was loaded from (null = new game) */
  loadedSlotId: number | null = null;
  /** Name of the save slot this game was loaded from */
  loadedSaveName: string | null = null;

  constructor(container: HTMLElement, loadedState?: GameState) {
    const mapSize = loadedState ? loadedState.grid.width : 60;

    // Audio
    this.audioManager = new AudioManager();
    this.audioManager.init();
    this.audioManager.startAmbient();

    // Auto-save every 100 ticks
    this.autoSaver = new AutoSaver(100);

    if (loadedState) {
      this.state = loadedState;
    } else {
      this.state = createGameState(mapSize, mapSize);
    }
    this.simLoop = new SimulationLoop(this.state);

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
    const extra = (loadedState as unknown as { _extra?: { abandonmentStress?: Map<string, number> } } | undefined)?._extra;
    if (extra?.abandonmentStress) {
      this.simLoop.abandonmentStress = extra.abandonmentStress;
    }
    this.simLoop.onTerrainChanged = () => {
      this.dirty.terrain = true;
    };
    // Fine-grained building callbacks — incremental O(1) updates,
    // no need to set dirty.buildings (avoids redundant full rebuild)
    this.simLoop.onBuildingAdded = (x, y, zoneType, level) => {
      this.buildingRenderer.addBuilding(x, y, zoneType, level, false);
    };
    this.simLoop.onBuildingRemoved = (x, y) => {
      this.buildingRenderer.removeBuilding(x, y);
    };
    this.simLoop.onBuildingUpdated = (x, y, zoneType, level, burned, abandoned) => {
      this.buildingRenderer.updateBuilding(x, y, zoneType, level, burned, abandoned);
    };
    // When a bus route is dissolved (stop removed → <2 stops), clean up TrafficSimulation vehicles
    this.state.bus.onRouteDissolvedHook = (routeId) => {
      this.state.traffic.removeBusVehicles(routeId);
    };
    this.roadBuilder = new RoadBuilder(this.state.grid);
    this.railNetwork = new RailNetwork();
    this.railBuilder = new RailBuilder(this.state.grid, this.railNetwork);
    this.state.rail.setRailNetwork(this.railNetwork);
    this.levelCrossingSystem = new LevelCrossingSystem();
    this.zoneManager = new ZoneManager(this.state.grid);

    // 設定渡輪系統的水域網格（A* 水面導航）
    const grid = this.state.grid;
    this.state.ferry.setWaterGrid({
      width: grid.width,
      height: grid.height,
      isWater: (x: number, y: number) => isWater(grid, x, y),
    });

    // Rebuild rail network and service coverage from existing grid data (for loaded games)
    if (loadedState) {
      rebuildRailNetworkFromGrid(this.state.grid, this.railNetwork);
      this.recalculateAllRoadCoverage();
    }

    // Generate terrain only for new games
    if (!loadedState) {
      generateTerrain(this.state.grid);
    }

    // Renderer setup
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
    this.levelCrossingRenderer = new LevelCrossingRenderer();

    this.weatherRenderer = new WeatherRenderer(this.sceneManager, mapSize);

    // Build initial scene
    this.terrainRenderer.build(this.sceneManager.scene, this.state.grid);
    this.vehicleRenderer.build(this.sceneManager.scene);
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

    // Center camera on map
    this.sceneManager.setCameraTarget(mapSize / 2, mapSize / 2);

    // Input handlers
    this.setupInput(container);

    // Game loop
    this.sceneManager.onUpdate((dt) => this.update(dt));
    this.sceneManager.start();
  }

  private setupInput(_container: HTMLElement): void {
    const canvas = this.sceneManager.getCanvas();

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
      this.gridCursor.update(this.raycaster, this.groundPlane);
      this.updatePreviewLine();
      this.updatePlacementPreview();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.dragStart = { x: this.gridCursor.gridX, y: this.gridCursor.gridY };
        this.updatePlacementPreview();
      }
      if (e.button === 2) {
        // Right-click camera pan handled in mousemove
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
      this.sceneManager.zoomCamera(e.deltaY * 0.05);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      // Prevent default for F1-F6 (overlay toggles)
      if (/^f[1-6]$/i.test(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      this.handleKeyDown(e.key.toLowerCase());
    });

    window.addEventListener('keyup', (e) => {
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
      case ' ': this.togglePause(); break;
      case '+':
      case '=': this.changeSpeed(1); break;
      case '-': this.changeSpeed(-1); break;
    }
  }

  private handleToolAction(x1: number, y1: number, x2: number, y2: number): void {
    switch (this.currentTool) {
      case 'select':
        this.handleSelectClick(x1, y1);
        break;
      case 'demolish': {
        const demolishedRoadCells = this.collectRoadCells(x1, y1, x2, y2);
        const { evictedCitizenIds, buildingCells } = this.demolish(x1, y1, x2, y2);
        this.simLoop.markLaneGraphDirty([...demolishedRoadCells, ...buildingCells]);
        this.simLoop.ensureLaneGraph(); // immediately rebuild + reroute buses
        this.audioManager.playSfx('demolish');
        break;
      }
      case 'district':
        this.paintDistrict(x1, y1, x2, y2);
        this.audioManager.playSfx('zone');
        break;
      default: {
        // Data-driven road building (OCP: add new road types in TOOL_TO_ROAD_TYPE)
        if (TOOL_TO_ROAD_TYPE[this.currentTool] !== undefined) {
          const result = this.roadBuilder.buildRoad(
            { x: x1, y: y1 }, { x: x2, y: y2 },
            this.currentRoadType,
            this.state.budget.funds,
          );
          this.handleBuildResult(result, 'road', () => {
            this.simLoop.markLaneGraphDirty([...result.affectedCells, ...(result.demolishedCells ?? [])]);
            this.recalculateAllRoadCoverage();
            if (result.demolishedCells) {
              for (const pos of result.demolishedCells) this.state.citizens.evictBuilding(pos, this.state.clock.tick);
            }
          });
          this.dirty.roads = true;
          this.dirty.crossings = true;
          this.dirty.trafficLights = true;
          this.dirty.buildings = true;
          break;
        }
        // Rail track building
        if (this.currentTool === 'rail_track') {
          const result = this.railBuilder.buildTrack(
            { x: x1, y: y1 }, { x: x2, y: y2 },
            this.state.budget.funds,
          );
          this.handleBuildResult(result, 'track', () => {
            if (result.demolishedCells) {
              for (const pos of result.demolishedCells) this.state.citizens.evictBuilding(pos, this.state.clock.tick);
              this.simLoop.markLaneGraphDirty(result.demolishedCells);
            }
          });
          this.dirty.tracks = true;
          this.dirty.crossings = true;
          this.dirty.buildings = true;
          break;
        }
        const zoneType = TOOL_TO_ZONE[this.currentTool];
        if (zoneType !== undefined) {
          this.applyZone(x1, y1, x2, y2, zoneType);
          this.audioManager.playSfx('zone');
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
    this.dirty.tracks = true;
    this.dirty.crossings = true;
    this.dirty.buildings = true;
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
      this.audioManager.playSfx('build');
    } else if (!result.success && result.reason) {
      this.showNotification(`Cannot build ${label}: ${getBuildReasonMessage(result.reason)}`);
    }
  }

  private applyZone(x1: number, y1: number, x2: number, y2: number, zoneType: ZoneType): void {
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    // Pre-scan: collect cells where rezoning will demolish an existing building
    const evictedIds: number[] = [];
    const buildingCells: string[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && isZoneBuilding(cell.buildingId) && cell.zoneType !== zoneType) {
          const posKey = `${x},${y}`;
          evictedIds.push(...this.state.citizens.evictBuilding(posKey, this.state.clock.tick));
          buildingCells.push(posKey);
        }
      }
    }
    if (evictedIds.length > 0) {
      this.simLoop.markLaneGraphDirty(buildingCells);
    }
    this.zoneManager.setZoneRect({ x: minX, y: minY }, { x: maxX, y: maxY }, zoneType);
    this.dirty.buildings = true;
    this.dirty.terrain = true;
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
    let hadRoadDemolished = false;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        const primary = cell && isInfrastructureBuilding(cell.buildingId)
          ? findPrimaryCell(this.state.grid, x, y) : null;
        const action = classifyDemolishCell(cell, primary);

        switch (action.action) {
          case 'skip': break;
          case 'airport': {
            const key = `airport:${x},${y}`;
            if (!demolished.has(key)) {
              this.removeInfraService('airport', x, y);
              demolished.add(key);
            }
            break;
          }
          case 'multi_cell_infra': {
            const key = `${action.primaryX},${action.primaryY}`;
            if (!demolished.has(key)) {
              demolished.add(key);
              this.removeInfraService(action.infraType, action.primaryX, action.primaryY);
              removeInfraFromGrid(this.state.grid, x, y);
            }
            break;
          }
          case 'single_cell_infra':
            this.removeInfraService(action.infraType, x, y);
            this.state.grid.setCell(x, y, { buildingId: 0, reserved: 0 });
            break;
          case 'regular':
            if (cell && cell.buildingId !== 0) evictCells.push(`${x},${y}`);
            if (cell && cell.roadType !== RoadType.NONE) hadRoadDemolished = true;
            if (action.hasTrack) this.railBuilder.removeTrack(x, y);
            this.state.grid.setCell(x, y, {
              roadType: 0, roadFlags: 0, zoneType: ZoneType.NONE,
              buildingId: 0, reserved: 0,
            });
            break;
        }
      }
    }
    // Evict citizens from demolished zone buildings and clear abandonment stress
    const evictedCitizenIds: number[] = [];
    for (const pos of evictCells) {
      evictedCitizenIds.push(...this.state.citizens.evictBuilding(pos, this.state.clock.tick));
      const [px, py] = pos.split(',').map(Number);
      this.simLoop.clearBuildingState(px!, py!);
    }
    if (hadRoadDemolished) {
      this.recalculateAllRoadCoverage();
    }
    this.markAllDirty();

    // Refresh overlay cache after demolish
    const activeOverlay = this.overlayRenderer.getOverlay();
    if (activeOverlay !== 'none') {
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
      this.showNotification(getBuildReasonMessage(check.reason), 3);
      return;
    }

    if (!this.tryDeductFunds(cfg.cost)) return;

    // Auto-demolish zone buildings in the footprint (evict citizens)
    const { w, h } = getRotatedSize(cfg.width, cfg.height, this.currentRotation);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        const cell = this.state.grid.getCell(cx, cy);
        if (cell && cell.buildingId !== 0 && isZoneBuilding(cell.buildingId)) {
          this.state.citizens.evictBuilding(`${cx},${cy}`, this.state.clock.tick);
          this.state.grid.setCell(cx, cy, { buildingId: 0, reserved: 0, zoneType: 0 });
        }
      }
    }

    // Place on grid (multi-cell)
    placeInfraOnGrid(this.state.grid, x, y, type, this.currentRotation);

    // Register with service layer at top-left coordinates (matches expandFootprint expectation)
    const actions = INFRA_SERVICE_ACTIONS[type];
    if (actions) {
      actions.place(this.state as InfraServiceContext, x, y);
    }

    // Immediately recalculate coverage for road-based services so overlay updates
    this.recalculateServiceCoverage(type);

    this.audioManager.playSfx('build');
    this.dirty.buildings = true;

    // Refresh overlay if one is active for this service
    const activeOverlay = this.overlayRenderer.getOverlay();
    if (activeOverlay !== 'none') {
      this.setOverlay(activeOverlay);
    }
  }

  /** Immediately recalculate road-based coverage after placing/removing a service building. */
  private recalculateServiceCoverage(infraType: InfraType): void {
    const grid = this.state.grid;
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
    const check = canPlaceTransportStop(type, cell, this.state.grid, x, y);
    if (!check.ok) {
      this.showNotification(getBuildReasonMessage(check.reason), 3);
      return;
    }
    const infraCfg = getInfraConfig(TRANSPORT_TO_INFRA_TYPE[type]!);
    const baseCost = infraCfg?.cost ?? 500;
    const cost = type === 'airport' ? getAirportBuildCost(this.selectedAirportSize ?? 'SMALL') : baseCost;
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
    this.state.grid.setCell(x, y, {
      buildingId: infraCfg?.buildingId ?? getInfraBuildingId('bus_stop'),
      reserved: ROTATION_RESERVED[this.currentRotation],
    });
    this.audioManager.playSfx('build');
    this.dirty.buildings = true;
  }

  /** Place an airport at (x,y). Returns true on success, false (with funds refunded) on failure. */
  private placeAirport(x: number, y: number, cost: number): boolean {
    const airportSize: AirportSize = this.selectedAirportSize ?? 'SMALL';

    // Validate footprint (data-driven, extracted to core)
    const check = canPlaceAirport(this.state.grid, x, y, airportSize);
    if (!check.ok) {
      this.state.budget.funds += cost;
      this.showNotification(getBuildReasonMessage(check.reason));
      return false;
    }

    const pop = this.state.citizens.getPopulation();
    const result = this.state.airport.build(x, y, airportSize, pop);
    if (!result) {
      this.state.budget.funds += cost;
      const req = this.state.airport.getPopulationRequired(airportSize);
      this.showNotification(`Airport requires population >= ${req.toLocaleString()}`);
      return false;
    }

    // Set all NxN cells to airport buildingId (delegated to core — SRP)
    placeAirportOnGrid(this.state.grid, x, y, airportSize, getInfraBuildingId('airport'));
    this.audioManager.playSfx('build');
    this.dirty.buildings = true;
    return true;
  }

  private update(dt: number): void {
    this.elapsedTime += dt;

    // Camera movement
    const panSpeed = 15 * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.sceneManager.panCamera(0, -panSpeed);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.sceneManager.panCamera(0, panSpeed);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.sceneManager.panCamera(-panSpeed, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.sceneManager.panCamera(panSpeed, 0);

    // Simulation tick
    if (!this.paused) {
      const tickInterval = this.state.clock.getTickInterval() / 1000;
      this.tickAccumulator += dt;
      // Cap accumulator to prevent massive backlog when tab regains focus
      if (this.tickAccumulator > tickInterval * 10) {
        this.tickAccumulator = tickInterval * 10;
      }
      if (this.tickAccumulator >= tickInterval) {
        this.tickAccumulator -= tickInterval;
        this.simLoop.tick();

        // Push occupancy ratios to building renderer for night lighting
        if (this.simLoop.occupancyRatios.size > 0 && this.state.clock.tick % 6 === 0) {
          this.buildingRenderer.updateOccupancy(this.simLoop.occupancyRatios);
        }

        // Milestone detection
        this.checkMilestone();

        // Random disaster events (small chance per tick)
        this.checkRandomDisaster();

        // Auto-save
        if (this.autoSaver.shouldSave(this.state.clock.tick)) {
          const data = serializeGameState(this.state, { abandonmentStress: this.simLoop.abandonmentStress });
          saveGame(0, 'AutoSave', data, this.state.citizens.getPopulation()).catch(() => { /* ignore save errors */ });
        }

        // Safety-net rebuild: low-frequency fallback in case events are missed
        if (this.state.clock.tick % 200 === 0) {
          this.dirty.buildings = true;
          this.dirty.terrain = true;
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
    this.roadRenderer.update(sunI);
  }

  /** Rebuild renderer meshes for each dirty subsystem, then clear dirty flags. */
  private rebuildDirtySubsystems(): void {
    const d = this.dirty;
    const anyDirty = d.roads || d.tracks || d.crossings || d.buildings || d.terrain || d.trafficLights;
    if (!anyDirty) return;

    if (d.roads) {
      this.roadRenderer.build(this.sceneManager.scene, this.state.grid);
      if (this.viewMode !== ViewMode.NORMAL) this.roadRenderer.setViewMode(this.viewMode);
      d.roads = false;
    }
    if (d.tracks) {
      this.trackRenderer.build(this.sceneManager.scene, this.state.grid);
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
      this.buildingRenderer.build(this.sceneManager.scene, this.state.grid);
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
    if (currentOverlay && currentOverlay !== 'none') {
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
      vehicleData.push({ id: v.id, x: pos.x, y: pos.y, heading, type, laneOffset: 0 });
    }

    // Collect transport system vehicles (rail/ferry — bus is now in TrafficSimulation)
    const transportVehicles = collectTransportVehicles({
      rail: this.state.rail, ferry: this.state.ferry,
    });

    // Animate ferry and train (render-side LERP, independent of tick)
    const simSpeed = this.paused ? 0 : this.state.clock.speed;
    this.ferryAnimator.update(dt, simSpeed, this.state.ferry, transportVehicles);
    this.trainAnimator.update(dt, simSpeed, this.state.rail, transportVehicles);

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
    this.vehicleRenderer.update(allVehicles, this.weatherRenderer.sunIntensity, this.elapsedTime);

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
    if (this.viewMode !== ViewMode.NORMAL) {
      this.transportRouteRenderer.update([]);
    } else {
      this.transportRouteRenderer.update(routeData);
    }

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
    this.trackRenderer.setViewMode(mode);
    this.levelCrossingRenderer.setViewMode(mode);
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
        case 'zone':
          this.selectedBuilding = {
            kind: 'zone', x, y,
            buildingType: cls.buildingType, zoneType: cell.zoneType,
            landValue: cell.landValue, pollution: cell.pollution,
            serviceCoverage: cell.serviceCoverage,
            services: {
              power: this.state.power.isPowered(x, y) ? 0 : -1,
              water: this.state.water.isSupplied(x, y) ? 0 : -1,
              police: this.state.police.getCostRatio(x, y),
              fire: this.state.fire.getCostRatio(x, y),
              garbage: this.state.garbage.getCostRatio(x, y),
              health: this.state.health.getCostRatio(x, y),
              education: this.state.education.getCostRatio(x, y),
              deathCare: this.state.deathCare.getCostRatio(x, y),
            },
            abandonmentStress: this.simLoop.getAbandonmentStress(x, y),
            isAbandoned: cell.reserved === ABANDONED,
          };
          this.applyViewMode(ViewMode.NORMAL);
          break;
        case 'transport':
          this.selectTransportStop(x, y, cls.transportType);
          break;
        case 'infra': {
          const primary = findPrimaryCell(this.state.grid, x, y);
          const px = primary?.x ?? x;
          const py = primary?.y ?? y;
          const center = getInfraCenterById(px, py, cell.buildingId);
          const details = this.getInfraDetails(cls.config.type, center.cx, center.cy);
          // Airport has dynamic cost based on size; other infra uses fixed InfraConfig cost
          let infraCost = cls.config.cost;
          if (cls.config.type === 'airport') {
            const ap = this.state.airport.findAtCell(x, y);
            if (ap) infraCost = getAirportBuildCost(ap.size);
          }
          this.selectedBuilding = {
            kind: 'infra', x, y,
            infraType: cls.config.type, name: cls.config.name,
            cost: infraCost, details,
          };
          this.applyViewMode(ViewMode.NORMAL);
          break;
        }
      }
    } else {
      this.selectedBuilding = null;
      this.applyViewMode(ViewMode.NORMAL);
    }
    this.audioManager.playSfx('click');
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
      ridersPerWeek: (stop?.lastDayRiders || stop?.dailyRiders) ?? 0,
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
    return isInfraType(tool);
  }

  private updateCursorSize(): void {
    const cfg = this.isInfraTool(this.currentTool)
      ? getInfraConfig(this.currentTool as InfraType)
      : null;
    if (cfg) {
      if (cfg.type === 'airport') {
        // Airport uses center-based placement with dynamic footprint
        const footprint = getAirportFootprint(this.selectedAirportSize ?? 'SMALL');
        this.gridCursor.setSize(footprint, footprint, true);
      } else {
        const { w, h } = getRotatedSize(cfg.width, cfg.height, this.currentRotation);
        this.gridCursor.setSize(w, h);
      }
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
      const infraType = this.currentTool as InfraType;
      const groundwaterFn = (cx: number, cy: number) => getGroundwaterLevel(this.state.grid, cx, cy);
      this.placementPreview.updateInfra(
        infraType,
        this.currentRotation,
        this.gridCursor.gridX,
        this.gridCursor.gridY,
        this.state.grid,
        this.state.budget.funds,
        groundwaterFn,
        infraType === 'airport' ? (this.selectedAirportSize ?? 'SMALL') : undefined,
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
    } else {
      this.placementPreview.hide();
      if (this.currentTool === 'select') {
        this.applySelectAndHoverHighlight();
      }
    }
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
    this.overlayRenderer.setOverlay(type, this.sceneManager.scene, this.state.grid, data);
    this.computeOverlayHighlightCells(type);
    this.updatePlacementPreview();
    this.onUIUpdate?.();
  }

  toggleOverlay(type: OverlayType): void {
    if (this.overlayRenderer.getOverlay() === type) {
      this.setOverlay('none');
    } else {
      this.setOverlay(type);
    }
  }

  private buildOverlayData(type: OverlayType): Map<string, number> | undefined {
    if (type === 'none') return undefined;
    const data = new Map<string, number>();
    const ctx = this.state as OverlayBuildContext;
    this.state.grid.forEachCell((cell, x, y) => {
      const value = buildOverlayValue(ctx, type, cell, x, y);
      if (value > 0) data.set(`${x},${y}`, value);
    });
    return data;
  }

  // ── Coverage overlay: building highlight (green→yellow→red gradient) ──

  /** Get road-cost overlay info: cost map + budget for a given overlay type. */
  private getRoadCostOverlay(overlayType: OverlayType): { costMap: ReadonlyMap<string, number>; budget: number; residentialOnly: boolean } | null {
    switch (overlayType) {
      case 'police': return { costMap: this.state.police.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.POLICE_BUDGET, residentialOnly: false };
      case 'fire': return { costMap: this.state.fire.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.FIRE_BUDGET, residentialOnly: false };
      case 'garbage': return { costMap: this.state.garbage.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.GARBAGE_BUDGET, residentialOnly: true };
      case 'health': return { costMap: this.state.health.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.HEALTH_BUDGET, residentialOnly: false };
      case 'education': return { costMap: this.state.education.getCoveredCellsWithCost(), budget: ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET, residentialOnly: false };
      default: return null;
    }
  }

  /** Compute and cache overlay building highlight cells. Applied every frame by reapplyOverlayHighlight(). */
  private computeOverlayHighlightCells(overlayType: OverlayType): void {
    this.overlayHighlightCells = [];

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
      park: 0x4caf50,
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

  getState(): GameState {
    return this.state;
  }

  getAbandonmentStress(x: number, y: number): number {
    return this.simLoop.getAbandonmentStress(x, y);
  }

  /** Create a bus route with traffic pathfinding. Returns the route or null if no path. */
  createBusRoute(stops: readonly TransportStop[], vehicleCount = 1): TransportRoute | null {
    this.simLoop.ensureLaneGraph();
    const lg = this.simLoop.laneGraph;
    const grid = this.state.grid;
    return this.state.bus.createRouteWithTraffic(
      [...stops],
      vehicleCount,
      (fx, fy, tx, ty) => gridAStarPath({ x: fx, y: fy }, { x: tx, y: ty }, grid),
      (cellPath) => refineLanePath(lg, cellPath),
      this.state.traffic,
    );
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

  private getInfraDetails(type: InfraType, cx: number, cy: number): Record<string, string | number> {
    return getInfraDetailsFromCtx(this.state as InfraDetailContext, type, cx, cy);
  }

  getSelectedBuilding(): SelectedBuilding | null {
    const sel = this.selectedBuilding;
    if (!sel) return null;

    if (sel.kind === 'infra') {
      return { ...sel, details: this.getInfraDetails(sel.infraType, sel.x, sel.y) };
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
        ridersPerWeek: (stop?.lastDayRiders || stop?.dailyRiders) ?? 0,
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
        services: {
          power: this.state.power.isPowered(x, y) ? 0 : -1,
          water: this.state.water.isSupplied(x, y) ? 0 : -1,
          police: this.state.police.getCostRatio(x, y),
          fire: this.state.fire.getCostRatio(x, y),
          garbage: this.state.garbage.getCostRatio(x, y),
          health: this.state.health.getCostRatio(x, y),
          education: this.state.education.getCostRatio(x, y),
          deathCare: this.state.deathCare.getCostRatio(x, y),
        },
        abandonmentStress: this.simLoop.getAbandonmentStress(x, y),
        isAbandoned: cell?.reserved === ABANDONED,
      };
    }

    return { ...sel };
  }

  async saveCurrentGame(slotId: number, name: string): Promise<void> {
    const data = serializeGameState(this.state, { abandonmentStress: this.simLoop.abandonmentStress });
    const population = this.state.citizens.getPopulation();
    await saveGame(slotId, name, data, population);
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
    const points = pathCells.map(c => new THREE.Vector3(c.x, 0.2, c.y));

    // Calculate estimated cost
    if (this.isRailTool()) {
      this.previewCost = points.length * RAIL.COST_PER_CELL;
    } else {
      const roadConfig = ROAD_CONFIGS[this.currentRoadType];
      this.previewCost = points.length * roadConfig.cost;
    }
    this.onUIUpdate?.();

    // Show semi-transparent road surface preview
    const laneCount = getLaneCount(this.currentRoadType);
    const roadWidth = ROAD_WIDTHS[this.currentRoadType] ?? (0.2 + laneCount * 0.15);
    this.placementPreview.updateRoadDrag(
      points.map(p => ({ x: p.x, y: p.z })),
      roadWidth,
    );

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x4fc3f7, linewidth: 2, transparent: true, opacity: 0.6 });
    this.previewLine = new THREE.Line(geometry, material);
    this.sceneManager.scene.add(this.previewLine);
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
    if (milestone && milestone.id !== this.lastMilestoneId) {
      this.lastMilestoneId = milestone.id;
      this.showNotification(`Milestone: ${milestone.name}! (Pop ${milestone.populationRequired}) — Unlocked: ${milestone.unlocks.join(', ')}`, 8);
      this.audioManager.playSfx('milestone');
      this.onUIUpdate?.();
    }
  }

  private checkRandomDisaster(): void {
    const pop = this.state.citizens.getPopulation();
    const result = tryRandomDisaster(this.state.grid.width, this.state.grid.height, pop);
    if (!result) return;

    applyDisasterDamage(this.state.grid, result.damagedCells);
    // Evict citizens from destroyed buildings
    for (const { x, y } of result.damagedCells) {
      this.state.citizens.evictBuilding(`${x},${y}`, this.state.clock.tick);
    }
    this.audioManager.playSfx('disaster');
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

  getEconomyBreakdown() {
    return computeEconomyBreakdown({
      ...buildIncomeCalcDeps(this.state),
      roadTileCount: countRoadTiles(this.state.grid),
      loans: this.state.budget.loans,
      loanInterestRate: this.state.budget.loanInterestRate,
      powerMaintenanceCost: this.state.power.getMaintenanceCost(),
      waterMaintenanceCost: this.state.water.getMaintenanceCost(),
      transportOperatingCost: getTotalTransportOperatingCost(this.state),
    });
  }

  getTrafficStats() {
    return computeTrafficStats({
      vehicleCount: this.state.traffic.getVehicleCount(),
      topCongested: this.state.traffic.getTopCongested(8),
      avgPathLength: this.state.traffic.getAveragePathLength(),
      roadTileCount: countRoadTiles(this.state.grid),
    });
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
