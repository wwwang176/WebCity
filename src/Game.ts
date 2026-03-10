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
import { ZoneManager } from './core/zone/ZoneManager';
import { type OverlayType } from './renderer/OverlayRenderer';
import { AudioManager } from './audio/AudioManager';
import { getBuildingType, type BuildingType } from './core/building/types';
import { IncomeLevel } from './core/citizen/types';
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { serializeGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { DisasterType, createDisaster, calculateDamage } from './core/climate/Disaster';
import { getLaneCount } from './core/traffic/TrafficSimulation';
import { getInfraConfig, getInfraConfigById, getRotatedSize, type InfraType, type Rotation } from './core/building/InfraConfig';
import { canPlaceInfra, placeInfraOnGrid, removeInfraFromGrid, findPrimaryCell, getInfraCenter, getInfraCenterById, MULTI_CELL_OCCUPIED } from './core/building/InfraPlacement';
import { PlacementPreview } from './renderer/PlacementPreview';
import { getAirportFootprint, type AirportSize } from './core/transport/AirportSystem';

/** Road widths matching RoadRenderer (world units per cell). */
const ROAD_WIDTHS_FOR_LANES: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};


export type ToolType = 'select' | 'road' | 'road_rural' | 'road_2lane' | 'road_4lane' | 'road_6lane' | 'road_highway' | 'zone_r' | 'zone_rh' | 'zone_c' | 'zone_ch' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery' | 'district' | 'bus_stop' | 'metro_station' | 'tram_stop' | 'train_station' | 'ferry_dock' | 'airport' | 'taxi_stand';

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

export type SelectedBuilding = SelectedZoneBuilding | SelectedInfraBuilding;

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
  private state: GameState;
  private simLoop: SimulationLoop;
  private roadBuilder: RoadBuilder;
  private zoneManager: ZoneManager;
  private audioManager: AudioManager;
  private autoSaver: AutoSaver;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tickAccumulator = 0;
  private renderDirty = true;

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
  previewCost: number | null = null; // estimated cost during road drag
  activeDistrictId: string | null = null; // currently selected district for painting
  currentRotation: Rotation = 0; // infrastructure placement rotation (R key cycles)
  selectedAirportSize: AirportSize | null = null; // selected airport size for placement

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
    this.roadBuilder = new RoadBuilder(this.state.grid);
    this.zoneManager = new ZoneManager(this.state.grid);

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

    this.weatherRenderer = new WeatherRenderer(this.sceneManager, mapSize);

    // Build initial scene
    this.terrainRenderer.build(this.sceneManager.scene, this.state.grid);
    this.vehicleRenderer.build(this.sceneManager.scene);
    this.gridCursor = new GridCursor(this.sceneManager.scene, mapSize, mapSize);
    this.placementPreview = new PlacementPreview(this.sceneManager.scene);

    // Center camera
    this.sceneManager.panCamera(mapSize / 2, mapSize / 2);

    // Input handlers
    this.setupInput(container);

    // Game loop
    this.sceneManager.onUpdate((dt) => this.update(dt));
    this.sceneManager.start();
  }

  private generateTerrain(size: number): void {
    // Create a river
    for (let y = 0; y < size; y++) {
      const riverX = Math.floor(size * 0.7 + Math.sin(y * 0.1) * 3);
      for (let dx = -1; dx <= 1; dx++) {
        const x = riverX + dx;
        if (x >= 0 && x < size) {
          this.state.grid.setCell(x, y, { terrainType: TerrainType.WATER });
        }
      }
    }

    // Create some forest patches
    for (let i = 0; i < 8; i++) {
      const cx = Math.floor(Math.random() * size);
      const cy = Math.floor(Math.random() * size);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const cell = this.state.grid.getCell(x, y);
            if (cell && cell.terrainType === TerrainType.PLAIN && Math.random() > 0.3) {
              this.state.grid.setCell(x, y, { terrainType: TerrainType.FOREST });
            }
          }
        }
      }
    }

    // Small mountain area
    const mx = Math.floor(size * 0.15);
    const my = Math.floor(size * 0.85);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy <= 16) {
          const x = mx + dx;
          const y = my + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            this.state.grid.setCell(x, y, {
              terrainType: TerrainType.MOUNTAIN,
              elevation: 3 - Math.sqrt(dx * dx + dy * dy) * 0.5,
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
            }
          }
        } else {
          this.selectedBuilding = null;
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
          const reasonMessages: Record<string, string> = {
            WATER_TILE: 'water in the way',
            MOUNTAIN_TILE: 'mountain in the way',
            BUILDING_EXISTS: 'building in the way',
            OUT_OF_BOUNDS: 'out of bounds',
            INSUFFICIENT_FUNDS: 'insufficient funds',
          };
          const msg = reasonMessages[result.reason] ?? result.reason;
          this.notification = `Cannot build road: ${msg}`;
          this.notificationTimer = 4;
        }
        this.renderDirty = true;
        break;
      }
      case 'zone_r':
        this.applyZone(x1, y1, x2, y2, ZoneType.RESIDENTIAL_LOW);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_rh':
        this.applyZone(x1, y1, x2, y2, ZoneType.RESIDENTIAL_HIGH);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_c':
        this.applyZone(x1, y1, x2, y2, ZoneType.COMMERCIAL_LOW);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_ch':
        this.applyZone(x1, y1, x2, y2, ZoneType.COMMERCIAL_HIGH);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_i':
        this.applyZone(x1, y1, x2, y2, ZoneType.INDUSTRIAL);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_o':
        this.applyZone(x1, y1, x2, y2, ZoneType.OFFICE);
        this.audioManager.playSfx('zone');
        break;
      case 'demolish':
        this.demolish(x1, y1, x2, y2);
        this.simLoop.markLaneGraphDirty();
        this.audioManager.playSfx('demolish');
        break;
      case 'power':
        this.placeInfrastructure(x1, y1, 'power');
        break;
      case 'water':
        this.placeInfrastructure(x1, y1, 'water');
        break;
      case 'police':
        this.placeInfrastructure(x1, y1, 'police');
        break;
      case 'fire':
        this.placeInfrastructure(x1, y1, 'fire');
        break;
      case 'hospital':
        this.placeInfrastructure(x1, y1, 'hospital');
        break;
      case 'school':
        this.placeInfrastructure(x1, y1, 'school');
        break;
      case 'school_high':
        this.placeInfrastructure(x1, y1, 'school_high');
        break;
      case 'school_univ':
        this.placeInfrastructure(x1, y1, 'school_univ');
        break;
      case 'park':
        this.placeInfrastructure(x1, y1, 'park');
        break;
      case 'garbage':
        this.placeInfrastructure(x1, y1, 'garbage');
        break;
      case 'sewage':
        this.placeInfrastructure(x1, y1, 'sewage');
        break;
      case 'cemetery':
        this.placeInfrastructure(x1, y1, 'cemetery');
        break;
      case 'district':
        this.paintDistrict(x1, y1, x2, y2);
        this.audioManager.playSfx('zone');
        break;
      case 'bus_stop':
        this.placeTransportStop(x1, y1, 'bus');
        break;
      case 'metro_station':
        this.placeTransportStop(x1, y1, 'metro');
        break;
      case 'tram_stop':
        this.placeTransportStop(x1, y1, 'tram');
        break;
      case 'train_station':
        this.placeTransportStop(x1, y1, 'rail');
        break;
      case 'ferry_dock':
        this.placeTransportStop(x1, y1, 'ferry');
        break;
      case 'airport':
        this.placeTransportStop(x1, y1, 'airport');
        break;
      case 'taxi_stand':
        this.placeTransportStop(x1, y1, 'taxi');
        break;
    }
    this.onUIUpdate?.();
  }

  private applyZone(x1: number, y1: number, x2: number, y2: number, zoneType: ZoneType): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    this.zoneManager.setZoneRect({ x: minX, y: minY }, { x: maxX, y: maxY }, zoneType);
    this.renderDirty = true;
  }

  private demolish(x1: number, y1: number, x2: number, y2: number): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const demolished = new Set<string>(); // track already-demolished multi-cell buildings
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (!cell) continue;

        // Handle multi-cell infrastructure: find primary and demolish entire building
        if (cell.buildingId >= 236 && cell.buildingId <= 254) {
          // Airport (237) uses custom footprint — handle separately
          if (cell.buildingId === 237) {
            const key = `airport:${x},${y}`;
            if (demolished.has(key)) continue;
            // removeInfraService handles clearing all airport cells
            this.removeInfraService(237, x, y);
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

          // Transport stops (236-242 except 237) are 1x1 — handle directly
          if (cell.buildingId >= 236 && cell.buildingId <= 242) {
            this.removeInfraService(cell.buildingId, x, y);
            this.state.grid.setCell(x, y, { buildingId: 0, reserved: 0 });
            continue;
          }
        }

        // Regular cell demolition (roads, zones, regular buildings)
        this.state.grid.setCell(x, y, {
          roadType: 0,
          roadFlags: 0,
          zoneType: ZoneType.NONE,
          buildingId: 0,
          reserved: 0,
        });
      }
    }
    this.renderDirty = true;
  }

  private removeInfraService(buildingId: number, px: number, py: number): void {
    // Services store center coordinates, so compute center from primary cell
    const { cx, cy } = getInfraCenterById(px, py, buildingId);

    if (buildingId === 254) this.state.power.removePlant(cx, cy);
    if (buildingId === 253) this.state.water.removePlant(cx, cy);
    if (buildingId === 252) {
      const sid = this.state.police.getStations().find(s => s.x === cx && s.y === cy);
      if (sid) this.state.police.removeStation(sid.id);
    }
    if (buildingId === 251) {
      const sid = this.state.fire.getStations().find(s => s.x === cx && s.y === cy);
      if (sid) this.state.fire.removeStation(sid.id);
    }
    if (buildingId === 250) {
      const hid = this.state.health.getHospitals().find(h => h.x === cx && h.y === cy);
      if (hid) this.state.health.removeHospital(hid.id);
    }
    if (buildingId === 249 || buildingId === 244 || buildingId === 243) {
      const sid = this.state.education.getSchools().find(s => s.x === cx && s.y === cy);
      if (sid) this.state.education.removeSchool(sid.id);
    }
    if (buildingId === 248) {
      const pid = this.state.parks.getParks().find(p => p.x === cx && p.y === cy);
      if (pid) this.state.parks.removePark(pid.id);
    }
    if (buildingId === 247) {
      const gid = this.state.garbage.getFacilities().find(g => g.x === cx && g.y === cy);
      if (gid) this.state.garbage.removeFacility(gid.id);
    }
    if (buildingId === 246) {
      const sid = this.state.sewage.getTreatmentPlants().find(s => s.x === cx && s.y === cy);
      if (sid) this.state.sewage.removeTreatmentPlant(sid.id);
    }
    if (buildingId === 245) {
      const cid = this.state.deathCare.getCemeteries().find(c => c.x === cx && c.y === cy);
      if (cid) this.state.deathCare.removeCemetery(cid.id);
    }
    // Transport stops (buildingId 236-242)
    if (buildingId === 242) {
      const sid = this.state.bus.getStops().find(s => s.x === px && s.y === py);
      if (sid) this.state.bus.removeStop(sid.id);
    }
    if (buildingId === 241) {
      const sid = this.state.metro.getStations().find(s => s.x === px && s.y === py);
      if (sid) this.state.metro.removeStation(sid.id);
    }
    if (buildingId === 240) {
      const sid = this.state.tram.getStops().find(s => s.x === px && s.y === py);
      if (sid) this.state.tram.removeStop(sid.id);
    }
    if (buildingId === 239) {
      const sid = this.state.rail.getStations().find(s => s.x === px && s.y === py);
      if (sid) this.state.rail.removeStation(sid.id);
    }
    if (buildingId === 238) {
      const sid = this.state.ferry.getDocks().find(s => s.x === px && s.y === py);
      if (sid) this.state.ferry.removeDock(sid.id);
    }
    if (buildingId === 237) {
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
            if (c && c.buildingId === 237) {
              this.state.grid.setCell(airport.x + dx, airport.y + dy, { buildingId: 0, reserved: 0 });
            }
          }
        }
        this.state.airport.remove(airport.id);
      }
    }
    if (buildingId === 236) {
      const sid = this.state.taxi.getStands().find(s => s.x === px && s.y === py);
      if (sid) this.state.taxi.removeStand(sid.id);
    }
  }

  private paintDistrict(x1: number, y1: number, x2: number, y2: number): void {
    // Create a new district if none is active
    if (!this.activeDistrictId) {
      const count = this.state.districts.getAllDistricts().length;
      const d = this.state.districts.createDistrict(`District ${count + 1}`);
      this.activeDistrictId = d.id;
    }
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        this.state.districts.addCellToDistrict(this.activeDistrictId, x, y);
      }
    }
    this.renderDirty = true;
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

    // Register with service layer at center coordinates
    if (type === 'power') {
      this.state.power.addPlant({ x: cx, y: cy, output: 500, pollution: 10, type: 'coal' });
    } else if (type === 'water') {
      this.state.water.addPlant({ x: cx, y: cy, output: 500 });
    } else if (type === 'police') {
      this.state.police.addStation(cx, cy);
    } else if (type === 'fire') {
      this.state.fire.addStation(cx, cy);
    } else if (type === 'hospital') {
      this.state.health.addHospital(cx, cy);
    } else if (type === 'school') {
      this.state.education.addSchool(cx, cy, 'elementary');
    } else if (type === 'school_high') {
      this.state.education.addSchool(cx, cy, 'highschool');
    } else if (type === 'school_univ') {
      this.state.education.addSchool(cx, cy, 'university');
    } else if (type === 'park') {
      this.state.parks.addPark(cx, cy);
    } else if (type === 'garbage') {
      this.state.garbage.addFacility(cx, cy, 'landfill');
    } else if (type === 'sewage') {
      this.state.sewage.addTreatmentPlant(cx, cy);
    } else if (type === 'cemetery') {
      this.state.deathCare.addCemetery(cx, cy);
    }
    this.audioManager.playSfx('build');
    this.renderDirty = true;
  }

  private placeTransportStop(x: number, y: number, type: 'bus' | 'metro' | 'tram' | 'rail' | 'ferry' | 'airport' | 'taxi'): void {
    const cell = this.state.grid.getCell(x, y);
    if (!cell) {
      this.notification = 'Out of bounds';
      this.notificationTimer = 3;
      return;
    }
    if (cell.roadType !== 0 || cell.buildingId !== 0) {
      this.notification = 'Tile is occupied';
      this.notificationTimer = 3;
      return;
    }
    const costs: Record<string, number> = {
      bus: 100, metro: 3000, tram: 500, rail: 2000, ferry: 1500, airport: 5000, taxi: 200,
    };
    const airportCosts: Record<AirportSize, number> = { SMALL: 5000, MEDIUM: 15000, LARGE: 40000 };
    const buildingIds: Record<string, number> = {
      bus: 242, metro: 241, tram: 240, rail: 239, ferry: 238, airport: 237, taxi: 236,
    };
    const cost = type === 'airport' ? airportCosts[this.selectedAirportSize ?? 'SMALL'] : (costs[type] ?? 500);
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
    } else if (type === 'tram') {
      this.state.tram.addStop(x, y);
    } else if (type === 'rail') {
      this.state.rail.buildStation(x, y);
    } else if (type === 'ferry') {
      // Validate water adjacency for ferry dock
      const waterChecker = {
        isWater: (fx: number, fy: number) => {
          const fc = this.state.grid.getCell(fx, fy);
          if (fc && fc.terrainType === TerrainType.WATER) return true;
          // Also check adjacent cells for water
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
        this.notification = 'Ferry dock must be placed near water';
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
          if (c.roadType !== 0 || c.buildingId !== 0) {
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
          this.state.grid.setCell(x + dx, y + dy, { buildingId: 237 });
        }
      }
      this.audioManager.playSfx('build');
      this.renderDirty = true;
      return; // skip the default single-cell setCell below
    } else if (type === 'taxi') {
      this.state.taxi.addStand(x, y);
    }
    this.state.grid.setCell(x, y, { buildingId: buildingIds[type] ?? 242 });
    this.audioManager.playSfx('build');
    this.renderDirty = true;
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

        // Rebuild visuals periodically (every 10 ticks)
        if (this.state.clock.tick % 10 === 0) {
          this.renderDirty = true;
        }
        // Update ambient audio with current city state
        this.audioManager.updateAmbientState(
          this.state.citizens.getPopulation(),
          this.state.traffic.vehicles.length
        );

        this.onUIUpdate?.();
      }
    }

    // Rebuild meshes when dirty
    if (this.renderDirty) {
      this.roadRenderer.build(this.sceneManager.scene, this.state.grid);
      this.buildingRenderer.build(this.sceneManager.scene, this.state.grid);
      this.terrainRenderer.refreshColors();
      // Sync traffic lights with current intersections
      this.syncTrafficLights();
      this.trafficLightRenderer.build(this.sceneManager.scene, this.state.trafficLights.getLights());
      // Refresh active overlay so it reflects new roads/buildings/coverage
      const currentOverlay = this.overlayRenderer.getOverlay();
      if (currentOverlay && currentOverlay !== 'none') {
        this.setOverlay(currentOverlay);
      }
      this.renderDirty = false;
    }

    // Update traffic light colors every frame
    this.trafficLightRenderer.update(this.state.trafficLights.getLights());

    // Update cursor color based on tool
    this.updateCursorColor();

    // Advance edge-based vehicles every render frame (independent of tick)
    if (!this.paused) {
      const scaledDt = dt * this.speed;
      const canAdvance = (cur: string, next: string) => {
        const [cx, cy] = cur.split(',').map(Number);
        const [nx, ny] = next.split(',').map(Number);
        return this.state.trafficLights.canPass(cx!, cy!, nx!, ny!);
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
        let vtype: VehicleData['type'];
        if (v.length >= 0.44) vtype = 'bus';
        else if (v.length >= 0.33) vtype = 'firetruck';
        else if (v.length >= 0.28) vtype = 'truck';
        else vtype = 'car';
        this.vehicleTypes.set(v.id, vtype);
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
    this.vehicleRenderer.update(vehicleData, this.weatherRenderer.sunIntensity);

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
    this.buildingRenderer.update(sunI);
    this.roadRenderer.update(sunI);
  }

  /** Smoothed position & heading using quadratic bezier at turns */

  /** Scan the grid for intersections (3+ road connections) and sync traffic lights */
  private syncTrafficLights(): void {
    const grid = this.state.grid;
    const tls = this.state.trafficLights;
    const seen = new Set<string>();

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell || cell.roadType === 0) continue;
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
      }
    }

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
      tram_stop: 0x8bc34a,
      train_station: 0x795548,
      ferry_dock: 0x0288d1,
      airport: 0x9c27b0,
      taxi_stand: 0xffc107,
    };
    this.gridCursor.setColor(toolColors[this.currentTool] ?? 0xffffff);
    // Demolish tool gets higher opacity for red highlight preview
    this.gridCursor.setOpacity(this.currentTool === 'demolish' ? 0.6 : 0.3);
  }

  isRoadTool(tool?: ToolType): boolean {
    const t = tool ?? this.currentTool;
    return t === 'road' || t === 'road_rural' || t === 'road_2lane' || t === 'road_4lane' || t === 'road_6lane' || t === 'road_highway';
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.currentRotation = 0; // reset rotation when switching tools
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

  private cycleRotation(): void {
    if (!this.isInfraTool(this.currentTool)) return;
    const rotations: Rotation[] = [0, 90, 180, 270];
    const idx = rotations.indexOf(this.currentRotation);
    this.currentRotation = rotations[(idx + 1) % 4] ?? 0;
    this.updateCursorSize();
    this.onUIUpdate?.();
  }

  private isInfraTool(tool: ToolType): boolean {
    return [
      'power', 'water', 'police', 'fire', 'hospital',
      'school', 'school_high', 'school_univ', 'park',
      'garbage', 'sewage', 'cemetery',
    ].includes(tool);
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
      // Demolish: highlight multi-cell building footprint
      const gx = this.gridCursor.gridX;
      const gy = this.gridCursor.gridY;
      const cell = this.state.grid.getCell(gx, gy);
      if (cell && cell.buildingId >= 237 && cell.buildingId <= 254) {
        const primary = findPrimaryCell(this.state.grid, gx, gy);
        if (primary) {
          const cfg = getInfraConfigById(cell.buildingId);
          const maxDim = cfg ? Math.max(cfg.width, cfg.height) : 1;
          const cells: { x: number; y: number }[] = [];
          for (let dy = 0; dy < maxDim; dy++) {
            for (let dx = 0; dx < maxDim; dx++) {
              const c = this.state.grid.getCell(primary.x + dx, primary.y + dy);
              if (c && c.buildingId === cell.buildingId) {
                cells.push({ x: primary.x + dx, y: primary.y + dy });
              }
            }
          }
          this.placementPreview.updateDemolishHighlight(cells);
        } else {
          this.placementPreview.hide();
        }
      } else {
        this.placementPreview.hide();
      }
    } else if (this.dragStart && this.isZoneTool()) {
      // Zone drag preview
      const zoneColors: Record<string, number> = {
        zone_r: 0x4caf50, zone_rh: 0x2e7d32,
        zone_c: 0x2196f3, zone_ch: 0x1565c0,
        zone_i: 0xffc107, zone_o: 0x9c27b0,
      };
      const color = zoneColors[this.currentTool] ?? 0xffffff;
      this.placementPreview.updateZoneDrag(
        this.dragStart.x, this.dragStart.y,
        this.gridCursor.gridX, this.gridCursor.gridY,
        color,
      );
    } else {
      this.placementPreview.hide();
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

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const key = `${x},${y}`;
        let value = 0;

        switch (type) {
          case 'power':
            value = this.state.power.isPowered(x, y) ? 100 : 0;
            break;
          case 'water': {
            const supplied = this.state.water.isSupplied(x, y) ? 100 : 0;
            const gw = this.getGroundwaterLevel(x, y);
            // Show supply (bright) or groundwater (dim) — whichever is higher
            value = Math.max(supplied, gw * 0.4);
            break;
          }
          case 'zone': {
            const cell = grid.getCell(x, y);
            if (cell && cell.zoneType > 0) value = cell.zoneType * 15;
            break;
          }
          case 'traffic': {
            const density = this.state.traffic.getSegmentDensity(key);
            value = density * 20;
            break;
          }
          case 'pollution': {
            const cell = grid.getCell(x, y);
            if (cell) value = Math.min(100, cell.pollution * 100 / 255);
            break;
          }
          case 'landValue': {
            const cell = grid.getCell(x, y);
            if (cell && cell.buildingId > 0) value = Math.min(100, cell.landValue * 100 / 255);
            break;
          }
          case 'crime': {
            const cell = grid.getCell(x, y);
            if (cell && cell.buildingId > 0) {
              const reduction = this.state.police.getCrimeReduction(x, y);
              value = Math.max(0, 40 + reduction); // base 40, reduced by police
            }
            break;
          }
          case 'police':
            value = this.state.police.getCoverage(x, y) ? 80 : 0;
            break;
          case 'fire':
            value = this.state.fire.getCoverage(x, y) ? 80 : 0;
            break;
          case 'health':
            value = this.state.health.getCoverage(x, y) ? 80 : 0;
            break;
          case 'education':
            value = this.state.education.getCoverage(x, y) ? 80 : 0;
            break;
          case 'park':
            value = this.state.parks.getCoverage(x, y) ? 80 : 0;
            break;
          case 'garbage':
            value = this.state.garbage.getCoverage(x, y) ? 80 : 0;
            break;
          case 'district': {
            const d = this.state.districts.getDistrictAt(x, y);
            if (d) {
              // Hash district id to get a unique-ish value for coloring
              let hash = 0;
              for (let i = 0; i < d.id.length; i++) hash = (hash * 31 + d.id.charCodeAt(i)) & 0xff;
              value = Math.max(20, hash % 100);
            }
            break;
          }
          default:
            break;
        }

        if (value > 0) data.set(key, value);
      }
    }
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
        const st = s.police.getStations().find(p => p.x === cx && p.y === cy);
        return { 'Radius': st?.radius ?? 15, 'Coverage': s.police.getCoverage(cx, cy) ? 'Yes' : 'No' };
      }
      case 'fire': {
        const st = s.fire.getStations().find(f => f.x === cx && f.y === cy);
        return { 'Radius': st?.radius ?? 15, 'Active Fires': s.fire.getActiveFires().length };
      }
      case 'hospital': {
        const h = s.health.getHospitals().find(h => h.x === cx && h.y === cy);
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
        const p = s.parks.getParks().find(p => p.x === cx && p.y === cy);
        return { 'Radius': p?.radius ?? 5 };
      }
      case 'garbage': {
        const f = s.garbage.getFacilities().find(f => f.x === cx && f.y === cy);
        return { 'Capacity': f?.capacity ?? 1000, 'Load': f?.currentLoad ?? 0 };
      }
      case 'sewage': {
        return { 'Status': 'Active' };
      }
      case 'cemetery': {
        const c = s.deathCare.getCemeteries().find(c => c.x === cx && c.y === cy);
        return { 'Capacity': c?.capacity ?? 500, 'Used': c?.used ?? 0 };
      }
      case 'power': {
        const p = s.power.getPlants().find(p => p.x === cx && p.y === cy);
        return { 'Output': p?.output ?? 500, 'Type': p?.type ?? 'coal' };
      }
      case 'water': {
        const w = s.water.getPlants().find(p => p.x === cx && p.y === cy);
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
    if (!this.dragStart || !this.isRoadTool()) {
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
    const roadConfig = ROAD_CONFIGS[this.currentRoadType];
    this.previewCost = points.length * roadConfig.cost;
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
    this.renderDirty = true;
    this.onUIUpdate?.();
  }

  getNotification(): string | null {
    return this.notification;
  }

  getEconomyBreakdown(): {
    residential: number; commercial: number; industrial: number; office: number;
    roadMaintenance: number; loanInterest: number; powerCost: number; waterCost: number;
    transportCost: number;
  } {
    const grid = this.state.grid;
    const incomeTaxRate = this.state.taxRates.residential ?? 9;
    const businessTaxRate = this.state.taxRates.business ?? 9;
    let resIncome = 0, comIncome = 0, indIncome = 0, offIncome = 0;
    let roadCount = 0;

    const incomeMultiplier = (level: IncomeLevel): number => {
      switch (level) {
        case IncomeLevel.LOW: return 1.0;
        case IncomeLevel.MEDIUM: return 1.5;
        case IncomeLevel.HIGH: return 2.0;
        default: return 1.0;
      }
    };

    const levelMultiplier = (level: 1 | 2 | 3): number => {
      switch (level) {
        case 1: return 1.0;
        case 2: return 1.5;
        case 3: return 2.0;
        default: return 1.0;
      }
    };

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.roadType > 0) roadCount++;
        if (cell.buildingId === 0 || cell.buildingId >= 245) continue;
        if (cell.reserved === 3 || cell.reserved === 4) continue; // burned or multi-cell secondary

        const btype = getBuildingType(cell.buildingId);
        if (!btype) continue;

        const isResidential = cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH;
        if (isResidential) {
          // Income tax: scan citizens living here
          const posKey = `${x},${y}`;
          const residents = this.state.citizens.getCitizensByHome(posKey);
          for (const citizen of residents) {
            resIncome += 0.5 * incomeMultiplier(citizen.incomeLevel) * (incomeTaxRate / 100);
          }
        } else {
          // Business tax: companyIncome x levelMultiplier x businessTaxRate
          const ci = btype.companyIncome ?? 0;
          const bi = ci * levelMultiplier(btype.level) * (businessTaxRate / 100);
          if (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH) {
            comIncome += bi;
          } else if (cell.zoneType === ZoneType.INDUSTRIAL) {
            indIncome += bi;
          } else if (cell.zoneType === ZoneType.OFFICE) {
            offIncome += bi;
          }
        }
      }
    }

    const roadMaintenance = roadCount * 0.1;
    const loanInterest = this.state.budget.loans * this.state.budget.loanInterestRate;
    const powerCost = this.state.power.getPlants().length * 5;
    const waterCost = this.state.water.getPlants().length * 3;
    const transportCost = this.state.bus.getOperatingCost()
      + this.state.metro.getOperatingCost()
      + this.state.tram.getOperatingCost()
      + this.state.rail.getOperatingCost()
      + this.state.ferry.getOperatingCost()
      + this.state.airport.getOperatingCost()
      + this.state.taxi.getOperatingCost();

    return {
      residential: Math.round(resIncome * 10) / 10,
      commercial: Math.round(comIncome * 10) / 10,
      industrial: Math.round(indIncome * 10) / 10,
      office: Math.round(offIncome * 10) / 10,
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
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.roadType > 0) totalRoads++;
      }
    }
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
