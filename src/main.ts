import { createMainMenu, createLoadingScreen, updateLoadingProgress, removeLoadingScreen } from './ui/MainMenu';
import { loadGame } from './core/save/SaveManager';
import { deserializeGameState } from './core/save/Serializer';
import { type GameState } from './core/simulation/GameState';

interface SaveInfo {
  slotId: number;
  name: string;
}

function startGame(loadedState?: GameState, saveInfo?: SaveInfo): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Show loading screen
  const loading = createLoadingScreen();
  document.body.appendChild(loading);

  // Simulate loading progress
  let progress = 0;
  const loadInterval = setInterval(() => {
    progress += 15;
    updateLoadingProgress(progress);
    if (progress >= 100) {
      clearInterval(loadInterval);
      removeLoadingScreen();

      // Dynamically import the game to allow loading screen to show
      import('./Game').then(({ Game }) => {
        import('./ui/GameUI').then(({ createGameUI }) => {
          app.innerHTML = '';
          app.style.display = 'block';
          const game = new Game(app, loadedState);
          if (saveInfo) {
            game.loadedSlotId = saveInfo.slotId;
            game.loadedSaveName = saveInfo.name;
          }
          (window as unknown as Record<string, unknown>).__game = game;
          const ui = createGameUI(game);
          document.body.appendChild(ui);
        });
      });
    }
  }, 100);
}

async function handleLoadGame(slotId: number): Promise<void> {
  try {
    const slot = await loadGame(slotId);
    if (slot && slot.data) {
      const state = deserializeGameState(slot.data);
      startGame(state, { slotId: slot.id, name: slot.name });
    } else {
      // No save found, start new game
      startGame();
    }
  } catch {
    // Failed to load, start new game
    startGame();
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
