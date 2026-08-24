import type { OverlayType } from '../renderer/OverlayRenderer';
import type { ViewMode } from '../core/ViewMode';
import type { ToolType } from '../Game';
import type { AgentUi } from './AgentUi';
import {
  getPanelBridge, getScreen, getMenuPage, isSettingsOpen, getTutorialStatus,
  type MenuPage, type PanelId, type Screen, type TutorialStatus,
} from './registry';

/**
 * What the player is looking at.
 *
 * ## Why this exists
 *
 * An AI playing alongside the player has to answer which screen they are on in its first
 * sentence. Without this it can only infer it: on the main menu `read.city` answers `nothing at
 * path read.city`, which reads like its own typo rather than "you have not started a game".
 *
 * ## Nothing is invented when there is no game
 *
 * The main menu and the loading screen have no `Game`, so the tool, speed and pause fields are
 * **absent entirely** rather than `0` / `'select'` / `false`. A plausible default would let the
 * AI believe a game is running.
 */

export interface AgentStatus {
  /** Main menu, loading, or in game. */
  screen: Screen;
  /** Which page the main menu is on, `null` when not in the menu. */
  menuPage: MenuPage | null;
  /** Which panel is open. `null` before the UI starts or when none is open. */
  panel: PanelId | null;
  /** Whether the settings screen is open. It does not go through the panel bridge, so `panel`
   *  cannot see it. */
  settingsOpen: boolean;
  /** How far the tutorial has got, `null` when it is not running. */
  tutorial: TutorialStatus | null;

  // ── Present only while `screen === 'game'` ──────────────────────
  tool?: ToolType;
  paused?: boolean;
  speed?: number;
  viewMode?: ViewMode;
  overlay?: OverlayType;
  /** The message on screen. */
  notification?: string | null;

  /**
   * Placement rotation for infrastructure: 0 / 90 / 180 / 270 degrees.
   *
   * The `R: 90°` indicator in the bottom-right corner. `act()` can specify it per call; this is
   * where the player's R key has left it.
   */
  rotation?: number;
  /** Whether placement is on the ground or elevated. */
  placementMode?: string;
  /** The road type the road tool currently has selected. */
  roadType?: string;
  /** Target level 1-3 in elevated placement mode. */
  elevationLevel?: number;
  /**
   * The cost of the cell under the cursor, the number beside the tool name in the toolbar.
   *
   * The UI computes it on hover; it is not game state. `null` whenever nothing is being
   * previewed, which includes every action taken through the API.
   */
  previewCost?: number | null;
  /** The route opened on the transfer overlay. */
  selectedTransferRoute?: string | null;
  /** The citizen opened in the detail panel. */
  selectedCitizenId?: number | null;
  /** The three mute switches. */
  audio?: { muted: boolean; sfxMuted: boolean; musicMuted: boolean };
  /** The save this session was loaded from. `null` for a new game not yet saved. */
  loadedSave?: { slot: number | null; name: string | null };
}

/**
 * Assembles the current status.
 *
 * A `null` `ui` means there is no `Game` yet: the main menu or the loading screen.
 */
export function buildStatus(ui: AgentUi | null): AgentStatus {
  const screen = getScreen();

  const base: AgentStatus = {
    screen,
    menuPage: screen === 'menu' ? getMenuPage() : null,
    panel: getPanelBridge()?.get() ?? null,
    // Before the UI starts, as in unit tests, these read as closed and not running rather than
    // throwing; otherwise status() would be unusable in tests.
    settingsOpen: isSettingsOpen(),
    tutorial: getTutorialStatus(),
  };

  if (screen !== 'game' || !ui) return base;

  const tools = ui.toolState();

  return {
    ...base,
    tool: tools.tool,
    paused: ui.paused(),
    speed: ui.speed(),
    viewMode: ui.viewMode(),
    overlay: ui.overlay(),
    notification: ui.notification(),
    rotation: tools.rotation,
    placementMode: tools.placementMode,
    roadType: tools.roadType,
    elevationLevel: tools.elevationLevel,
    previewCost: tools.previewCost,
    selectedTransferRoute: ui.selectedTransferRoute(),
    selectedCitizenId: ui.selectedCitizenId(),
    audio: ui.audio(),
    loadedSave: ui.loadedSave(),
  };
}
