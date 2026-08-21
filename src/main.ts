import { createMainMenu, createLoadingScreen, updateLoadingProgress, removeLoadingScreen } from './ui/MainMenu';
import { loadGame, quarantineSave } from './core/save/SaveManager';
import { loadSaveData } from './core/save/LoadSave';
import { type GameState } from './core/simulation/GameState';
import { type MapConfig } from './core/config/MapConfig';
import { classifySaveError, missingSaveFailure, type SaveFailure } from './core/save/SaveFailure';
import { createAgent } from './agent';
import { AgentSession } from './agent/AgentSession';
import { registerSessionBridge } from './agent/registry';

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

  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__agent = createAgent(game);
  const ui = createGameUI(game);
  document.body.appendChild(ui);

  // Hold 100% for at least 300ms so it doesn't flash
  await new Promise(r => setTimeout(r, 300));
  removeLoadingScreen();
}

function showMainMenu(failure?: SaveFailure, note?: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  app.style.display = 'block';
  const menu = createMainMenu(
    (config) => { void startGameGuarded(undefined, undefined, config); },
    (slotId) => { void handleLoadGame(slotId); },
  );
  document.body.appendChild(menu);
  if (failure) showLoadError(menu, failure, note);
}

/** A banner on the menu, so the reason survives the return trip. */
function showLoadError(menu: HTMLElement, failure: SaveFailure, note?: string): void {
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
  // The exact thing that was wrong, underneath. loadSaveData computes it and
  // used to hand it only to console.error, so the player was told "the file is
  // damaged" while the answer — "clock.speed = 2", "grid.width missing" — went
  // somewhere they would never look.
  for (const line of [failure.detail, note]) {
    if (!line) continue;
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:6px;font-size:12px;opacity:0.85';
    sub.textContent = line;
    banner.appendChild(sub);
  }
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
    const failure = classifySaveError(err, 'load');
    console.error('[save] load failed:', failure.detail);
    showMainMenu(failure);
    return;
  }

  if (!slot || !slot.data) {
    showMainMenu(missingSaveFailure(slotId));
    return;
  }

  // loadSaveData validates before deserializing, so damage is reported as the
  // field that is wrong rather than as a TypeError from inside the deserializer.
  const result = loadSaveData(slot.data);
  if (!result.ok) {
    console.error('[save] could not read slot', slotId, '-', result.failure.detail);
    // Keep a copy in a slot nothing writes to.
    //
    // Leaving the original alone is not enough on its own: autosave writes slot
    // 0 unconditionally, and slot 0 is the AutoSave slot — the one most likely
    // to be the broken one — so the player pressing New Game next overwrote the
    // bytes 100 ticks later. The copy survives whatever they press.
    const copy = await quarantineSave(slotId);
    showMainMenu(
      result.failure,
      copy === null ? undefined : `A copy has been kept in slot ${copy} so you can still export it.`,
    );
    return;
  }

  await startGameGuarded(result.state, { slotId: slot.id, name: slot.name });
}

/**
 * Start a game, or go back to the menu saying why not.
 *
 * `startGame` had no catch anywhere: it is called as a floating promise from
 * showMainMenu and awaited inside an async function whose own caller discards
 * the promise. Anything that threw after the save was read — the dynamic
 * import, the Game constructor, initPhases, createGameUI — left the loading
 * screen up, the menu gone and an unhandled rejection. Exactly the "never
 * advances and never errors" state the onblocked fix was written to remove.
 */
async function startGameGuarded(
  loadedState?: GameState, saveInfo?: SaveInfo, mapConfig?: MapConfig,
): Promise<void> {
  try {
    await startGame(loadedState, saveInfo, mapConfig);
  } catch (err) {
    removeLoadingScreen();
    const failure = classifySaveError(err, 'load');
    console.error('[game] failed to start:', failure.detail);
    showMainMenu({ ...failure, message: 'The game could not start. Nothing has been changed.' });
  }
}

// 載入與開新局住在這裡（它們會把整個 Game 換掉），agent 從註冊表取用。
// 刪除存檔刻意不註冊 —— 沒有復原功能，存檔是唯一的檢查點。
registerSessionBridge({
  newGame: (mapConfig) => startGameGuarded(undefined, undefined, mapConfig as MapConfig | undefined),
  load: (slotId) => handleLoadGame(slotId),
});

// 主選單上也要碰得到「有哪些存檔」與「開新局」—— 那時候還沒有 Game，所以先掛一個
// 只有 session 的版本。開局之後 startGame 會換成完整的。
(window as unknown as Record<string, unknown>).__agent = {
  session: new AgentSession(
    () => { throw new Error('no game is running'); },
    () => 0,
  ),
};

showMainMenu();
