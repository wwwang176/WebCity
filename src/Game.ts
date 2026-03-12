import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager';
import { TerrainRenderer } from './renderer/TerrainRenderer';
import { RoadRenderer } from './renderer/RoadRenderer';
import { BuildingRenderer } from './renderer/BuildingRenderer';
import { VehicleRenderer, type VehicleData } from './renderer/VehicleRenderer';
import { TrafficLightRenderer } from './renderer/TrafficLightRenderer';
import { OverlayRenderer } from './renderer/OverlayRenderer';
import { GridCursor } from './renderer/GridCursor';
import { WeatherRenderer } from './renderer/WeatherRenderer';
import { createGameState, type GameState } from './core/simulation/GameState';
import { SimulationLoop } from './core/simulation/SimulationLoop';
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType, RoadDirection, ROAD_CONFIGS } from './core/road/types';
import { ZoneType, TerrainType } from './core/grid/types';
import { normalizeRect, findAtPosition } from './core/grid/GridHelpers';
import { ZoneManager } from './core/zone/ZoneManager';
import { type OverlayType } from './renderer/OverlayRenderer';
import { AudioManager } from './audio/AudioManager';
import { getBuildingType, type BuildingType } from './core/building/types';
import { ECONOMY } from './core/economy/TaxMultipliers';
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { serializeGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { getTotalTransportOperatingCost } from './core/transport/TransportRegistry';
import { DisasterType, createDisaster, calculateDamage } from './core/climate/Disaster';
import { getLaneCount } from './core/traffic/TrafficSimulation';
import { classifyVehicleType } from './core/traffic/VehicleClassification';
import { getInfraConfig, getInfraConfigById, getInfraBuildingId, getRotatedSize, isInfrastructureBuilding, isInfraType, isZoneBuilding, type InfraType, type Rotation } from './core/building/InfraConfig';
import { canPlaceInfra, placeInfraOnGrid, removeInfraFromGrid, findPrimaryCell, forEachMultiCell, getInfraCenter, getInfraCenterById, MULTI_CELL_OCCUPIED, BURNED, ROTATION_RESERVED } from './core/building/InfraPlacement';
import { PlacementPreview } from './renderer/PlacementPreview';
import { HighlightManager } from './renderer/HighlightManager';
import { TransportRouteRenderer } from './renderer/TransportRouteRenderer';
import { MetroTunnelRenderer } from './renderer/MetroTunnelRenderer';
import { getAirportFootprint, type AirportSize } from './core/transport/AirportSystem';
import { collectTransportVehicles } from './core/transport/collectTransportVehicles';
import { collectTransportRoutes } from './core/transport/collectTransportRoutes';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from './core/building/InfraServiceActions';
import { calculateZoneIncomes } from './core/economy/IncomeCalculator';

import {
  ViewMode,
  VIEW_MODE_OPACITY,
  getTransportStopType,
  getTransportFocusMode,
  type TransportStopKind,
} from './core/ViewMode';
import { computeTunnelSegments } from './core/transport/MetroTunnelPath';
import { getBuildReasonMessage } from './core/grid/BuildReasonMessages';
import { getCoverageService } from './core/overlay/CoverageOverlay';
import { FerryAnimator } from './renderer/FerryAnimator';
import { TrackRenderer } from './renderer/TrackRenderer';
import { RailBuilder } from './core/rail/RailBuilder';
import { RailNetwork } from './core/rail/RailNetwork';
import { RailType, TrackDirection, RAIL } from './core/rail/types';
import { LevelCrossingSystem } from './core/rail/LevelCrossingSystem';
import { LevelCrossingRenderer } from './renderer/LevelCrossingRenderer';
import { TrainAnimator } from './renderer/TrainAnimator';

/** Overlay display scaling constants used by buildOverlayData. */
export const OVERLAY_SCALE = {
  /** Groundwater level → overlay value multiplier */
  GROUNDWATER_FACTOR: 0.4,
  /** ZoneType enum → overlay value multiplier */
  ZONE_TYPE_FACTOR: 15,
  /** Traffic density → overlay value multiplier */
  TRAFFIC_DENSITY_FACTOR: 20,
  /** Max raw value for pollution/landValue (stored as 0-255) */
  RAW_MAX: 255,
  /** Overlay display maximum */
  DISPLAY_MAX: 100,
  /** Base crime value before reduction */
  CRIME_BASE: 40,
  /** Boolean coverage display value (for police/fire/health/etc.) */
  COVERAGE_VALUE: 80,
} as const;

/** Road widths matching RoadRenderer (world units per cell). */
const ROAD_WIDTHS_FOR_LANES: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};


/** Terrain generation parameters for initial map setup. */
export const TERRAIN_GEN = {
  /** River center position as fraction of map size */
  RIVER_POSITION_RATIO: 0.7,
  /** Sine wave frequency for river meandering */
  RIVER_WAVE_FREQUENCY: 0.1,
  /** Sine wave amplitude (cells) for river meandering */
  RIVER_WAVE_AMPLITUDE: 3,
  /** Half-width of the river (river extends ±RIVER_HALF_WIDTH from center) */
  RIVER_HALF_WIDTH: 1,

  /** Number of random forest patches */
  FOREST_PATCH_COUNT: 8,
  /** Radius (cells) of each forest patch */
  FOREST_PATCH_RADIUS: 3,
  /** Probability a cell within a patch becomes forest */
  FOREST_FILL_CHANCE: 0.7,

  /** Mountain center X as fraction of map size */
  MOUNTAIN_X_RATIO: 0.15,
  /** Mountain center Y as fraction of map size */
  MOUNTAIN_Y_RATIO: 0.85,
  /** Radius (cells) of the mountain area */
  MOUNTAIN_RADIUS: 4,
  /** Base elevation at mountain center */
  MOUNTAIN_PEAK_ELEVATION: 3,
  /** Elevation decay rate per unit distance from center */
  MOUNTAIN_ELEVATION_DECAY: 0.5,
} as const;

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
      this.rebuildRailNetworkFromGrid();
    }

    // Generate terrain only for new games
    if (!loadedState) {
      this.generateTerrain(mapSize);
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

  /** Rebuild rail network graph from grid data (used when loading saved games). */
  private rebuildRailNetworkFromGrid(): void {
    const g = this.state.grid;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const cell = g.getCell(x, y);
        if (!cell || cell.railType === RailType.NONE) continue;
        const id = `${x},${y}`;
        this.railNetwork.addNode(id);
        // Connect to south/east neighbors to avoid duplicate edges
        if ((cell.railFlags & TrackDirection.SOUTH) !== 0) {
          this.railNetwork.addEdge(id, `${x},${y + 1}`);
        }
        if ((cell.railFlags & TrackDirection.EAST) !== 0) {
          this.railNetwork.addEdge(id, `${x + 1},${y}`);
        }
      }
    }
  }

  private generateTerrain(size: number): void {
    const T = TERRAIN_GEN;

    // Create a river
    for (let y = 0; y < size; y++) {
      const riverX = Math.floor(size * T.RIVER_POSITION_RATIO + Math.sin(y * T.RIVER_WAVE_FREQUENCY) * T.RIVER_WAVE_AMPLITUDE);
      for (let dx = -T.RIVER_HALF_WIDTH; dx <= T.RIVER_HALF_WIDTH; dx++) {
        const x = riverX + dx;
        if (x >= 0 && x < size) {
          this.state.grid.setCell(x, y, { terrainType: TerrainType.WATER });
        }
      }
    }

    // Create some forest patches
    const fr = T.FOREST_PATCH_RADIUS;
    for (let i = 0; i < T.FOREST_PATCH_COUNT; i++) {
      const cx = Math.floor(Math.random() * size);
      const cy = Math.floor(Math.random() * size);
      for (let dy = -fr; dy <= fr; dy++) {
        for (let dx = -fr; dx <= fr; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const cell = this.state.grid.getCell(x, y);
            if (cell && cell.terrainType === TerrainType.PLAIN && Math.random() < T.FOREST_FILL_CHANCE) {
              this.state.grid.setCell(x, y, { terrainType: TerrainType.FOREST });
            }
          }
        }
      }
    }

    // Small mountain area
    const mr = T.MOUNTAIN_RADIUS;
    const mx = Math.floor(size * T.MOUNTAIN_X_RATIO);
    const my = Math.floor(size * T.MOUNTAIN_Y_RATIO);
    const mr2 = mr * mr;
    for (let dy = -mr; dy <= mr; dy++) {
      for (let dx = -mr; dx <= mr; dx++) {
        if (dx * dx + dy * dy <= mr2) {
          const x = mx + dx;
          const y = my + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            this.state.grid.setCell(x, y, {
              terrainType: TerrainType.MOUNTAIN,
              elevation: T.MOUNTAIN_PEAK_ELEVATION - Math.sqrt(dx * dx + dy * dy) * T.MOUNTAIN_ELEVATION_DECAY,
            });
          }
        }
      }
    }
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
    switch (key) {
      case 'q': this.sceneManager.rotateCamera(-Math.PI / 4); break;
      case 'e': this.sceneManager.rotateCamera(Math.PI / 4); break;
      case '1': this.setTool('select'); break;
      case '2': this.setTool('road_2lane'); break;
      case '3': this.setTool('zone_r'); break;
      case '4': this.setTool('zone_c'); break;
      case '5': this.setTool('zone_i'); break;
      case '6': this.setTool('zone_o'); break;
      case '7': this.setTool('road_rural'); break;
      case '8': this.setTool('power'); break;
      case '9': this.setTool('water'); break;
      case '0': this.setTool('demolish'); break;
      case 'escape': this.setTool('select'); this.dragStart = null; break;
      case 'delete': this.setTool('demolish'); break;
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
      // Overlay toggles
      case 'f1': this.toggleOverlay('power'); break;
      case 'f2': this.toggleOverlay('water'); break;
      case 'f3': this.toggleOverlay('pollution'); break;
      case 'f4': this.toggleOverlay('landValue'); break;
      case 'f5': this.toggleOverlay('traffic'); break;
      case 'f6': this.toggleOverlay('zone'); break;
    }
  }

  private handleToolAction(x1: number, y1: number, x2: number, y2: number): void {
    switch (this.currentTool) {
      case 'select': {
        const cell = this.state.grid.getCell(x1, y1);
        if (cell && cell.buildingId > 0) {
          const bt = getBuildingType(cell.buildingId);
          if (bt) {
            this.selectedBuilding = {
              kind: 'zone',
              x: x1, y: y1,
              buildingType: bt,
              zoneType: cell.zoneType,
              landValue: cell.landValue,
              pollution: cell.pollution,
              serviceCoverage: cell.serviceCoverage,
            };
            this.applyViewMode(ViewMode.NORMAL);
          } else {
            const transportType = getTransportStopType(cell.buildingId);
            if (transportType) {
              this.selectTransportStop(x1, y1, transportType);
            } else {
              const infraCfg = getInfraConfigById(cell.buildingId);
              if (infraCfg) {
                const primary = findPrimaryCell(this.state.grid, x1, y1);
                const px = primary?.x ?? x1;
                const py = primary?.y ?? y1;
                const center = getInfraCenterById(px, py, cell.buildingId);
                const details = this.getInfraDetails(infraCfg.type, center.cx, center.cy);
                this.selectedBuilding = {
                  kind: 'infra',
                  x: x1, y: y1,
                  infraType: infraCfg.type,
                  name: infraCfg.name,
                  cost: infraCfg.cost,
                  details,
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
        break;
      }
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
          this.notification = `Cannot build road: ${getBuildReasonMessage(result.reason)}`;
          this.notificationTimer = 4;
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
          this.notification = `Cannot build track: ${getBuildReasonMessage(result.reason)}`;
          this.notificationTimer = 4;
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
    const groundwaterFn = (cx: number, cy: number) => this.getGroundwaterLevel(cx, cy);
    const check = canPlaceInfra(this.state.grid, x, y, infraType, this.currentRotation, groundwaterFn);
    if (!check.ok) {
      const messages: Record<string, string> = {
        OUT_OF_BOUNDS: 'Out of bounds',
        WATER_TILE: 'Cannot build on water',
        TILE_OCCUPIED: 'Tile is occupied',
        NO_GROUNDWATER: 'No groundwater here — build near rivers',
        UNKNOWN_TYPE: 'Unknown building type',
      };
      this.notification = messages[check.reason] ?? 'Cannot build here';
      this.notificationTimer = 3;
      return;
    }

    const cost = cfg.cost;
    if (this.state.budget.funds < cost) {
      this.notification = `Insufficient funds (need $${cost})`;
      this.notificationTimer = 3;
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
      this.notification = 'Out of bounds';
      this.notificationTimer = 3;
      return;
    }
    // Rail stations can be built on track cells (may have road for level crossing)
    if (type === 'rail') {
      if (cell.railType === RailType.NONE) {
        this.notification = 'Train station must be built on rail track';
        this.notificationTimer = 3;
        return;
      }
      if (cell.buildingId !== 0) {
        this.notification = 'Tile is occupied';
        this.notificationTimer = 3;
        return;
      }
    } else if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0) {
      this.notification = 'Tile is occupied';
      this.notificationTimer = 3;
      return;
    }
    const infraTypeMap: Record<string, InfraType> = {
      bus: 'bus_stop', metro: 'metro_station', rail: 'train_station', ferry: 'ferry_dock', airport: 'airport',
    };
    const airportCosts: Record<AirportSize, number> = { SMALL: 5000, MEDIUM: 15000, LARGE: 40000 };
    const infraCfg = getInfraConfig(infraTypeMap[type]!);
    const baseCost = infraCfg?.cost ?? 500;
    const cost = type === 'airport' ? airportCosts[this.selectedAirportSize ?? 'SMALL'] : baseCost;
    if (this.state.budget.funds < cost) {
      this.notification = `Insufficient funds (need $${cost})`;
      this.notificationTimer = 3;
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
        this.notification = 'Train station must be built on rail track';
        this.notificationTimer = 4;
        return;
      }
    } else if (type === 'ferry') {
      // Validate shore placement: must be land AND adjacent to water
      const waterChecker = {
        isWater: (fx: number, fy: number) => {
          const fc = this.state.grid.getCell(fx, fy);
          // Must NOT be water (must be land/shore)
          if (fc && fc.terrainType === TerrainType.WATER) return false;
          // Must have at least one adjacent water cell
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nc = this.state.grid.getCell(fx + dx!, fy + dy!);
            if (nc && nc.terrainType === TerrainType.WATER) return true;
          }
          return false;
        },
      };
      const dock = this.state.ferry.addDock(x, y, waterChecker);
      if (!dock) {
        this.state.budget.funds += cost;
        this.notification = 'Ferry dock must be placed on shore (land next to water)';
        this.notificationTimer = 4;
        return;
      }
    } else if (type === 'airport') {
      const airportSize: AirportSize = this.selectedAirportSize ?? 'SMALL';
      const footprint = getAirportFootprint(airportSize);
      const half = Math.floor(footprint / 2);

      // Check all NxN cells are free
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const c = this.state.grid.getCell(x + dx, y + dy);
          if (!c) {
            this.state.budget.funds += cost;
            this.notification = 'Airport area is out of bounds';
            this.notificationTimer = 4;
            return;
          }
          if (c.roadType !== RoadType.NONE || c.buildingId !== 0) {
            this.state.budget.funds += cost;
            this.notification = 'Airport area is not fully clear';
            this.notificationTimer = 4;
            return;
          }
        }
      }

      const pop = this.state.citizens.getPopulation();
      const result = this.state.airport.build(x, y, airportSize, pop);
      if (!result) {
        this.state.budget.funds += cost;
        const req = this.state.airport.getPopulationRequired(airportSize);
        this.notification = `Airport requires population >= ${req.toLocaleString()}`;
        this.notificationTimer = 4;
        return;
      }

      // Set all NxN cells to airport buildingId
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          this.state.grid.setCell(x + dx, y + dy, { buildingId: getInfraBuildingId('airport') });
        }
      }
      this.audioManager.playSfx('build');
      this.dirty.buildings = true;
      return; // skip the default single-cell setCell below
    }
    this.state.grid.setCell(x, y, {
      buildingId: infraCfg?.buildingId ?? getInfraBuildingId('bus_stop'),
      reserved: ROTATION_RESERVED[this.currentRotation],
    });
    this.audioManager.playSfx('build');
    this.dirty.buildings = true;
  }

  /** Returns groundwater level 0-100 based on distance to nearest river tile (max range 3) */
  private getGroundwaterLevel(x: number, y: number): number {
    const grid = this.state.grid;
    const range = 3;
    let minDist = range + 1;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const cell = grid.getCell(x + dx, y + dy);
        if (cell && cell.terrainType === TerrainType.WATER) {
          const dist = Math.abs(dx) + Math.abs(dy); // Manhattan distance
          if (dist < minDist) minDist = dist;
        }
      }
    }
    if (minDist > range) return 0;
    // Closer to water = higher groundwater: dist 0→100, 1→75, 2→50, 3→25
    return Math.round(100 * (1 - (minDist - 1) / range));
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

    // Rebuild meshes per-subsystem when dirty
    const d = this.dirty;
    const anyDirty = d.roads || d.tracks || d.crossings || d.buildings || d.terrain || d.trafficLights;
    if (anyDirty) {
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
        this.syncTrafficLights();
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

    // Update traffic light colors every frame
    this.trafficLightRenderer.update(this.state.trafficLights.getLights());
    // Update level crossing lights/gates animation every frame
    this.levelCrossingRenderer.update(this.elapsedTime, this.levelCrossingSystem.getCrossings());

    // Update cursor color based on tool
    this.updateCursorColor();

    // Advance edge-based vehicles every render frame (independent of tick)
    if (!this.paused) {
      const scaledDt = dt * this.speed;
      const canAdvance = (cur: string, next: string) => {
        const [cx, cy] = cur.split(',').map(Number);
        const [nx, ny] = next.split(',').map(Number);
        // Block at red traffic lights
        if (!this.state.trafficLights.canPass(cx!, cy!, nx!, ny!)) return false;
        // Block at active level crossings (train approaching/passing)
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

    // Update vehicles — read positions for rendering
    const vehicleData: VehicleData[] = this.state.traffic.vehicles.map(v => {
      if (v.arrived) return null;

      // Derive vehicle type from length (assigned in simulation)
      if (!this.vehicleTypes.has(v.id)) {
        this.vehicleTypes.set(v.id, classifyVehicleType(v.length));
      }

      const pos = this.state.traffic.getVehiclePositionOnEdges(v);
      if (!pos) return null;
      const heading = this.state.traffic.getVehicleHeadingOnEdges(v);
      this.vehicleHeadings.set(v.id, heading);

      return {
        id: v.id,
        x: pos.x,
        y: pos.y,
        heading,
        type: this.vehicleTypes.get(v.id)!,
        laneOffset: 0,
      };
    }).filter((v): v is NonNullable<typeof v> => v !== null) as VehicleData[];

    // 收集交通系統車輛（bus/rail/ferry）
    const transportVehicles = collectTransportVehicles({
      bus: this.state.bus,
      rail: this.state.rail,
      ferry: this.state.ferry,
    });

    // 渡輪渲染端動畫（純 LERP，跟地鐵一樣不靠 tick）
    const ferrySpeed = this.paused ? 0 : this.state.clock.speed;
    this.ferryAnimator.update(dt, ferrySpeed, this.state.ferry, transportVehicles);

    // 火車渲染端動畫（沿完整來回路徑循環，到站停靠）
    const trainSpeed = this.paused ? 0 : this.state.clock.speed;
    this.trainAnimator.update(dt, trainSpeed, this.state.rail, transportVehicles);

    // 平交道：根據火車視覺位置的近接觸發（proximity-based）
    const trainPositions = transportVehicles
      .filter(v => v.type === 'rail_train')
      .map(v => ({ x: v.x, y: v.y }));
    this.levelCrossingSystem.update(dt, trainSpeed, trainPositions);

    // 合併道路車輛與交通系統車輛
    const allVehicles: VehicleData[] = vehicleData.concat(transportVehicles as VehicleData[]);
    const vmOp = VIEW_MODE_OPACITY[this.viewMode];
    this.vehicleRenderer.update(allVehicles, this.weatherRenderer.sunIntensity, this.elapsedTime);

    // 更新交通路線渲染
    const routeData = collectTransportRoutes({
      bus: this.state.bus,
      metro: this.state.metro,
      rail: this.state.rail,
      ferry: this.state.ferry,
    });
    // Focus mode: hide route lines (replaced by focused visuals)
    if (this.viewMode !== ViewMode.NORMAL) {
      this.transportRouteRenderer.update([]);
    } else {
      this.transportRouteRenderer.update(routeData);
    }

    // 更新地鐵隧道 + 列車動畫（純渲染端動畫，不依賴 tick）
    const metroLines = this.state.metro.getLines();
    const metroLineData = metroLines.map(line => ({
      lineId: line.id,
      stops: line.stops.map(s => ({ x: s.x, y: s.y })),
      segments: computeTunnelSegments(line.stops.map(s => ({ x: s.x, y: s.y }))),
      trainCount: line.vehicles,
    }));
    const metroSpeedMult = this.paused ? 0 : this.state.clock.speed;
    this.metroTunnelRenderer.update(
      metroLineData,
      this.state.metro.getStations(),
      vmOp.metroTunnel,
      dt * metroSpeedMult,
    );

    // Clean up stale vehicle rendering state
    const activeIds = new Set(this.state.traffic.vehicles.map(v => v.id));
    for (const id of this.vehicleTypes.keys()) {
      if (!activeIds.has(id)) {
        this.vehicleTypes.delete(id);
        this.vehicleHeadings.delete(id);
      }
    }

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

  /** Smoothed position & heading using quadratic bezier at turns */

  /** Scan the grid for intersections (3+ road connections) and sync traffic lights */
  private syncTrafficLights(): void {
    const grid = this.state.grid;
    const tls = this.state.trafficLights;
    const seen = new Set<string>();

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType === RoadType.NONE) return;
      let dirs = 0;
      if (cell.roadFlags & RoadDirection.NORTH) dirs++;
      if (cell.roadFlags & RoadDirection.SOUTH) dirs++;
      if (cell.roadFlags & RoadDirection.EAST) dirs++;
      if (cell.roadFlags & RoadDirection.WEST) dirs++;
      if (dirs >= 3) {
        const key = `${x},${y}`;
        seen.add(key);
        if (!tls.getLight(x, y)) {
          tls.addLight(x, y);
        }
      }
    });

    // Remove lights for intersections that no longer exist
    for (const light of tls.getLights()) {
      if (!seen.has(`${light.x},${light.y}`)) {
        tls.removeLight(light.x, light.y);
      }
    }
  }

  private updateCursorColor(): void {
    const toolColors: Record<ToolType, number> = {
      select: 0xffffff,
      road: 0x424242,
      road_rural: 0x424242,
      road_2lane: 0x424242,
      road_4lane: 0x424242,
      road_6lane: 0x424242,
      road_highway: 0x424242,
      rail_track: 0x6d4c2a,
      zone_r: 0x4caf50,
      zone_rh: 0x2e7d32,
      zone_c: 0x2196f3,
      zone_ch: 0x1565c0,
      zone_i: 0xffa726,
      zone_o: 0xab47bc,
      demolish: 0xf44336,
      power: 0xffeb3b,
      water: 0x03a9f4,
      police: 0x3f51b5,
      fire: 0xd32f2f,
      hospital: 0xe91e63,
      school: 0x795548,
      school_high: 0x6d4c41,
      school_univ: 0x4e342e,
      park: 0x4caf50,
      garbage: 0x795548,
      sewage: 0x607d8b,
      cemetery: 0x9e9e9e,
      district: 0xab47bc,
      bus_stop: 0xff9800,
      metro_station: 0x00bcd4,
      train_station: 0x795548,
      ferry_dock: 0x0288d1,
      airport: 0x9c27b0,
    };
    this.gridCursor.setColor(toolColors[this.currentTool] ?? 0xffffff);
    // Demolish tool gets higher opacity for red highlight preview
    this.gridCursor.setOpacity(this.currentTool === 'demolish' ? 0.6 : 0.3);
  }

  isRoadTool(tool?: ToolType): boolean {
    const t = tool ?? this.currentTool;
    return t === 'road' || t === 'road_rural' || t === 'road_2lane' || t === 'road_4lane' || t === 'road_6lane' || t === 'road_highway';
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
    // Road subtypes set the roadType
    if (tool === 'road') this.currentRoadType = RoadType.TWO_LANE;
    else if (tool === 'road_rural') this.currentRoadType = RoadType.RURAL;
    else if (tool === 'road_2lane') this.currentRoadType = RoadType.TWO_LANE;
    else if (tool === 'road_4lane') this.currentRoadType = RoadType.FOUR_LANE;
    else if (tool === 'road_6lane') this.currentRoadType = RoadType.SIX_LANE;
    else if (tool === 'road_highway') this.currentRoadType = RoadType.HIGHWAY;
    // Update cursor size for infrastructure tools
    this.updateCursorSize();
    // Auto-switch overlay when selecting infrastructure tools
    const toolOverlayMap: Partial<Record<ToolType, OverlayType>> = {
      power: 'power', water: 'water', police: 'police', fire: 'fire',
      hospital: 'health', school: 'education', school_high: 'education', school_univ: 'education', park: 'park', garbage: 'garbage',
      district: 'district',
    };
    const autoOverlay = toolOverlayMap[tool];
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

    const STOP_NAMES: Record<TransportStopKind, string> = {
      bus: 'Bus Stop', metro: 'Metro Station',
      rail: 'Train Station', ferry: 'Ferry Dock',
    };

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

  /** Get the transport system for a given stop type. */
  private getTransportSystem(type: TransportStopKind) {
    switch (type) {
      case 'bus': return this.state.bus;
      case 'metro': return this.state.metro;
      case 'rail': return this.state.rail;
      case 'ferry': return this.state.ferry;
      default: return null;
    }
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
      const groundwaterFn = (cx: number, cy: number) => this.getGroundwaterLevel(cx, cy);
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
      const zoneColors: Record<string, number> = {
        zone_r: 0x4caf50, zone_rh: 0x2e7d32,
        zone_c: 0x2196f3, zone_ch: 0x1565c0,
        zone_i: 0xffc107, zone_o: 0x9c27b0,
      };
      const color = zoneColors[this.currentTool] ?? 0xffffff;
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
    return ['zone_r', 'zone_rh', 'zone_c', 'zone_ch', 'zone_i', 'zone_o'].includes(this.currentTool);
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
    const grid = this.state.grid;

    grid.forEachCell((cell, x, y) => {
      const key = `${x},${y}`;
      let value = 0;

      const O = OVERLAY_SCALE;
      switch (type) {
        case 'power':
          value = this.state.power.isPowered(x, y) ? O.DISPLAY_MAX : 0;
          break;
        case 'water': {
          const supplied = this.state.water.isSupplied(x, y) ? O.DISPLAY_MAX : 0;
          const gw = this.getGroundwaterLevel(x, y);
          value = Math.max(supplied, gw * O.GROUNDWATER_FACTOR);
          break;
        }
        case 'zone':
          if (cell.zoneType > 0) value = cell.zoneType * O.ZONE_TYPE_FACTOR;
          break;
        case 'traffic': {
          const density = this.state.traffic.getSegmentDensity(key);
          value = density * O.TRAFFIC_DENSITY_FACTOR;
          break;
        }
        case 'pollution':
          value = Math.min(O.DISPLAY_MAX, cell.pollution * O.DISPLAY_MAX / O.RAW_MAX);
          break;
        case 'landValue':
          if (cell.buildingId > 0) value = Math.min(O.DISPLAY_MAX, cell.landValue * O.DISPLAY_MAX / O.RAW_MAX);
          break;
        case 'crime':
          if (cell.buildingId > 0) {
            const reduction = this.state.police.getCrimeReduction(x, y);
            value = Math.max(0, O.CRIME_BASE + reduction);
          }
          break;
        // Coverage overlays: police/fire/health/education/park/garbage
        // handled by data-driven lookup (see CoverageOverlay.ts)
        case 'district': {
          const d = this.state.districts.getDistrictAt(x, y);
          if (d) {
            let hash = 0;
            for (let i = 0; i < d.id.length; i++) hash = (hash * 31 + d.id.charCodeAt(i)) & 0xff;
            value = Math.max(20, hash % 100);
          }
          break;
        }
        default: {
          // Data-driven coverage overlays (OCP: add new services in CoverageOverlay.ts)
          const coverageSvc = getCoverageService(this.state, type);
          if (coverageSvc) {
            value = coverageSvc.getCoverage(x, y) ? O.COVERAGE_VALUE : 0;
          }
          break;
        }
      }

      if (value > 0) data.set(key, value);
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
    const s = this.state;
    switch (type) {
      case 'police': {
        const st = findAtPosition(s.police.getStations(), cx, cy);
        return { 'Radius': st?.radius ?? 15, 'Coverage': s.police.getCoverage(cx, cy) ? 'Yes' : 'No' };
      }
      case 'fire': {
        const st = findAtPosition(s.fire.getStations(), cx, cy);
        return { 'Radius': st?.radius ?? 15, 'Active Fires': s.fire.getActiveFires().length };
      }
      case 'hospital': {
        const h = findAtPosition(s.health.getHospitals(), cx, cy);
        return { 'Capacity': h?.capacity ?? 100, 'Radius': h?.radius ?? 12 };
      }
      case 'school': {
        const sc = s.education.getSchools().find(sc => sc.x === cx && sc.y === cy && sc.type === 'elementary');
        return { 'Type': 'Elementary', 'Capacity': sc?.capacity ?? 200, 'Radius': sc?.radius ?? 10 };
      }
      case 'school_high': {
        const sc = s.education.getSchools().find(sc => sc.x === cx && sc.y === cy && sc.type === 'highschool');
        return { 'Type': 'High School', 'Capacity': sc?.capacity ?? 300, 'Radius': sc?.radius ?? 12 };
      }
      case 'school_univ': {
        const sc = s.education.getSchools().find(sc => sc.x === cx && sc.y === cy && sc.type === 'university');
        return { 'Type': 'University', 'Capacity': sc?.capacity ?? 500, 'Radius': sc?.radius ?? 15 };
      }
      case 'park': {
        const p = findAtPosition(s.parks.getParks(), cx, cy);
        return { 'Radius': p?.radius ?? 5 };
      }
      case 'garbage': {
        const f = findAtPosition(s.garbage.getFacilities(), cx, cy);
        return { 'Capacity': f?.capacity ?? 1000, 'Load': f?.currentLoad ?? 0 };
      }
      case 'sewage': {
        return { 'Status': 'Active' };
      }
      case 'cemetery': {
        const c = findAtPosition(s.deathCare.getCemeteries(), cx, cy);
        return { 'Capacity': c?.capacity ?? 500, 'Used': c?.used ?? 0 };
      }
      case 'power': {
        const p = findAtPosition(s.power.getPlants(), cx, cy);
        return { 'Output': p?.output ?? 500, 'Type': p?.type ?? 'coal' };
      }
      case 'water': {
        const w = findAtPosition(s.water.getPlants(), cx, cy);
        return { 'Output': w?.output ?? 500 };
      }
      case 'airport': {
        return { 'Status': 'Operational' };
      }
      default:
        return {};
    }
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
    const roadWidth = ROAD_WIDTHS_FOR_LANES[this.currentRoadType] ?? (0.2 + laneCount * 0.15);
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
      this.notification = `Milestone: ${milestone.name}! (Pop ${milestone.populationRequired}) — Unlocked: ${milestone.unlocks.join(', ')}`;
      this.notificationTimer = 8;
      this.audioManager.playSfx('milestone');
      this.onUIUpdate?.();
    }
  }

  private checkRandomDisaster(): void {
    // ~0.1% chance per tick (roughly once per 1000 ticks / ~4 game months)
    if (Math.random() > 0.001) return;
    const pop = this.state.citizens.getPopulation();
    if (pop < 50) return; // no disasters in tiny cities

    const types = [DisasterType.EARTHQUAKE, DisasterType.TORNADO, DisasterType.FOREST_FIRE];
    const type = types[Math.floor(Math.random() * types.length)]!;
    const x = Math.floor(Math.random() * this.state.grid.width);
    const y = Math.floor(Math.random() * this.state.grid.height);
    const intensity = 0.3 + Math.random() * 0.5;

    const disaster = createDisaster(type, x, y, intensity);

    // Apply damage to buildings in radius
    for (let dy = -disaster.radius; dy <= disaster.radius; dy++) {
      for (let dx = -disaster.radius; dx <= disaster.radius; dx++) {
        const bx = x + dx;
        const by = y + dy;
        const cell = this.state.grid.getCell(bx, by);
        if (!cell || cell.buildingId === 0) continue;
        const damage = calculateDamage(disaster, bx, by);
        if (damage > 0.5) {
          // Destroy building
          this.state.grid.setCell(bx, by, { buildingId: 0 });
        }
      }
    }

    // Play disaster sound and show notification
    this.audioManager.playSfx('disaster');
    const names: Record<string, string> = {
      EARTHQUAKE: 'Earthquake', TORNADO: 'Tornado', FOREST_FIRE: 'Forest Fire'
    };
    this.notification = `Disaster: ${names[type] ?? type} at (${x},${y})! Intensity: ${Math.round(intensity * 100)}%`;
    this.notificationTimer = 10;
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

  getEconomyBreakdown(): {
    residential: number; commercial: number; industrial: number; office: number;
    roadMaintenance: number; loanInterest: number; powerCost: number; waterCost: number;
    transportCost: number;
  } {
    // Shared income calculation (DRY: same logic as SimulationLoop.calculateIncome)
    const incomes = calculateZoneIncomes({
      forEachCell: (fn) => this.state.grid.forEachCell(fn),
      taxRates: this.state.taxRates,
      getCitizensByHome: (key) => this.state.citizens.getCitizensByHome(key),
    });

    let roadCount = 0;
    this.state.grid.forEachCell((cell) => {
      if (cell.roadType !== RoadType.NONE) roadCount++;
    });

    const roadMaintenance = roadCount * ECONOMY.ROAD_MAINTENANCE_PER_TILE;
    const loanInterest = this.state.budget.loans * this.state.budget.loanInterestRate;
    const powerCost = this.state.power.getMaintenanceCost();
    const waterCost = this.state.water.getMaintenanceCost();
    const transportCost = getTotalTransportOperatingCost(this.state);

    return {
      residential: Math.round(incomes.residential * 10) / 10,
      commercial: Math.round(incomes.commercial * 10) / 10,
      industrial: Math.round(incomes.industrial * 10) / 10,
      office: Math.round(incomes.office * 10) / 10,
      roadMaintenance: Math.round(roadMaintenance * 10) / 10,
      loanInterest: Math.round(loanInterest * 10) / 10,
      powerCost,
      waterCost,
      transportCost,
    };
  }

  getTrafficStats(): {
    vehicleCount: number; topCongested: { segment: string; density: number }[];
    avgPathLength: number; totalRoads: number;
  } {
    let totalRoads = 0;
    const grid = this.state.grid;
    grid.forEachCell((cell) => {
      if (cell.roadType !== RoadType.NONE) totalRoads++;
    });
    return {
      vehicleCount: this.state.traffic.getVehicleCount(),
      topCongested: this.state.traffic.getTopCongested(8),
      avgPathLength: Math.round(this.state.traffic.getAveragePathLength() * 10) / 10,
      totalRoads,
    };
  }

  takeLoan(amount: number): void {
    if (amount <= 0) return;
    this.state.budget.funds += amount;
    this.state.budget.loans += amount;
    this.notification = `Loan taken: $${amount.toLocaleString()}`;
    this.notificationTimer = 4;
    this.onUIUpdate?.();
  }

  repayLoan(amount: number): void {
    if (amount <= 0) return;
    const actual = Math.min(amount, this.state.budget.loans, this.state.budget.funds);
    if (actual <= 0) return;
    this.state.budget.funds -= actual;
    this.state.budget.loans -= actual;
    this.notification = `Loan repaid: $${actual.toLocaleString()}`;
    this.notificationTimer = 4;
    this.onUIUpdate?.();
  }
}
