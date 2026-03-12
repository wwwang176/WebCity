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
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType, ROAD_CONFIGS } from './core/road/types';
import { ZoneType, TerrainType } from './core/grid/types';
import { normalizeRect, countRoadTiles } from './core/grid/GridHelpers';
import { ZoneManager } from './core/zone/ZoneManager';
import { type OverlayType } from './renderer/OverlayRenderer';
import { AudioManager } from './audio/AudioManager';
import { getBuildingType, type BuildingType } from './core/building/types';
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { serializeGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { getTotalTransportOperatingCost } from './core/transport/TransportRegistry';
import { tryRandomDisaster, DISASTER_NAMES } from './core/climate/Disaster';
import { getLaneCount } from './core/traffic/TrafficSimulation';
import { classifyVehicleType } from './core/traffic/VehicleClassification';
import { getInfraConfig, getInfraConfigById, getInfraBuildingId, getRotatedSize, isInfrastructureBuilding, isInfraType, type InfraType, type Rotation } from './core/building/InfraConfig';
import { canPlaceInfra, placeInfraOnGrid, removeInfraFromGrid, findPrimaryCell, forEachMultiCell, getInfraCenter, getInfraCenterById, ROTATION_RESERVED } from './core/building/InfraPlacement';
import { PlacementPreview } from './renderer/PlacementPreview';
import { HighlightManager } from './renderer/HighlightManager';
import { TransportRouteRenderer } from './renderer/TransportRouteRenderer';
import { MetroTunnelRenderer } from './renderer/MetroTunnelRenderer';
import { getAirportFootprint, type AirportSize } from './core/transport/AirportSystem';
import { collectTransportVehicles } from './core/transport/collectTransportVehicles';
import { collectTransportRoutes } from './core/transport/collectTransportRoutes';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from './core/building/InfraServiceActions';
import { getInfraDetails as getInfraDetailsFromCtx, type InfraDetailContext } from './core/building/InfraDetails';
import { getEconomyBreakdown as computeEconomyBreakdown } from './core/economy/EconomyBreakdown';

import {
  ViewMode,
  VIEW_MODE_OPACITY,
  getTransportStopType,
  getTransportFocusMode,
  type TransportStopKind,
} from './core/ViewMode';
import { computeTunnelSegments } from './core/transport/MetroTunnelPath';
import { getBuildReasonMessage } from './core/grid/BuildReasonMessages';
import { buildOverlayValue, type OverlayBuildContext } from './core/overlay/OverlayBuilders';
import { getTrafficStats as computeTrafficStats } from './core/traffic/TrafficStats';
import { generateTerrain, TERRAIN_GEN } from './core/grid/TerrainGenerator';
import { getGroundwaterLevel, isShorePosition } from './core/grid/Terrain';
import { FerryAnimator } from './renderer/FerryAnimator';
import { TrackRenderer } from './renderer/TrackRenderer';
import { RailBuilder } from './core/rail/RailBuilder';
import { RailNetwork, rebuildRailNetworkFromGrid } from './core/rail/RailNetwork';
import { RailType, RAIL } from './core/rail/types';
import { LevelCrossingSystem } from './core/rail/LevelCrossingSystem';
import { LevelCrossingRenderer } from './renderer/LevelCrossingRenderer';
import { TrainAnimator } from './renderer/TrainAnimator';



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

/** Infrastructure placement validation error messages. */
const INFRA_PLACEMENT_MESSAGES: Record<string, string> = {
  OUT_OF_BOUNDS: 'Out of bounds',
  WATER_TILE: 'Cannot build on water',
  TILE_OCCUPIED: 'Tile is occupied',
  NO_GROUNDWATER: 'No groundwater here — build near rivers',
  UNKNOWN_TYPE: 'Unknown building type',
};

/** Map transport stop type to InfraType (used for cost/config lookup). */
const TRANSPORT_TO_INFRA_TYPE: Record<string, InfraType> = {
  bus: 'bus_stop', metro: 'metro_station', rail: 'train_station',
  ferry: 'ferry_dock', airport: 'airport',
};

/** Airport build costs by size. */
const AIRPORT_COSTS: Record<AirportSize, number> = {
  SMALL: 5000, MEDIUM: 15000, LARGE: 40000,
};

/** Transport stop display names. */
const STOP_NAMES: Record<TransportStopKind, string> = {
  bus: 'Bus Stop', metro: 'Metro Station',
  rail: 'Train Station', ferry: 'Ferry Dock',
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

export interface SelectedZoneBuilding {
  kind: 'zone';
  x: number;
  y: number;
  buildingType: BuildingType;
  zoneType: ZoneType;
  landValue: number;
  pollution: number;
  serviceCoverage: number;
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
}

export type SelectedBuilding = SelectedZoneBuilding | SelectedInfraBuilding | SelectedTransportStop;

export class Game {
  private sceneManager: SceneManager;
  private terrainRenderer: TerrainRenderer;
  private roadRenderer: RoadRenderer;
  private buildingRenderer: BuildingRenderer;
  private vehicleRenderer: VehicleRenderer;
  private trafficLightRenderer: TrafficLightRenderer;
  private overlayRenderer: OverlayRenderer;
  private weatherRenderer: WeatherRenderer;
  private gridCursor: GridCursor;
  private placementPreview: PlacementPreview;
  private highlightManager: HighlightManager;
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
  private vehicleHeadings = new Map<number, number>();
  /** 渡輪渲染端動畫（純 LERP，不靠 tick） */
  private ferryAnimator = new FerryAnimator();
  /** 火車渲染端動畫（純 LERP，不靠 tick） */
  private trainAnimator = new TrainAnimator();
  previewCost: number | null = null; // estimated cost during road drag
  activeDistrictId: string | null = null; // currently selected district for painting
  currentRotation: Rotation = 0; // infrastructure placement rotation (R key cycles)
  selectedAirportSize: AirportSize | null = null; // selected airport size for placement
  viewMode: ViewMode = ViewMode.NORMAL;

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
    this.simLoop.onBuildingUpdated = (x, y, zoneType, level, burned) => {
      this.buildingRenderer.updateBuilding(x, y, zoneType, level, burned);
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
      isWater: (x: number, y: number) => {
        const cell = grid.getCell(x, y);
        return cell ? cell.terrainType === TerrainType.WATER : false;
      },
    });

    // Rebuild rail network from existing grid data (for loaded games)
    if (loadedState) {
      rebuildRailNetworkFromGrid(this.state.grid, this.railNetwork);
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
    this.transportRouteRenderer.build(this.sceneManager.scene);
    this.metroTunnelRenderer.build(this.sceneManager.scene);
    this.gridCursor = new GridCursor(this.sceneManager.scene, mapSize, mapSize);
    this.placementPreview = new PlacementPreview(this.sceneManager.scene, this.buildingRenderer);
    this.highlightManager = new HighlightManager(
      this.sceneManager.scene,
      (x, y) => this.state.grid.getCell(x, y)?.elevation ?? 0,
    );

    // Center camera
    this.sceneManager.panCamera(mapSize / 2, mapSize / 2);

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
        this.highlightManager.clear();
        this.applySelectHighlight();
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
      case ' ':
        this.paused = !this.paused;
        if (this.paused) this.state.clock.pause();
        else this.state.clock.resume();
        this.onUIUpdate?.();
        break;
      case '+':
      case '=':
        this.speed = Math.min(3, this.speed + 1) as 1 | 2 | 3;
        this.state.clock.setSpeed(this.speed as 1 | 2 | 3);
        this.onUIUpdate?.();
        break;
      case '-':
        this.speed = Math.max(1, this.speed - 1) as 1 | 2 | 3;
        this.state.clock.setSpeed(this.speed as 1 | 2 | 3);
        this.onUIUpdate?.();
        break;
    }
  }

  private handleToolAction(x1: number, y1: number, x2: number, y2: number): void {
    switch (this.currentTool) {
      case 'select':
        this.handleSelectClick(x1, y1);
        break;
      case 'road':
      case 'road_rural':
      case 'road_2lane':
      case 'road_4lane':
      case 'road_6lane':
      case 'road_highway': {
        const result = this.roadBuilder.buildRoad(
          { x: x1, y: y1 }, { x: x2, y: y2 },
          this.currentRoadType,
          this.state.budget.funds,
        );
        if (result.success && result.cost) {
          this.state.budget.funds -= result.cost;
          this.simLoop.markLaneGraphDirty();
          this.audioManager.playSfx('build');
        } else if (!result.success && result.reason) {
          this.showNotification(`Cannot build road: ${getBuildReasonMessage(result.reason)}`);
        }
        this.dirty.roads = true;
        this.dirty.crossings = true;
        this.dirty.trafficLights = true;
        break;
      }
      case 'rail_track': {
        const result = this.railBuilder.buildTrack(
          { x: x1, y: y1 }, { x: x2, y: y2 },
          this.state.budget.funds,
        );
        if (result.success && result.cost) {
          this.state.budget.funds -= result.cost;
          this.audioManager.playSfx('build');
        } else if (!result.success && result.reason) {
          this.showNotification(`Cannot build track: ${getBuildReasonMessage(result.reason)}`);
        }
        this.dirty.tracks = true;
        this.dirty.crossings = true;
        break;
      }
      case 'demolish': {
        const demolishedRoadCells = this.collectRoadCells(x1, y1, x2, y2);
        this.demolish(x1, y1, x2, y2);
        this.simLoop.markLaneGraphDirty(demolishedRoadCells);
        this.audioManager.playSfx('demolish');
        break;
      }
      case 'district':
        this.paintDistrict(x1, y1, x2, y2);
        this.audioManager.playSfx('zone');
        break;
      default: {
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

  private applyZone(x1: number, y1: number, x2: number, y2: number, zoneType: ZoneType): void {
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
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

  private demolish(x1: number, y1: number, x2: number, y2: number): void {
    const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
    const demolished = new Set<string>(); // track already-demolished multi-cell buildings
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (!cell) continue;

        // Handle multi-cell infrastructure: find primary and demolish entire building
        if (isInfrastructureBuilding(cell.buildingId)) {
          // Airport uses custom footprint — handle separately
          if (cell.buildingId === getInfraBuildingId('airport')) {
            const key = `airport:${x},${y}`;
            if (demolished.has(key)) continue;
            // removeInfraService handles clearing all airport cells
            this.removeInfraService(getInfraBuildingId('airport'), x, y);
            // Mark all airport cells as demolished
            const airport = this.state.airport.getAirports().find(a => {
              const fp = getAirportFootprint(a.size);
              const half = Math.floor(fp / 2);
              return x >= a.x - half && x <= a.x + half && y >= a.y - half && y <= a.y + half;
            });
            // Airport already removed, mark center so we skip duplicate hits
            if (!airport) demolished.add(key);
            continue;
          }

          const primary = findPrimaryCell(this.state.grid, x, y);
          if (primary) {
            const key = `${primary.x},${primary.y}`;
            if (demolished.has(key)) continue; // already handled
            demolished.add(key);

            // Remove from service layer using primary cell coords
            this.removeInfraService(cell.buildingId, primary.x, primary.y);

            // Clear all cells of the multi-cell building
            removeInfraFromGrid(this.state.grid, x, y);
            continue;
          }

          // Transport stops are 1×1 infrastructure — handle directly
          const infraCfg = getInfraConfigById(cell.buildingId);
          if (infraCfg && infraCfg.width === 1 && infraCfg.height === 1) {
            this.removeInfraService(cell.buildingId, x, y);
            this.state.grid.setCell(x, y, { buildingId: 0, reserved: 0 });
            continue;
          }
        }

        // Regular cell demolition (roads, zones, regular buildings, track)
        if (cell.railType !== RailType.NONE) {
          this.railBuilder.removeTrack(x, y);
        }
        this.state.grid.setCell(x, y, {
          roadType: 0,
          roadFlags: 0,
          zoneType: ZoneType.NONE,
          buildingId: 0,
          reserved: 0,
        });
      }
    }
    this.markAllDirty();
  }

  private removeInfraService(buildingId: number, px: number, py: number): void {
    // Services store center coordinates, so compute center from primary cell
    const { cx, cy } = getInfraCenterById(px, py, buildingId);

    // Data-driven civic service + transport stop removal (OCP: add new types in InfraServiceActions)
    const infraCfg = getInfraConfigById(buildingId);
    if (infraCfg) {
      const actions = INFRA_SERVICE_ACTIONS[infraCfg.type];
      if (actions) {
        // All services use center coordinates; for 1x1 buildings center === primary
        actions.remove(this.state as unknown as InfraServiceContext, cx, cy);
        return;
      }
    }
    if (buildingId === getInfraBuildingId('airport')) {
      // Find airport whose footprint covers this cell
      const airport = this.state.airport.getAirports().find(a => {
        const fp = getAirportFootprint(a.size);
        const half = Math.floor(fp / 2);
        return px >= a.x - half && px <= a.x + half && py >= a.y - half && py <= a.y + half;
      });
      if (airport) {
        const fp = getAirportFootprint(airport.size);
        const half = Math.floor(fp / 2);
        // Clear all cells in the airport footprint
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const c = this.state.grid.getCell(airport.x + dx, airport.y + dy);
            if (c && c.buildingId === getInfraBuildingId('airport')) {
              this.state.grid.setCell(airport.x + dx, airport.y + dy, { buildingId: 0, reserved: 0 });
            }
          }
        }
        this.state.airport.remove(airport.id);
      }
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

  private placeInfrastructure(x: number, y: number, type: 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery'): void {
    const infraType = type as InfraType;
    const cfg = getInfraConfig(infraType);
    if (!cfg) return;

    // Validate multi-cell placement
    const groundwaterFn = (cx: number, cy: number) => getGroundwaterLevel(this.state.grid, cx, cy);
    const check = canPlaceInfra(this.state.grid, x, y, infraType, this.currentRotation, groundwaterFn);
    if (!check.ok) {
      this.showNotification(INFRA_PLACEMENT_MESSAGES[check.reason] ?? 'Cannot build here', 3);
      return;
    }

    const cost = cfg.cost;
    if (this.state.budget.funds < cost) {
      this.showNotification(`Insufficient funds (need $${cost})`, 3);
      return;
    }
    this.state.budget.funds -= cost;

    // Place on grid (multi-cell)
    placeInfraOnGrid(this.state.grid, x, y, infraType, this.currentRotation);

    // Compute center for service coverage (coverage radiates from building center)
    const { cx, cy } = getInfraCenter(x, y, infraType, this.currentRotation);

    // Register with service layer at center coordinates (data-driven via InfraServiceActions)
    const actions = INFRA_SERVICE_ACTIONS[type];
    if (actions) {
      actions.place(this.state as unknown as InfraServiceContext, cx, cy);
    }
    this.audioManager.playSfx('build');
    this.dirty.buildings = true;
  }

  private placeTransportStop(x: number, y: number, type: 'bus' | 'metro' | 'rail' | 'ferry' | 'airport'): void {
    const cell = this.state.grid.getCell(x, y);
    if (!cell) {
      this.showNotification('Out of bounds', 3);
      return;
    }
    // Rail stations can be built on track cells (may have road for level crossing)
    if (type === 'rail') {
      if (cell.railType === RailType.NONE) {
        this.showNotification('Train station must be built on rail track', 3);
        return;
      }
      if (cell.buildingId !== 0) {
        this.showNotification('Tile is occupied', 3);
        return;
      }
    } else if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0) {
      this.showNotification('Tile is occupied', 3);
      return;
    }
    const infraCfg = getInfraConfig(TRANSPORT_TO_INFRA_TYPE[type]!);
    const baseCost = infraCfg?.cost ?? 500;
    const cost = type === 'airport' ? AIRPORT_COSTS[this.selectedAirportSize ?? 'SMALL'] : baseCost;
    if (this.state.budget.funds < cost) {
      this.showNotification(`Insufficient funds (need $${cost})`, 3);
      return;
    }
    this.state.budget.funds -= cost;

    if (type === 'bus') {
      this.state.bus.addStop(x, y);
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
    const footprint = getAirportFootprint(airportSize);
    const half = Math.floor(footprint / 2);

    // Check all NxN cells are free
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const c = this.state.grid.getCell(x + dx, y + dy);
        if (!c) {
          this.state.budget.funds += cost;
          this.showNotification('Airport area is out of bounds');
          return false;
        }
        if (c.roadType !== RoadType.NONE || c.buildingId !== 0) {
          this.state.budget.funds += cost;
          this.showNotification('Airport area is not fully clear');
          return false;
        }
      }
    }

    const pop = this.state.citizens.getPopulation();
    const result = this.state.airport.build(x, y, airportSize, pop);
    if (!result) {
      this.state.budget.funds += cost;
      const req = this.state.airport.getPopulationRequired(airportSize);
      this.showNotification(`Airport requires population >= ${req.toLocaleString()}`);
      return false;
    }

    // Set all NxN cells to airport buildingId
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        this.state.grid.setCell(x + dx, y + dy, { buildingId: getInfraBuildingId('airport') });
      }
    }
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
        // Milestone detection
        this.checkMilestone();

        // Random disaster events (small chance per tick)
        this.checkRandomDisaster();

        // Auto-save
        if (this.autoSaver.shouldSave(this.state.clock.tick)) {
          const data = serializeGameState(this.state);
          saveGame(0, 'AutoSave', data).catch(() => { /* ignore save errors */ });
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

    // Update traffic light colors every frame
    this.trafficLightRenderer.update(this.state.trafficLights.getLights());
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
      const canAdvance = (cur: string, next: string) => {
        const [cx, cy] = cur.split(',').map(Number);
        const [nx, ny] = next.split(',').map(Number);
        if (!this.state.trafficLights.canPass(cx!, cy!, nx!, ny!)) return false;
        if (this.levelCrossingSystem.isCrossingBlocked(nx!, ny!)) return false;
        return true;
      };
      const getSpeedLimit = (cellKey: string) => {
        const [gx, gy] = cellKey.split(',').map(Number);
        const cell = this.state.grid.getCell(gx!, gy!);
        if (!cell || cell.roadType <= 0) return 50;
        const cfg = ROAD_CONFIGS[cell.roadType as RoadType];
        return cfg?.speedLimit ?? 50;
      };
      this.state.traffic.advanceEdgeVehicles(scaledDt, canAdvance, getSpeedLimit);
    }

    // Collect road vehicle positions for rendering
    const vehicleData: VehicleData[] = this.state.traffic.vehicles.map(v => {
      if (v.arrived) return null;
      if (!this.vehicleTypes.has(v.id)) {
        this.vehicleTypes.set(v.id, classifyVehicleType(v.length));
      }
      const pos = this.state.traffic.getVehiclePositionOnEdges(v);
      if (!pos) return null;
      const heading = this.state.traffic.getVehicleHeadingOnEdges(v);
      this.vehicleHeadings.set(v.id, heading);
      return { id: v.id, x: pos.x, y: pos.y, heading, type: this.vehicleTypes.get(v.id)!, laneOffset: 0 };
    }).filter((v): v is NonNullable<typeof v> => v !== null) as VehicleData[];

    // Collect transport system vehicles (bus/rail/ferry)
    const transportVehicles = collectTransportVehicles({
      bus: this.state.bus, rail: this.state.rail, ferry: this.state.ferry,
    });

    // Animate ferry and train (render-side LERP, independent of tick)
    const simSpeed = this.paused ? 0 : this.state.clock.speed;
    this.ferryAnimator.update(dt, simSpeed, this.state.ferry, transportVehicles);
    this.trainAnimator.update(dt, simSpeed, this.state.rail, transportVehicles);

    // Level crossing proximity trigger
    const trainPositions = transportVehicles
      .filter(v => v.type === 'rail_train')
      .map(v => ({ x: v.x, y: v.y }));
    this.levelCrossingSystem.update(dt, simSpeed, trainPositions);

    // Merge road + transport vehicles and render
    const allVehicles: VehicleData[] = vehicleData.concat(transportVehicles as VehicleData[]);
    this.vehicleRenderer.update(allVehicles, this.weatherRenderer.sunIntensity, this.elapsedTime);

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
    const metroLineData = metroLines.map(line => ({
      lineId: line.id,
      stops: line.stops.map(s => ({ x: s.x, y: s.y })),
      segments: computeTunnelSegments(line.stops.map(s => ({ x: s.x, y: s.y }))),
      trainCount: line.vehicles,
    }));
    const metroSpeedMult = this.paused ? 0 : this.state.clock.speed;
    this.metroTunnelRenderer.update(
      metroLineData, this.state.metro.getStations(), vmOp.metroTunnel, dt * metroSpeedMult,
    );

    // Clean up stale vehicle rendering state
    const activeIds = new Set(this.state.traffic.vehicles.map(v => v.id));
    for (const id of this.vehicleTypes.keys()) {
      if (!activeIds.has(id)) {
        this.vehicleTypes.delete(id);
        this.vehicleHeadings.delete(id);
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
    this.highlightManager.clear();
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

  /** Select a transport stop and switch to its focus view mode. */
  /** Handle click in select mode: identify building type and show details. */
  private handleSelectClick(x: number, y: number): void {
    const cell = this.state.grid.getCell(x, y);
    if (cell && cell.buildingId > 0) {
      const bt = getBuildingType(cell.buildingId);
      if (bt) {
        this.selectedBuilding = {
          kind: 'zone', x, y,
          buildingType: bt, zoneType: cell.zoneType,
          landValue: cell.landValue, pollution: cell.pollution,
          serviceCoverage: cell.serviceCoverage,
        };
        this.applyViewMode(ViewMode.NORMAL);
      } else {
        const transportType = getTransportStopType(cell.buildingId);
        if (transportType) {
          this.selectTransportStop(x, y, transportType);
        } else {
          const infraCfg = getInfraConfigById(cell.buildingId);
          if (infraCfg) {
            const primary = findPrimaryCell(this.state.grid, x, y);
            const px = primary?.x ?? x;
            const py = primary?.y ?? y;
            const center = getInfraCenterById(px, py, cell.buildingId);
            const details = this.getInfraDetails(infraCfg.type, center.cx, center.cy);
            this.selectedBuilding = {
              kind: 'infra', x, y,
              infraType: infraCfg.type, name: infraCfg.name,
              cost: infraCfg.cost, details,
            };
            this.applyViewMode(ViewMode.NORMAL);
          }
        }
      }
    } else {
      this.selectedBuilding = null;
      this.applyViewMode(ViewMode.NORMAL);
    }
    this.audioManager.playSfx('click');
  }

  private selectTransportStop(x: number, y: number, type: TransportStopKind): void {
    const system = this.getTransportSystem(type);
    const stops = system?.getStops() ?? [];
    const stop = stops.find(s => s.x === x && s.y === y);
    const routes = system?.getRoutes() ?? [];
    const routeCount = stop
      ? routes.filter(r => r.stops.some(s => s.id === stop.id)).length
      : 0;
    const vehicleCount = stop
      ? routes.filter(r => r.stops.some(s => s.id === stop.id))
          .reduce((sum, r) => sum + r.vehicles, 0)
      : 0;

    this.selectedBuilding = {
      kind: 'transport',
      x, y,
      transportType: type,
      name: STOP_NAMES[type],
      routes: routeCount,
      vehicles: vehicleCount,
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

    if (sel.kind === 'infra') {
      const cells: { x: number; y: number }[] = [];
      forEachMultiCell(this.state.grid, sel.x, sel.y, (cx, cy) => cells.push({ x: cx, y: cy }));
      if (cells.length === 0) return;
      this.highlightManager.highlightCells(
        cells, 0xffffff,
        this.getAllHighlightMeshes(),
        this.buildingRenderer.buildingInfraGroups,
      );
    } else {
      this.highlightManager.highlightCells(
        [{ x: sel.x, y: sel.y }], 0xffffff,
        this.getAllHighlightMeshes(),
        this.buildingRenderer.buildingInfraGroups,
      );
    }
  }

  /** Collect all InstancedMeshes that support highlight (buildings + roads + tracks). */
  private getAllHighlightMeshes(): readonly (THREE.InstancedMesh | THREE.Mesh)[] {
    return [
      ...this.buildingRenderer.buildingMeshes,
      ...this.roadRenderer.highlightMeshes,
      ...this.trackRenderer.highlightMeshes,
    ];
  }

  private updatePlacementPreview(): void {
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
      );
    } else if (this.currentTool === 'demolish') {
      if (this.dragStart) {
        // Demolish drag preview — red tint on ground + buildings in range
        const minX = Math.min(this.dragStart.x, this.gridCursor.gridX);
        const maxX = Math.max(this.dragStart.x, this.gridCursor.gridX);
        const minY = Math.min(this.dragStart.y, this.gridCursor.gridY);
        const maxY = Math.max(this.dragStart.y, this.gridCursor.gridY);
        this.highlightManager.highlight(
          minX, minY, maxX, maxY, 0xff0000,
          this.getAllHighlightMeshes(),
          this.buildingRenderer.buildingInfraGroups,
        );
      } else {
        // Demolish hover: highlight multi-cell building footprint
        const gx = this.gridCursor.gridX;
        const gy = this.gridCursor.gridY;
        const cell = this.state.grid.getCell(gx, gy);
        if (cell && isInfrastructureBuilding(cell.buildingId)) {
          const cells: { x: number; y: number }[] = [];
          forEachMultiCell(this.state.grid, gx, gy, (cx, cy) => cells.push({ x: cx, y: cy }));
          if (cells.length > 0) {
            this.highlightManager.highlightCells(
              cells, 0xff0000,
              this.getAllHighlightMeshes(),
              this.buildingRenderer.buildingInfraGroups,
            );
          } else {
            this.highlightManager.clear();
          }
        } else {
          this.highlightManager.clear();
        }
      }
    } else if (this.dragStart && this.isZoneTool()) {
      // Zone drag preview — tint ground + buildings in range
      const color = ZONE_PREVIEW_COLORS[this.currentTool] ?? 0xffffff;
      const minX = Math.min(this.dragStart.x, this.gridCursor.gridX);
      const maxX = Math.max(this.dragStart.x, this.gridCursor.gridX);
      const minY = Math.min(this.dragStart.y, this.gridCursor.gridY);
      const maxY = Math.max(this.dragStart.y, this.gridCursor.gridY);
      this.highlightManager.highlight(
        minX, minY, maxX, maxY, color,
        this.getAllHighlightMeshes(),
        this.buildingRenderer.buildingInfraGroups,
      );
    } else {
      this.placementPreview.hide();
      if (this.currentTool === 'select' && this.selectedBuilding) {
        this.applySelectHighlight();
      } else {
        this.highlightManager.clear();
      }
    }
  }

  private isZoneTool(): boolean {
    return TOOL_TO_ZONE[this.currentTool] !== undefined;
  }

  setOverlay(type: OverlayType): void {
    const data = this.buildOverlayData(type);
    this.overlayRenderer.setOverlay(type, this.sceneManager.scene, this.state.grid, data);
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
    const ctx = this.state as unknown as OverlayBuildContext;
    this.state.grid.forEachCell((cell, x, y) => {
      const value = buildOverlayValue(ctx, type, cell, x, y);
      if (value > 0) data.set(`${x},${y}`, value);
    });
    return data;
  }

  setOnUIUpdate(callback: () => void): void {
    this.onUIUpdate = callback;
  }

  getState(): GameState {
    return this.state;
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
    return this.selectedBuilding;
  }

  async saveCurrentGame(slotId: number, name: string): Promise<void> {
    const data = serializeGameState(this.state);
    await saveGame(slotId, name, data);
  }

  private updatePreviewLine(): void {
    if (!this.dragStart || !this.isDragBuildTool()) {
      this.clearPreviewLine();
      this.placementPreview.hide();
      this.previewCost = null;
      return;
    }
    this.clearPreviewLine();
    const x1 = this.dragStart.x;
    const y1 = this.dragStart.y;
    const x2 = this.gridCursor.gridX;
    const y2 = this.gridCursor.gridY;
    const points: THREE.Vector3[] = [];
    // Build L-shaped path: horizontal then vertical
    const dx = x2 > x1 ? 1 : -1;
    const dy = y2 > y1 ? 1 : -1;
    for (let x = x1; x !== x2 + dx; x += dx) {
      points.push(new THREE.Vector3(x, 0.2, y1));
    }
    for (let y = y1 + dy; y !== y2 + dy; y += dy) {
      points.push(new THREE.Vector3(x2, 0.2, y));
    }
    if (points.length < 2) return;

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

    // Apply damage to grid
    for (const { x, y } of result.damagedCells) {
      const cell = this.state.grid.getCell(x, y);
      if (cell && cell.buildingId !== 0) {
        this.state.grid.setCell(x, y, { buildingId: 0 });
      }
    }

    const d = result.disaster;
    this.audioManager.playSfx('disaster');
    this.showNotification(`Disaster: ${DISASTER_NAMES[d.type] ?? d.type} at (${d.epicenterX},${d.epicenterY})! Intensity: ${Math.round(d.intensity * 100)}%`, 10);
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
      forEachCell: (fn) => this.state.grid.forEachCell(fn),
      taxRates: this.state.taxRates,
      getCitizensByHome: (key) => this.state.citizens.getCitizensByHome(key),
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
