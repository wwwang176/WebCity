import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager';
import { TerrainRenderer } from './renderer/TerrainRenderer';
import { RoadRenderer } from './renderer/RoadRenderer';
import { BuildingRenderer } from './renderer/BuildingRenderer';
import { VehicleRenderer } from './renderer/VehicleRenderer';
import { OverlayRenderer } from './renderer/OverlayRenderer';
import { GridCursor } from './renderer/GridCursor';
import { WeatherRenderer } from './renderer/WeatherRenderer';
import { createGameState, type GameState } from './core/simulation/GameState';
import { SimulationLoop } from './core/simulation/SimulationLoop';
import { RoadBuilder } from './core/road/RoadBuilder';
import { RoadType } from './core/road/types';
import { ZoneType, TerrainType } from './core/grid/types';
import { ZoneManager } from './core/zone/ZoneManager';
import { type OverlayType } from './renderer/OverlayRenderer';

export type ToolType = 'select' | 'road' | 'zone_r' | 'zone_c' | 'zone_i' | 'zone_o' | 'demolish' | 'power' | 'water';

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
  private dragStart: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private onUIUpdate: (() => void) | null = null;

  constructor(container: HTMLElement) {
    const mapSize = 60;

    this.state = createGameState(mapSize, mapSize);
    this.simLoop = new SimulationLoop(this.state);
    this.roadBuilder = new RoadBuilder(this.state.grid);
    this.zoneManager = new ZoneManager(this.state.grid);

    // Generate some terrain
    this.generateTerrain(mapSize);

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

    // Add power plant and water plant at start
    this.state.power.addPlant({ x: 2, y: 2, output: 500, pollution: 10, type: 'coal' });
    this.state.water.addPlant({ x: 4, y: 2, output: 500 });

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

  private setupInput(container: HTMLElement): void {
    const canvas = this.sceneManager.getCanvas();

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
      this.gridCursor.update(this.raycaster, this.groundPlane);
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
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sceneManager.zoomCamera(e.deltaY * 0.05);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
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
      case 'road':
        this.roadBuilder.buildRoad(
          { x: x1, y: y1 }, { x: x2, y: y2 },
          this.currentRoadType,
          this.state.budget.funds,
        );
        this.renderDirty = true;
        break;
      case 'zone_r':
        this.applyZone(x1, y1, x2, y2, ZoneType.RESIDENTIAL_LOW);
        break;
      case 'zone_c':
        this.applyZone(x1, y1, x2, y2, ZoneType.COMMERCIAL_LOW);
        break;
      case 'zone_i':
        this.applyZone(x1, y1, x2, y2, ZoneType.INDUSTRIAL);
        break;
      case 'zone_o':
        this.applyZone(x1, y1, x2, y2, ZoneType.OFFICE);
        break;
      case 'demolish':
        this.demolish(x1, y1, x2, y2);
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
      if (this.tickAccumulator >= tickInterval) {
        this.tickAccumulator -= tickInterval;
        this.simLoop.tick();

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

    // Animate terrain (water)
    this.terrainRenderer.update(dt);

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
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.onUIUpdate?.();
  }

  setOverlay(type: OverlayType): void {
    this.overlayRenderer.setOverlay(type, this.sceneManager.scene, this.state.grid);
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
}
