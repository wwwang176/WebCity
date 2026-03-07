import { Game } from './Game';
import { createGameUI } from './ui/GameUI';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = '';
  app.style.display = 'block';

  const game = new Game(app);
  const ui = createGameUI(game);
  document.body.appendChild(ui);
}
