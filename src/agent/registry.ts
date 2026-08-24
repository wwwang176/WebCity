/**
 * Reaching the two things that do not live on `Game`.
 *
 * Panel visibility lives in Solid's `GameUIRoot` as an `openModal` signal, and starting or
 * loading a game lives in `main.ts`, which tears down `Game` and builds a new one. Neither is a
 * method on `Game`, so the agent cannot reach them.
 *
 * Importing them directly would be a cycle (main -> agent -> main). So the direction is
 * reversed: each side **registers** its own entry point here and the agent takes it from here.
 * An unregistered bridge reports unavailability rather than throwing, since unit tests have no
 * UI.
 */

export type PanelId = 'overview' | 'layers' | 'cityspec' | 'district' | 'transit' | 'debug';

export const PANEL_IDS: readonly PanelId[] = [
  'overview', 'layers', 'cityspec', 'district', 'transit', 'debug',
];

export function isPanelId(v: string): v is PanelId {
  return (PANEL_IDS as readonly string[]).includes(v);
}

export interface PanelBridge {
  get(): PanelId | null;
  set(id: PanelId | null): void;
}

export interface SessionBridge {
  /** Starts a new game. Omitting `mapConfig` uses the default map. */
  newGame(mapConfig?: unknown): Promise<void>;
  /** Loads one save slot. */
  load(slotId: number): Promise<void>;
}

let panelBridge: PanelBridge | null = null;
let sessionBridge: SessionBridge | null = null;

export function registerPanelBridge(bridge: PanelBridge | null): void {
  panelBridge = bridge;
}

export function getPanelBridge(): PanelBridge | null {
  return panelBridge;
}

export function registerSessionBridge(bridge: SessionBridge | null): void {
  sessionBridge = bridge;
}

export function getSessionBridge(): SessionBridge | null {
  return sessionBridge;
}

/* ------------------------------------------------------------------ */
/*  Which screen the player is on                                       */
/* ------------------------------------------------------------------ */

/**
 * Three owners of state, so two mechanisms.
 *
 * **Navigation is pushed** (`setScreen`): the screen and menu page change rarely, and every
 * change is a discrete event (Load Game pressed, loading started, loading finished), from a
 * handful of call sites.
 *
 * **Live state is pulled** (`UiStateBridge`): the settings screen and the tutorial can differ
 * every frame, and pushing them would require remembering to notify at every transition, where
 * one omission has no symptom beyond going quietly stale.
 */

export type Screen = 'menu' | 'loading' | 'game';

/** Which page the main menu is on. */
export type MenuPage = 'main' | 'newGame' | 'load';

export interface TutorialStatus {
  active: boolean;
  /** Which step, counting from 1. */
  step: number;
  total: number;
}

/**
 * These two register **separately** rather than as one bridge.
 *
 * The settings screen's visibility is a module-level signal in `SettingsMenu`, while the
 * tutorial's progress lives on the `TutorialOverlay` component itself and is fresh each game.
 * One combined interface would imply an owner holding both, and no such thing exists.
 */
export type SettingsProbe = () => boolean;
export type TutorialProbe = () => TutorialStatus | null;

// Defaults to the main menu. The direction of a wrong guess matters: claiming "in game" before
// a game exists makes the caller talk about a city that is not there, while claiming "in the
// main menu" is at worst one step behind.
let screen: Screen = 'menu';
let menuPage: MenuPage = 'main';
let settingsProbe: SettingsProbe | null = null;
let tutorialProbe: TutorialProbe | null = null;

/**
 * The screen changed.
 *
 * `menuPage` is always written, with no check for being in the menu: `buildStatus()` reads it
 * only while `screen === 'menu'` and returns `null` otherwise, so a "write only in the menu"
 * check would guard no observable difference.
 */
export function setScreen(next: Screen, page: MenuPage = 'main'): void {
  screen = next;
  menuPage = page;
}

export function getScreen(): Screen {
  return screen;
}

export function getMenuPage(): MenuPage {
  return menuPage;
}

/**
 * Why the last attempt to start a game failed.
 *
 * A failed start prints to the console and returns to the main menu. The caller is in **another
 * process** and cannot see that console, so without this record it only learns that the game
 * did not start and the player has to open devtools and paste the error over.
 *
 * Cleared when a new attempt begins: a stale reason makes the next failure report an outdated
 * answer, which is worse than no answer because it looks like a diagnosis.
 */
let startFailure: string | null = null;

export function setStartFailure(detail: string | null): void {
  startFailure = detail;
}

export function getStartFailure(): string | null {
  return startFailure;
}

export function registerSettingsProbe(probe: SettingsProbe | null): void {
  settingsProbe = probe;
}

export function registerTutorialProbe(probe: TutorialProbe | null): void {
  tutorialProbe = probe;
}

/** Whether the settings screen is open. Treated as closed before the UI starts, as in unit
 *  tests. */
export function isSettingsOpen(): boolean {
  return settingsProbe?.() ?? false;
}

/** How far the tutorial has got. `null` when it is not running or the UI has not started. */
export function getTutorialStatus(): TutorialStatus | null {
  return tutorialProbe?.() ?? null;
}
