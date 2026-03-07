export function createMainMenu(onNewGame: () => void, onLoadGame: (slotId: number) => void): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'main-menu';
  menu.innerHTML = `
    <style>
      #main-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 100;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        color: #eee;
      }
      .menu-title {
        font-size: 72px;
        font-weight: bold;
        background: linear-gradient(135deg, #4fc3f7 0%, #81d4fa 50%, #b3e5fc 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 10px;
        text-shadow: none;
      }
      .menu-subtitle {
        font-size: 18px;
        color: #90caf9;
        margin-bottom: 60px;
        letter-spacing: 4px;
      }
      .menu-buttons {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 280px;
      }
      .menu-btn {
        background: rgba(30, 60, 114, 0.6);
        border: 2px solid rgba(79, 195, 247, 0.3);
        border-radius: 8px;
        color: #e3f2fd;
        padding: 16px 32px;
        font-size: 18px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      .menu-btn:hover {
        background: rgba(40, 80, 140, 0.8);
        border-color: rgba(79, 195, 247, 0.7);
        transform: translateY(-2px);
      }
      .menu-version {
        position: absolute;
        bottom: 20px;
        right: 20px;
        color: rgba(255,255,255,0.3);
        font-size: 12px;
      }
    </style>
    <div class="menu-title">WebCity</div>
    <div class="menu-subtitle">CITY BUILDER SIMULATION</div>
    <div class="menu-buttons">
      <button class="menu-btn" id="btn-new-game">New Game</button>
      <button class="menu-btn" id="btn-load-game">Load Game</button>
    </div>
    <div class="menu-version">v0.1.0</div>
  `;

  menu.querySelector('#btn-new-game')!.addEventListener('click', () => {
    menu.remove();
    onNewGame();
  });

  menu.querySelector('#btn-load-game')!.addEventListener('click', () => {
    menu.remove();
    onLoadGame(1); // Default slot 1
  });

  return menu;
}

export function createLoadingScreen(): HTMLElement {
  const loading = document.createElement('div');
  loading.id = 'loading-screen';
  loading.innerHTML = `
    <style>
      #loading-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #1a1a2e;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 200;
        color: #eee;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      .loading-text {
        font-size: 24px;
        margin-bottom: 20px;
      }
      .loading-bar-bg {
        width: 300px;
        height: 6px;
        background: rgba(255,255,255,0.1);
        border-radius: 3px;
        overflow: hidden;
      }
      .loading-bar-fill {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #4fc3f7, #81d4fa);
        border-radius: 3px;
        transition: width 0.3s;
      }
    </style>
    <div class="loading-text">Loading WebCity...</div>
    <div class="loading-bar-bg">
      <div class="loading-bar-fill" id="loading-progress"></div>
    </div>
  `;
  return loading;
}

export function updateLoadingProgress(progress: number): void {
  const fill = document.getElementById('loading-progress');
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

export function removeLoadingScreen(): void {
  const el = document.getElementById('loading-screen');
  if (el) el.remove();
}
