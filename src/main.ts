import { createMainMenu, createLoadingScreen, updateLoadingProgress, removeLoadingScreen } from './ui/MainMenu';
import { loadGame } from './core/save/SaveManager';
import { loadSaveData } from './core/save/LoadSave';
import { type GameState } from './core/simulation/GameState';
import { type MapConfig } from './core/config/MapConfig';
import { classifySaveError, missingSaveFailure, type SaveFailure } from './core/save/SaveFailure';

interface SaveInfo {
  slotId: number;
  name: string;
}

async function startGame(loadedState?: GameState, saveInfo?: SaveInfo, mapConfig?: MapConfig): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  // Show loading screen
  const loading = createLoadingScreen();
  document.body.appendChild(loading);
  updateLoadingProgress(5, 'Loading modules...');
  await new Promise(r => requestAnimationFrame(r));

  // Import game modules
  const { Game } = await import('./Game');
  const { createGameUI } = await import('./ui/GameUI');

  updateLoadingProgress(10, 'Initializing...');
  await new Promise(r => requestAnimationFrame(r));

  app.innerHTML = '';
  app.style.display = 'block';
  const game = new Game(app, loadedState, mapConfig);
  if (saveInfo) {
    game.loadedSlotId = saveInfo.slotId;
    game.loadedSaveName = saveInfo.name;
  }

  // Run phased initialization with real progress updates
  await game.initPhases((pct, label) => {
    updateLoadingProgress(10 + Math.round(pct * 0.9), label);
  });

  updateLoadingProgress(100, 'Ready!');

  (window as unknown as Record<string, unknown>).__game = game;
  const ui = createGameUI(game);
  document.body.appendChild(ui);

  // Hold 100% for at least 300ms so it doesn't flash
  await new Promise(r => setTimeout(r, 300));
  removeLoadingScreen();
}

function showMainMenu(failure?: SaveFailure): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  app.style.display = 'block';
  const menu = createMainMenu(
    (config) => startGame(undefined, undefined, config),
    (slotId) => handleLoadGame(slotId),
  );
  document.body.appendChild(menu);
  if (failure) showLoadError(menu, failure);
}

/** A banner on the menu, so the reason survives the return trip. */
function showLoadError(menu: HTMLElement, failure: SaveFailure): void {
  const banner = document.createElement('div');
  banner.id = 'load-error';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
    'max-width:560px', 'padding:12px 18px', 'border-radius:10px',
    'background:rgba(180,40,40,0.92)', 'color:#fff', 'font-size:14px',
    'line-height:1.5', 'z-index:200', 'text-align:center',
    'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
  ].join(';');
  banner.textContent = failure.message;
  menu.appendChild(banner);
}

/**
 * Load a save, or say why not.
 *
 * The previous version ended `catch { await startGame(); }`. A save that failed
 * to load — a truncated write, a database fault, a version the deserializer
 * choked on — silently became a brand new empty city, on the same slot, and the
 * first autosave 100 ticks later wrote that empty city over the save the player
 * had just failed to open. The bytes were still intact at the moment of
 * failure; only the recovery destroyed them.
 *
 * Nothing here starts a game it was not asked to start. On any failure we go
 * back to the menu with the reason on screen, no Game is constructed, and so no
 * autosave can run.
 */
async function handleLoadGame(slotId: number): Promise<void> {
  let slot;
  try {
    slot = await loadGame(slotId);
  } catch (err) {
    console.error('[save] load failed:', classifySaveError(err).detail);
    showMainMenu(classifySaveError(err));
    return;
  }

  if (!slot || !slot.data) {
    showMainMenu(missingSaveFailure(slotId));
    return;
  }

  // loadSaveData validates before deserializing, so damage is reported as the
  // field that is wrong rather than as a TypeError from inside the deserializer.
  // It deliberately does NOT delete or rewrite the slot: a save this build
  // cannot parse may still be readable by the next one, and is still
  // exportable from the menu.
  const result = loadSaveData(slot.data);
  if (!result.ok) {
    console.error('[save] could not read slot', slotId, '-', result.failure.detail);
    showMainMenu(result.failure);
    return;
  }

  await startGame(result.state, { slotId: slot.id, name: slot.name });
}

showMainMenu();
