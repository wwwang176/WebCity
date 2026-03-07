import { createMainMenu, createLoadingScreen, updateLoadingProgress, removeLoadingScreen } from './ui/MainMenu';

function startGame(): void {
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
          const game = new Game(app);
          const ui = createGameUI(game);
          document.body.appendChild(ui);
        });
      });
    }
  }, 100);
}

// Show main menu
const app = document.getElementById('app');
if (app) {
  app.innerHTML = '';
  const menu = createMainMenu(
    () => startGame(),
    (_slotId) => startGame(), // Load game also starts game for now
  );
  document.body.appendChild(menu);
}
