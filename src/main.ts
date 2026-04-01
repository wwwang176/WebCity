import { createMainMenu, createLoadingScreen, updateLoadingProgress, removeLoadingScreen } from './ui/MainMenu';
import { loadGame } from './core/save/SaveManager';
import { deserializeGameState } from './core/save/Serializer';
import { type GameState } from './core/simulation/GameState';

interface SaveInfo {
  slotId: number;
  name: string;
}

async function startGame(loadedState?: GameState, saveInfo?: SaveInfo): Promise<void> {
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
  const game = new Game(app, loadedState);
  if (saveInfo) {
    game.loadedSlotId = saveInfo.slotId;
    game.loadedSaveName = saveInfo.name;
  }

  // Run phased initialization with real progress updates
  await game.initPhases((pct, label) => {
    updateLoadingProgress(10 + Math.round(pct * 0.9), label);
  });

  (window as unknown as Record<string, unknown>).__game = game;
  const ui = createGameUI(game);
  document.body.appendChild(ui);

  removeLoadingScreen();
}

async function handleLoadGame(slotId: number): Promise<void> {
  try {
    const slot = await loadGame(slotId);
    if (slot && slot.data) {
      const state = deserializeGameState(slot.data);
      await startGame(state, { slotId: slot.id, name: slot.name });
    } else {
      await startGame();
    }
  } catch {
    await startGame();
  }
}

// Show main menu
const app = document.getElementById('app');
if (app) {
  app.innerHTML = '';
  const menu = createMainMenu(
    () => startGame(),
    (slotId) => handleLoadGame(slotId),
  );
  document.body.appendChild(menu);
}
