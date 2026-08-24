import type { OverlayType } from '../renderer/OverlayRenderer';
import type { ViewMode } from '../core/ViewMode';
import type { ToolType } from '../Game';
import { GameClock, type GameSpeed } from '../core/simulation/GameClock';
import { OverlayType as OverlayTypes } from '../renderer/OverlayRenderer';
import { ViewMode as ViewModes } from '../core/ViewMode';
import { getPanelBridge, isPanelId, PANEL_IDS, type PanelId } from './registry';

/**
 * What the player can see and press.
 *
 * Three kinds of thing:
 *
 * | | Lives in | Reached through |
 * |---|---|---|
 * | Panels (Overview, Layers, …) | Solid's `openModal` signal | a bridge registered in `registry` |
 * | Overlays, focus view modes, pause, speed | public methods on `Game` | direct calls |
 * | Camera | `SceneManager` | direct calls |
 *
 * The panel path does not exist in unit tests, which have no UI, so an unregistered bridge
 * returns `false` rather than throwing.
 */

export interface CameraTarget {
  /** The map cell to look at. */
  x?: number;
  y?: number;
  /**
   * The screen height expressed in cells. **This is the orthographic frustum height, not a
   * distance**: changing the camera's `cameraDistance` barely affects zoom.
   */
  size?: number;
  /** Azimuth in radians. 0 is axis-aligned and pi/4 is the default isometric view. */
  angle?: number;
  /** Elevation angle in radians. The game's own scroll wheel clamps it to pi/18 - 4pi/9. */
  elevation?: number;
}

export interface CameraState {
  x: number;
  y: number;
  size: number;
  angle: number;
  elevation: number;
}

/**
 * The overlays that actually have a button in the Layers panel.
 *
 * Not the same set as `OverlayType`: the renderer implements that enum's `crime`, but the panel
 * has no entry for it. "What can the player see" and "what can a program switch on" are two
 * different questions.
 */
const LAYERS_PANEL_OVERLAYS: ReadonlySet<string> = new Set([
  'power', 'water',
  'traffic', 'commute', 'zone', 'landValue', 'pollution',
  'police', 'fire', 'health', 'education', 'park', 'garbage', 'district',
]);

/** The view modes that actually have a button in the Layers panel. */
const LAYERS_PANEL_MODES: ReadonlySet<string> = new Set([
  'UNDERGROUND', 'RAIL_FOCUS', 'FERRY_FOCUS', 'BUS_FOCUS',
]);

/** What AgentUi can reach. A structural type so it can be tested without Three.js. */
export interface UiHost {
  currentTool: ToolType;
  viewMode: ViewMode;
  paused: boolean;
  speed: number;
  notification: string | null;
  setTool(tool: ToolType): void;
  setOverlay(type: OverlayType): void;
  getOverlay(): OverlayType;
  toggleViewMode(mode: ViewMode): void;
  togglePause(): void;
  setSpeed(speed: GameSpeed): void;

  // ── Read-only: the tool and interface state visible on screen ───
  //
  // Changing any of these goes through `act()` (rotation, elevation) or the relevant panel.
  // This only tells the caller what the player's current settings are.

  /** Placement rotation for infrastructure: 0 / 90 / 180 / 270 degrees. */
  rotation(): number;
  /** Whether placement is on the ground or elevated. */
  placementMode(): string;
  /** The road type the road tool currently has selected. */
  roadType(): string;
  /** Target level 1-3 in elevated placement mode. */
  elevationLevel(): number;
  /** The cost of the cell under the cursor, or `null` when nothing is being previewed. */
  previewCost(): number | null;
  /** The route opened on the transfer overlay. */
  selectedTransferRoute(): string | null;
  /** The citizen opened in the detail panel. */
  selectedCitizenId(): number | null;
  /** The three mute switches. */
  audio(): { muted: boolean; sfxMuted: boolean; musicMuted: boolean };
  /** The save this session was loaded from. `null` for a new game. */
  loadedSave(): { slot: number | null; name: string | null };
  deselectBuilding(): void;
  camera(): CameraState;
  setCamera(target: CameraTarget): CameraState;
}

/** Snaps to the nearest gear, taking the slower one on a tie. */
function nearestGear(target: number): GameSpeed {
  let best = GameClock.SPEEDS[0]!;
  for (const gear of GameClock.SPEEDS) {
    if (Math.abs(gear - target) < Math.abs(best - target)) best = gear;
  }
  return best;
}

export class AgentUi {
  constructor(private readonly host: UiHost) {}

  // ── Panels ──────────────────────────────────────────────────────

  /** Which panels can be opened. */
  panels(): readonly PanelId[] {
    return PANEL_IDS;
  }

  /** Which one is open, or `null` before the UI has started. */
  panel(): PanelId | null {
    return getPanelBridge()?.get() ?? null;
  }

  /** Opens a panel. `false` for an unknown id or before the UI has started. */
  openPanel(id: string): boolean {
    if (!isPanelId(id)) return false;
    const bridge = getPanelBridge();
    if (!bridge) return false;
    bridge.set(id);
    return true;
  }

  closePanel(): boolean {
    const bridge = getPanelBridge();
    if (!bridge) return false;
    bridge.set(null);
    return true;
  }

  // ── Overlays and view modes ─────────────────────────────────────

  /**
   * Which overlays can be switched on.
   *
   * `inLayersPanel` says whether **the player can press it**: the renderer can draw `crime`,
   * but the Layers panel has no tile for it and there is no keyboard shortcut. The API can
   * switch it on; the player cannot.
   *
   * For how to read an overlay's numbers (binary / continuous / categorical), see
   * `read.overlay(type).kind`.
   */
  overlays(): { type: OverlayType; inLayersPanel: boolean }[] {
    return Object.values(OverlayTypes)
      .filter(t => t !== OverlayTypes.NONE)
      .map(type => ({ type, inLayersPanel: LAYERS_PANEL_OVERLAYS.has(type) }));
  }

  /**
   * Which view modes exist.
   *
   * `inLayersPanel` again means "can the player press it": `TRANSFER_FOCUS` is entered
   * automatically by clicking a transfer route and has no button in the panel.
   */
  viewModes(): { mode: ViewMode; inLayersPanel: boolean }[] {
    return Object.values(ViewModes)
      .filter(m => m !== ViewModes.NORMAL)
      .map(mode => ({ mode, inLayersPanel: LAYERS_PANEL_MODES.has(mode) }));
  }

  overlay(): OverlayType {
    return this.host.getOverlay();
  }

  setOverlay(type: OverlayType): OverlayType {
    this.host.setOverlay(type);
    return this.host.getOverlay();
  }

  viewMode(): ViewMode {
    return this.host.viewMode;
  }

  /**
   * Switches to a focus view mode.
   *
   * `Game` only offers `toggleViewMode()`, where pressing the same mode again returns to
   * NORMAL. A program wants "set to this" rather than "toggle", so this returns to NORMAL first
   * and then switches. Already being in the target mode is a no-op.
   */
  setViewMode(mode: ViewMode): ViewMode {
    const current = this.host.viewMode;
    if (current === mode) return current;
    if (current !== ('NORMAL' as ViewMode)) this.host.toggleViewMode(current);
    if (mode !== ('NORMAL' as ViewMode)) this.host.toggleViewMode(mode);
    return this.host.viewMode;
  }

  // ── Tools ───────────────────────────────────────────────────────

  tool(): ToolType {
    return this.host.currentTool;
  }

  /**
   * Switches tool without acting.
   *
   * Building goes through `act()`, which also sets `placementMode`, `elevationLevel` and
   * `currentRotation`; this does not.
   */
  setTool(tool: ToolType): ToolType {
    this.host.setTool(tool);
    return this.host.currentTool;
  }

  // ── Time ────────────────────────────────────────────────────────

  paused(): boolean {
    return this.host.paused;
  }

  setPaused(paused: boolean): boolean {
    if (this.host.paused !== paused) this.host.togglePause();
    return this.host.paused;
  }

  speed(): number {
    return this.host.speed;
  }

  /**
   * Sets the game speed.
   *
   * Speed comes in fixed gears (1 / 3 / 5 / 10), not as a continuous value. **A target off a
   * gear snaps to the nearest one**, taking the slower on a tie, because fast-forward runs past
   * things the player has not seen. Out-of-range targets clamp to the ends.
   *
   * `0` means paused in `GameSpeed`, but the game's `setSpeed(0)` ignores it. Pausing has its
   * own entry point (`setPaused`), so `0` here is treated as the slowest gear.
   *
   * Choosing a speed means wanting it to run: the game's `setSpeed` also unpauses, exactly as
   * the toolbar's speed buttons do.
   */
  setSpeed(target: number): number {
    this.host.setSpeed(nearestGear(target));
    return this.host.speed;
  }

  // ── Selection ───────────────────────────────────────────────────

  /**
   * Closes the detail panel.
   *
   * Selecting is done by clicking (`act({ tool: 'select', ... })`), but deselecting has no
   * corresponding click; the panel's X button calls this.
   */
  deselect(): void {
    this.host.deselectBuilding();
  }

  // ── Camera ──────────────────────────────────────────────────────

  camera(): CameraState {
    return this.host.camera();
  }

  setCamera(target: CameraTarget): CameraState {
    return this.host.setCamera(target);
  }

  // ── Tool state and notifications ────────────────────────────────

  /** Placement rotation for infrastructure: 0 / 90 / 180 / 270 degrees. */
  rotation(): number {
    return this.host.rotation();
  }

  /**
   * The tool's current settings, matching the small indicators on screen.
   *
   * `previewCost` has a value only while the cursor is over the map: the UI computes it on
   * hover and it is not part of game state. Building through the API never goes near it.
   */
  toolState(): {
    tool: ToolType; rotation: number; placementMode: string;
    roadType: string; elevationLevel: number; previewCost: number | null;
  } {
    return {
      tool: this.tool(),
      rotation: this.host.rotation(),
      placementMode: this.host.placementMode(),
      roadType: this.host.roadType(),
      elevationLevel: this.host.elevationLevel(),
      previewCost: this.host.previewCost(),
    };
  }

  /** The three mute switches. */
  audio(): { muted: boolean; sfxMuted: boolean; musicMuted: boolean } {
    return this.host.audio();
  }

  /** The save this session was loaded from. */
  loadedSave(): { slot: number | null; name: string | null } {
    return this.host.loadedSave();
  }

  /** The route opened on the transfer overlay. */
  selectedTransferRoute(): string | null {
    return this.host.selectedTransferRoute();
  }

  /** The citizen opened in the detail panel. */
  selectedCitizenId(): number | null {
    return this.host.selectedCitizenId();
  }

  /** The message the game is currently displaying. */
  notification(): string | null {
    return this.host.notification;
  }
}
