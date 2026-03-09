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
import { AutoSaver } from './core/save/AutoSave';
import { saveGame } from './core/save/SaveManager';
import { serializeGameState } from './core/save/Serializer';
import { getMilestone } from './core/milestone/Milestone';
import { DisasterType, createDisaster, calculateDamage } from './core/climate/Disaster';
import { getLaneCount } from './core/traffic/TrafficSimulation';

/** Road widths matching RoadRenderer (world units per cell). */
const ROAD_WIDTHS_FOR_LANES: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};


export type ToolType = 'select' | 'road' | 'road_rural' | 'road_2lane' | 'road_4lane' | 'zone_r' | 'zone_rh' | 'zone_c' | 'zone_ch' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery' | 'district' | 'bus_stop' | 'metro_station' | 'tram_stop' | 'train_station' | 'ferry_dock' | 'airport' | 'taxi_stand';

export interface SelectedBuilding {
  x: number;
  y: number;
  buildingType: BuildingType;
  zoneType: ZoneType;
  landValue: number;
  pollution: number;
  serviceCoverage: number;
}

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
  private vehiclePrevPathPos = new Map<number, number>();
  private vehicleTypes = new Map<number, VehicleData['type']>();
  private vehicleHeadings = new Map<number, number>();
  private vehicleSmoothedOffset = new Map<number, number>();
  private tickProgress = 0; // 0..1 interpolation between ticks
  previewCost: number | null = null; // estimated cost during road drag
  activeDistrictId: string | null = null; // currently selected district for painting

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
      case '3': this.setTool('zone_r'); break;
      case '4': this.setTool('zone_c'); break;
      case '5': this.setTool('zone_i'); break;
      case '6': this.setTool('zone_o'); break;
      case '7': this.setTool('road_2lane'); break;
      case '8': this.setTool('power'); break;
      case '9': this.setTool('water'); break;
      case '0': this.setTool('demolish'); break;
      case 'escape': this.setTool('select'); this.dragStart = null; break;
      case 'delete': this.setTool('demolish'); break;
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
              x: x1, y: y1,
              buildingType: bt,
              zoneType: cell.zoneType,
              landValue: cell.landValue,
              pollution: cell.pollution,
              serviceCoverage: cell.serviceCoverage,
            };
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
      case 'road_4lane': {
        const result = this.roadBuilder.buildRoad(
          { x: x1, y: y1 }, { x: x2, y: y2 },
          this.currentRoadType,
          this.state.budget.funds,
        );
        if (result.success && result.cost) {
          this.state.budget.funds -= result.cost;
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
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this.state.grid.getCell(x, y);
        // Remove infrastructure plants/services if demolished
        if (cell && cell.buildingId === 254) this.state.power.removePlant(x, y);
        if (cell && cell.buildingId === 253) this.state.water.removePlant(x, y);
        if (cell && cell.buildingId === 252) {
          const sid = this.state.police.getStations().find(s => s.x === x && s.y === y);
          if (sid) this.state.police.removeStation(sid.id);
        }
        if (cell && cell.buildingId === 251) {
          const sid = this.state.fire.getStations().find(s => s.x === x && s.y === y);
          if (sid) this.state.fire.removeStation(sid.id);
        }
        if (cell && cell.buildingId === 250) {
          const hid = this.state.health.getHospitals().find(h => h.x === x && h.y === y);
          if (hid) this.state.health.removeHospital(hid.id);
        }
        if (cell && (cell.buildingId === 249 || cell.buildingId === 244 || cell.buildingId === 243)) {
          const sid = this.state.education.getSchools().find(s => s.x === x && s.y === y);
          if (sid) this.state.education.removeSchool(sid.id);
        }
        if (cell && cell.buildingId === 248) {
          const pid = this.state.parks.getParks().find(p => p.x === x && p.y === y);
          if (pid) this.state.parks.removePark(pid.id);
        }
        if (cell && cell.buildingId === 247) {
          const gid = this.state.garbage.getFacilities().find(g => g.x === x && g.y === y);
          if (gid) this.state.garbage.removeFacility(gid.id);
        }
        if (cell && cell.buildingId === 246) {
          const sid = this.state.sewage.getTreatmentPlants().find(s => s.x === x && s.y === y);
          if (sid) this.state.sewage.removeTreatmentPlant(sid.id);
        }
        if (cell && cell.buildingId === 245) {
          const cid = this.state.deathCare.getCemeteries().find(c => c.x === x && c.y === y);
          if (cid) this.state.deathCare.removeCemetery(cid.id);
        }
        this.state.grid.setCell(x, y, {
          roadType: 0,
          roadFlags: 0,
          zoneType: ZoneType.NONE,
          buildingId: 0,
        });
      }
    }
    this.renderDirty = true;
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
    const cell = this.state.grid.getCell(x, y);
    if (!cell) {
      this.notification = 'Out of bounds';
      this.notificationTimer = 3;
      return;
    }
    if (cell.terrainType === TerrainType.WATER) {
      this.notification = 'Cannot build on water';
      this.notificationTimer = 3;
      return;
    }
    if (cell.roadType !== 0 || cell.buildingId !== 0) {
      this.notification = 'Tile is occupied';
      this.notificationTimer = 3;
      return;
    }
    // Water plants require groundwater (near rivers)
    if (type === 'water' && this.getGroundwaterLevel(x, y) === 0) {
      this.notification = 'No groundwater here — build near rivers';
      this.notificationTimer = 4;
      return;
    }
    // Check for existing plant at this location
    const existing = type === 'power'
      ? this.state.power.getPlants().some(p => p.x === x && p.y === y)
      : this.state.water.getPlants().some(p => p.x === x && p.y === y);
    if (existing) {
      this.notification = `${type === 'power' ? 'Power' : 'Water'} plant already here`;
      this.notificationTimer = 3;
      return;
    }
    const costs: Record<string, number> = {
      power: 500, water: 300, police: 400, fire: 400, hospital: 800,
      school: 400, school_high: 600, school_univ: 1200, park: 200, garbage: 400, sewage: 400, cemetery: 300,
    };
    const buildingIds: Record<string, number> = {
      power: 254, water: 253, police: 252, fire: 251, hospital: 250,
      school: 249, school_high: 244, school_univ: 243, park: 248, garbage: 247, sewage: 246, cemetery: 245,
    };
    const cost = costs[type] ?? 500;
    if (this.state.budget.funds < cost) {
      this.notification = `Insufficient funds (need $${cost})`;
      this.notificationTimer = 3;
      return;
    }
    this.state.budget.funds -= cost;
    if (type === 'power') {
      this.state.power.addPlant({ x, y, output: 500, pollution: 10, type: 'coal' });
    } else if (type === 'water') {
      this.state.water.addPlant({ x, y, output: 500 });
    } else if (type === 'police') {
      this.state.police.addStation(x, y);
    } else if (type === 'fire') {
      this.state.fire.addStation(x, y);
    } else if (type === 'hospital') {
      this.state.health.addHospital(x, y);
    } else if (type === 'school') {
      this.state.education.addSchool(x, y, 'elementary');
    } else if (type === 'school_high') {
      this.state.education.addSchool(x, y, 'highschool');
    } else if (type === 'school_univ') {
      this.state.education.addSchool(x, y, 'university');
    } else if (type === 'park') {
      this.state.parks.addPark(x, y);
    } else if (type === 'garbage') {
      this.state.garbage.addFacility(x, y, 'landfill');
    } else if (type === 'sewage') {
      this.state.sewage.addTreatmentPlant(x, y);
    } else if (type === 'cemetery') {
      this.state.deathCare.addCemetery(x, y);
    }
    this.state.grid.setCell(x, y, { buildingId: buildingIds[type] ?? 254 });
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
    const buildingIds: Record<string, number> = {
      bus: 242, metro: 241, tram: 240, rail: 239, ferry: 238, airport: 237, taxi: 236,
    };
    const cost = costs[type] ?? 500;
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
      this.state.ferry.addDock(x, y);
    } else if (type === 'airport') {
      const pop = this.state.citizens.getPopulation();
      const result = this.state.airport.build(x, y, 'SMALL', pop);
      if (!result) {
        this.state.budget.funds += cost;
        this.notification = 'Airport requires population >= 10,000';
        this.notificationTimer = 4;
        return;
      }
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
      this.tickProgress = tickInterval > 0 ? this.tickAccumulator / tickInterval : 1;
      if (this.tickAccumulator >= tickInterval) {
        this.tickAccumulator -= tickInterval;
        // Snapshot pathPos before tick for inter-tick curve interpolation
        this.vehiclePrevPathPos.clear();
        for (const v of this.state.traffic.vehicles) {
          this.vehiclePrevPathPos.set(v.id, v.pathPos);
        }
        this.simLoop.tick();
        this.tickProgress = 0;

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

    // Update vehicles — interpolate pathPos between ticks, then compute bezier curve
    const vehicleData: VehicleData[] = this.state.traffic.vehicles.map(v => {
      if (v.arrived) return null;

      // Interpolate pathPos for smooth inter-tick movement along the curve
      const prevPP = this.vehiclePrevPathPos.get(v.id) ?? v.pathPos;
      const t = Math.min(1, this.tickProgress);
      const interpPos = prevPP + (v.pathPos - prevPP) * t;

      const sp = this.getSmoothedVehiclePos(v.path, interpPos, this.vehicleHeadings.get(v.id) ?? 0);
      if (!sp) return null;

      const { x, y, heading } = sp;
      this.vehicleHeadings.set(v.id, heading);

      // Derive vehicle type from length (assigned in simulation)
      if (!this.vehicleTypes.has(v.id)) {
        let vtype: VehicleData['type'];
        if (v.length >= 0.44) vtype = 'bus';
        else if (v.length >= 0.33) vtype = 'firetruck';
        else if (v.length >= 0.28) vtype = 'truck';
        else vtype = 'car';
        this.vehicleTypes.set(v.id, vtype);
      }

      // Compute lane offset based on road type at current cell, with smooth transition
      const targetOffset = this.computeLaneOffset(v.path, interpPos, v.lane);
      const prevOffset = this.vehicleSmoothedOffset.get(v.id) ?? targetOffset;
      const laneOffset = prevOffset + (targetOffset - prevOffset) * 0.15;
      this.vehicleSmoothedOffset.set(v.id, laneOffset);

      return {
        id: v.id,
        x,
        y,
        heading,
        type: this.vehicleTypes.get(v.id)!,
        laneOffset,
      };
    }).filter((v): v is NonNullable<typeof v> => v !== null) as VehicleData[];
    this.vehicleRenderer.update(vehicleData, this.weatherRenderer.sunIntensity);

    // Clean up stale vehicle rendering state
    const activeIds = new Set(this.state.traffic.vehicles.map(v => v.id));
    for (const id of this.vehicleSmoothedOffset.keys()) {
      if (!activeIds.has(id)) {
        this.vehicleSmoothedOffset.delete(id);
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
  private getSmoothedVehiclePos(
    path: string[], pathPos: number, fallbackHeading: number,
  ): { x: number; y: number; heading: number } | null {
    const idx = Math.floor(pathPos);
    const frac = pathPos - idx;
    const p1 = path[idx];
    if (!p1) return null;
    const [x1, y1] = p1.split(',').map(Number);

    if (idx >= path.length - 1) {
      return { x: x1!, y: y1!, heading: fallbackHeading };
    }

    const [x2, y2] = path[idx + 1]!.split(',').map(Number);
    const BLEND = 0.35;

    // Approaching turn at node idx+1
    if (frac > 1 - BLEND && idx < path.length - 2) {
      const [x3, y3] = path[idx + 2]!.split(',').map(Number);
      // Only curve if direction actually changes
      if ((x2! - x1!) !== (x3! - x2!) || (y2! - y1!) !== (y3! - y2!)) {
        const p0x = x1! + (x2! - x1!) * (1 - BLEND);
        const p0y = y1! + (y2! - y1!) * (1 - BLEND);
        const p2x = x2! + (x3! - x2!) * BLEND;
        const p2y = y2! + (y3! - y2!) * BLEND;
        const t = (frac - (1 - BLEND)) / (2 * BLEND); // 0 → 0.5
        const mt = 1 - t;
        return {
          x: mt * mt * p0x + 2 * mt * t * x2! + t * t * p2x,
          y: mt * mt * p0y + 2 * mt * t * y2! + t * t * p2y,
          heading: Math.atan2(
            -(2 * mt * (y2! - p0y) + 2 * t * (p2y - y2!)),
            2 * mt * (x2! - p0x) + 2 * t * (p2x - x2!),
          ),
        };
      }
    }

    // Just passed turn at node idx
    if (frac < BLEND && idx > 0) {
      const [x0, y0] = path[idx - 1]!.split(',').map(Number);
      if ((x1! - x0!) !== (x2! - x1!) || (y1! - y0!) !== (y2! - y1!)) {
        const p0x = x0! + (x1! - x0!) * (1 - BLEND);
        const p0y = y0! + (y1! - y0!) * (1 - BLEND);
        const p2x = x1! + (x2! - x1!) * BLEND;
        const p2y = y1! + (y2! - y1!) * BLEND;
        const t = 0.5 + (frac / BLEND) * 0.5; // 0.5 → 1.0
        const mt = 1 - t;
        return {
          x: mt * mt * p0x + 2 * mt * t * x1! + t * t * p2x,
          y: mt * mt * p0y + 2 * mt * t * y1! + t * t * p2y,
          heading: Math.atan2(
            -(2 * mt * (y1! - p0y) + 2 * t * (p2y - y1!)),
            2 * mt * (x1! - p0x) + 2 * t * (p2x - x1!),
          ),
        };
      }
    }

    // Straight segment — linear interpolation
    return {
      x: x1! + (x2! - x1!) * frac,
      y: y1! + (y2! - y1!) * frac,
      heading: Math.atan2(-(y2! - y1!), x2! - x1!),
    };
  }

  /**
   * Compute the lateral offset for a vehicle based on its lane and the road type
   * at its current position.
   *
   * Right-hand drive convention: vehicles drive on the LEFT side of the road.
   * The returned offset is in the perpendicular-right direction relative to heading,
   * so positive values shift the vehicle to the right of the travel direction.
   *
   * For a bidirectional road with N directional lanes per side:
   *   - The LEFT half of the road is used (positive offset = toward road center left).
   *   - Lane 0 is the outermost lane, lane N-1 is closest to center.
   *   - offset = roadHalfWidth - (lane + 0.5) * laneWidth
   *     This places lane 0 near the road edge and higher lanes toward center.
   */
  private computeLaneOffset(path: string[], pathPos: number, lane: number): number {
    // Look up road type from the grid at the current path cell
    const idx = Math.floor(pathPos);
    const cellKey = path[idx];
    if (!cellKey) return 0.12; // fallback to default offset

    const [cxs, cys] = cellKey.split(',');
    const cx = Number(cxs), cy = Number(cys);
    const cell = this.state.grid.getCell(cx, cy);
    if (!cell || cell.roadType === RoadType.NONE) return 0.12;

    const roadType = cell.roadType;
    const roadWidth = ROAD_WIDTHS_FOR_LANES[roadType] ?? 0.6;
    const dirLanes = getLaneCount(roadType);

    if (dirLanes <= 1) {
      // Single directional lane (e.g. RURAL, TWO_LANE): fixed offset to left side
      return roadWidth / 4; // drive on left quarter of road
    }

    // Multi-lane road: distribute lanes across half the road width
    // Half-width is the space for one direction of traffic
    const halfWidth = roadWidth / 2;
    const laneWidth = halfWidth / dirLanes;

    // Lane 0 = outermost (near edge), lane N-1 = innermost (near center line)
    // Offset from road center: place in the left half (positive = right of heading = left side of road)
    // Center of lane i from road edge = (i + 0.5) * laneWidth
    // Offset from road center = halfWidth - (lane + 0.5) * laneWidth
    const clampedLane = Math.min(lane, dirLanes - 1);
    const offset = halfWidth - (clampedLane + 0.5) * laneWidth;

    return offset;
  }

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
    return t === 'road' || t === 'road_rural' || t === 'road_2lane' || t === 'road_4lane';
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    // Road subtypes set the roadType
    if (tool === 'road_rural') this.currentRoadType = RoadType.RURAL;
    else if (tool === 'road_2lane') this.currentRoadType = RoadType.TWO_LANE;
    else if (tool === 'road_4lane') this.currentRoadType = RoadType.FOUR_LANE;
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
  } {
    const grid = this.state.grid;
    const taxRate = this.state.taxRates;
    let resIncome = 0, comIncome = 0, indIncome = 0, offIncome = 0;
    let roadCount = 0;

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.roadType > 0) roadCount++;
        if (cell.buildingId === 0) continue;
        const base = cell.buildingId * 2;
        if (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH) {
          resIncome += base * (taxRate.residential / 100);
        } else if (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH) {
          comIncome += base * (taxRate.commercial / 100);
        } else if (cell.zoneType === ZoneType.INDUSTRIAL) {
          indIncome += base * (taxRate.industrial / 100);
        } else if (cell.zoneType === ZoneType.OFFICE) {
          offIncome += base * (taxRate.office / 100);
        }
      }
    }

    const roadMaintenance = roadCount * 0.1;
    const loanInterest = this.state.budget.loans * this.state.budget.loanInterestRate;
    const powerCost = this.state.power.getPlants().length * 5;
    const waterCost = this.state.water.getPlants().length * 3;

    return {
      residential: Math.round(resIncome * 10) / 10,
      commercial: Math.round(comIncome * 10) / 10,
      industrial: Math.round(indIncome * 10) / 10,
      office: Math.round(offIncome * 10) / 10,
      roadMaintenance: Math.round(roadMaintenance * 10) / 10,
      loanInterest: Math.round(loanInterest * 10) / 10,
      powerCost,
      waterCost,
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
