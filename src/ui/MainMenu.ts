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
      .save-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 280px;
        max-height: 300px;
        overflow-y: auto;
      }
      .save-slot {
        background: rgba(30, 60, 114, 0.4);
        border: 1px solid rgba(79, 195, 247, 0.2);
        border-radius: 6px;
        color: #e3f2fd;
        padding: 12px 16px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
      }
      .save-slot:hover {
        background: rgba(40, 80, 140, 0.7);
        border-color: rgba(79, 195, 247, 0.6);
      }
      .save-slot .save-name { font-weight: bold; }
      .save-slot .save-date { color: #90caf9; font-size: 12px; margin-top: 4px; }
      .save-empty { color: rgba(255,255,255,0.4); font-style: italic; padding: 16px; text-align: center; }
    </style>
    <div class="menu-title">WebCity</div>
    <div class="menu-subtitle">CITY BUILDER SIMULATION</div>
    <div class="menu-buttons" id="menu-main">
      <button class="menu-btn" id="btn-new-game">New Game</button>
      <button class="menu-btn" id="btn-load-game">Load Game</button>
    </div>
    <div class="save-list" id="save-list" style="display:none"></div>
    <div class="menu-version">v0.1.0</div>
  `;

  menu.querySelector('#btn-new-game')!.addEventListener('click', () => {
    menu.remove();
    onNewGame();
  });

  menu.querySelector('#btn-load-game')!.addEventListener('click', () => {
    const mainBtns = menu.querySelector('#menu-main') as HTMLElement;
    const saveList = menu.querySelector('#save-list') as HTMLElement;
    mainBtns.style.display = 'none';
    saveList.style.display = 'flex';
    saveList.innerHTML = '<div class="save-empty">Loading saves...</div>';

    // List saves from IndexedDB
    const dbReq = indexedDB.open('webcity-saves', 1);
    dbReq.onupgradeneeded = () => {
      const db = dbReq.result;
      if (!db.objectStoreNames.contains('saves')) {
        db.createObjectStore('saves', { keyPath: 'id' });
      }
    };
    dbReq.onsuccess = () => {
      const db = dbReq.result;
      const tx = db.transaction('saves', 'readonly');
      const store = tx.objectStore('saves');
      const req = store.getAll();
      req.onsuccess = () => {
        const saves = req.result as { id: number; name: string; date: string; data: string }[];
        if (saves.length === 0) {
          saveList.innerHTML = '<div class="save-empty">No saves found</div>' +
            '<button class="menu-btn" id="btn-back">Back</button>';
        } else {
          saveList.innerHTML = saves.map(s => {
            const d = new Date(s.date);
            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
            const sizeKB = Math.round(s.data.length / 1024);
            return `<div class="save-slot" data-slot="${s.id}">
              <div class="save-name">${s.name || 'Unnamed'} (Slot ${s.id})</div>
              <div class="save-date">${dateStr} — ${sizeKB}KB</div>
            </div>`;
          }).join('') + '<button class="menu-btn" id="btn-back" style="margin-top:8px">Back</button>';
        }

        // Bind click on each save slot
        saveList.querySelectorAll('.save-slot').forEach(el => {
          el.addEventListener('click', () => {
            const slotId = parseInt((el as HTMLElement).dataset.slot!, 10);
            menu.remove();
            onLoadGame(slotId);
          });
        });

        // Back button
        const backBtn = saveList.querySelector('#btn-back');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            saveList.style.display = 'none';
            mainBtns.style.display = 'flex';
          });
        }
      };
      tx.oncomplete = () => db.close();
    };
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
