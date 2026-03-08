import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager';
import { TerrainRenderer } from './renderer/TerrainRenderer';
import { RoadRenderer } from './renderer/RoadRenderer';
import { BuildingRenderer } from './renderer/BuildingRenderer';
import { VehicleRenderer, type VehicleData } from './renderer/VehicleRenderer';
import { OverlayRenderer } from './renderer/OverlayRenderer';
import { GridCursor } from './renderer/GridCursor';
import { WeatherRenderer } from './renderer/WeatherRenderer';
import { createGameState, type GameState } from './core/simulation/GameState';
import { SimulationLoop } from './core/simulation/SimulationLoop';
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType, ROAD_CONFIGS } from './core/road/types';
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

export type ToolType = 'select' | 'road' | 'zone_r' | 'zone_c' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water';

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
  private vehiclePrevPositions = new Map<number, { x: number; y: number }>();
  private vehicleTypes = new Map<number, VehicleData['type']>();
  private tickProgress = 0; // 0..1 interpolation between ticks
  previewCost: number | null = null; // estimated cost during road drag

  constructor(container: HTMLElement, loadedState?: GameState) {
    const mapSize = loadedState ? loadedState.grid.width : 60;

    // Audio
    this.audioManager = new AudioManager();
    this.audioManager.init();

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
    this.overlayRenderer = new OverlayRenderer();

    this.weatherRenderer = new WeatherRenderer(this.sceneManager, mapSize);

    // Build initial scene
    this.terrainRenderer.build(this.sceneManager.scene, this.state.grid);
    this.vehicleRenderer.build(this.sceneManager.scene);
    this.gridCursor = new GridCursor(this.sceneManager.scene, mapSize, mapSize);

    // Center camera
    this.sceneManager.panCamera(mapSize / 2, mapSize / 2);

    // Add power plant and water plant at start (only for new games)
    if (!loadedState) {
      this.state.power.addPlant({ x: 2, y: 2, output: 500, pollution: 10, type: 'coal' });
      this.state.water.addPlant({ x: 4, y: 2, output: 500 });
    }

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
      case '2': this.setTool('road'); break;
      case '3': this.setTool('zone_r'); break;
      case '4': this.setTool('zone_c'); break;
      case '5': this.setTool('zone_i'); break;
      case '6': this.setTool('zone_o'); break;
      case '7': this.setTool('demolish'); break;
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
      case 'road': {
        const result = this.roadBuilder.buildRoad(
          { x: x1, y: y1 }, { x: x2, y: y2 },
          this.currentRoadType,
          this.state.budget.funds,
        );
        if (result.success && result.cost) {
          this.state.budget.funds -= result.cost;
          this.audioManager.playSfx('build');
        }
        this.renderDirty = true;
        break;
      }
      case 'zone_r':
        this.applyZone(x1, y1, x2, y2, ZoneType.RESIDENTIAL_LOW);
        this.audioManager.playSfx('zone');
        break;
      case 'zone_c':
        this.applyZone(x1, y1, x2, y2, ZoneType.COMMERCIAL_LOW);
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
        // Snapshot vehicle positions before tick advances them
        this.vehiclePrevPositions.clear();
        for (const v of this.state.traffic.vehicles) {
          const pos = v.path[v.currentIndex];
          if (pos) {
            const [px, py] = pos.split(',');
            this.vehiclePrevPositions.set(v.id, { x: Number(px), y: Number(py) });
          }
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
        this.onUIUpdate?.();
      }
    }

    // Rebuild meshes when dirty
    if (this.renderDirty) {
      this.roadRenderer.build(this.sceneManager.scene, this.state.grid);
      this.buildingRenderer.build(this.sceneManager.scene, this.state.grid);
      this.renderDirty = false;
    }

    // Update cursor color based on tool
    this.updateCursorColor();

    // Update vehicles with smooth interpolation
    const vehicleData: VehicleData[] = this.state.traffic.vehicles.map(v => {
      const pos = v.path[v.currentIndex];
      if (!pos) return null;
      const [xStr, yStr] = pos.split(',');
      const targetX = Number(xStr);
      const targetY = Number(yStr);

      // Interpolate from previous position
      const prev = this.vehiclePrevPositions.get(v.id);
      let x = targetX;
      let y = targetY;
      if (prev) {
        const t = Math.min(1, this.tickProgress);
        x = prev.x + (targetX - prev.x) * t;
        y = prev.y + (targetY - prev.y) * t;
      }

      // Assign a consistent vehicle type per ID
      if (!this.vehicleTypes.has(v.id)) {
        const roll = Math.random();
        let vtype: VehicleData['type'];
        if (roll < 0.70) vtype = 'car';
        else if (roll < 0.85) vtype = 'bus';
        else if (roll < 0.95) vtype = 'truck';
        else vtype = 'firetruck';
        this.vehicleTypes.set(v.id, vtype);
      }

      return {
        id: v.id,
        x,
        y,
        type: this.vehicleTypes.get(v.id)!,
      };
    }).filter((v): v is NonNullable<typeof v> => v !== null) as VehicleData[];
    this.vehicleRenderer.update(vehicleData);

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
  }

  private updateCursorColor(): void {
    const toolColors: Record<ToolType, number> = {
      select: 0xffffff,
      road: 0x424242,
      zone_r: 0x4caf50,
      zone_c: 0x2196f3,
      zone_i: 0xffa726,
      zone_o: 0xab47bc,
      demolish: 0xf44336,
      power: 0xffeb3b,
      water: 0x03a9f4,
    };
    this.gridCursor.setColor(toolColors[this.currentTool] ?? 0xffffff);
    // Demolish tool gets higher opacity for red highlight preview
    this.gridCursor.setOpacity(this.currentTool === 'demolish' ? 0.6 : 0.3);
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.onUIUpdate?.();
  }

  setOverlay(type: OverlayType): void {
    const data = this.buildOverlayData(type);
    this.overlayRenderer.setOverlay(type, this.sceneManager.scene, this.state.grid, data);
    this.onUIUpdate?.();
  }

  private toggleOverlay(type: OverlayType): void {
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
          case 'water':
            value = this.state.water.isSupplied(x, y) ? 100 : 0;
            break;
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
            // Crime is estimated from population density, not per-cell yet
            const cell = grid.getCell(x, y);
            if (cell && cell.buildingId > 0) value = 20; // placeholder
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
    if (!this.dragStart || this.currentTool !== 'road') {
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
}
