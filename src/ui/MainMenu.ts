export function createMainMenu(onNewGame: () => void, onLoadGame: (slotId: number) => void): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'main-menu';
  menu.innerHTML = `
    <style>
      #main-menu {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: linear-gradient(160deg, #080c1a 0%, #0d1526 30%, #0f1e3d 60%, #0a1428 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 100;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #d0d8e8; overflow: hidden;
      }
      #main-menu::before {
        content: '';
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: radial-gradient(ellipse at 50% 30%, rgba(30, 80, 180, 0.12) 0%, transparent 60%),
                    radial-gradient(ellipse at 70% 80%, rgba(20, 60, 140, 0.08) 0%, transparent 50%);
        pointer-events: none;
      }
      .menu-title {
        font-size: 80px; font-weight: 800; letter-spacing: -2px;
        background: linear-gradient(135deg, #42a5f5 0%, #64b5f6 30%, #90caf9 60%, #42a5f5 100%);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; margin-bottom: 8px;
        text-shadow: none; position: relative;
        animation: titleGlow 3s ease-in-out infinite alternate;
      }
      @keyframes titleGlow {
        from { filter: brightness(1); }
        to { filter: brightness(1.15); }
      }
      .menu-subtitle {
        font-size: 14px; color: rgba(144, 202, 249, 0.6);
        margin-bottom: 48px; letter-spacing: 6px;
        text-transform: uppercase; font-weight: 500;
      }
      .menu-buttons {
        display: flex; flex-direction: column; gap: 12px;
        min-width: 300px; position: relative;
      }
      .menu-btn {
        background: rgba(15, 25, 50, 0.7);
        border: 1px solid rgba(66, 165, 245, 0.2);
        border-radius: 12px; color: #c0d0e8;
        padding: 16px 32px; font-size: 16px; font-weight: 500;
        cursor: pointer; transition: all 0.25s ease;
        text-align: center; position: relative;
        backdrop-filter: blur(8px);
      }
      .menu-btn:hover {
        background: rgba(25, 45, 85, 0.8);
        border-color: rgba(66, 165, 245, 0.5);
        color: #e4eaf4;
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 20px rgba(66, 165, 245, 0.1);
      }
      .menu-btn:active { transform: translateY(0); }
      .menu-version {
        position: absolute; bottom: 20px; right: 24px;
        color: rgba(255,255,255,0.15); font-size: 12px; font-weight: 400;
      }
      .save-list {
        display: flex; flex-direction: column; gap: 8px;
        min-width: 320px; max-height: 340px; overflow-y: auto; overflow-x: hidden;
        position: relative;
      }
      .save-list::-webkit-scrollbar { width: 4px; }
      .save-list::-webkit-scrollbar-track { background: transparent; }
      .save-list::-webkit-scrollbar-thumb { background: rgba(66, 165, 245, 0.2); border-radius: 2px; }
      .save-slot {
        background: rgba(15, 25, 50, 0.6);
        border: 1px solid rgba(66, 165, 245, 0.12);
        border-radius: 10px; color: #c0d0e8;
        padding: 14px 18px; cursor: pointer;
        transition: all 0.2s ease; text-align: left;
      }
      .save-slot:hover {
        background: rgba(25, 45, 85, 0.7);
        border-color: rgba(66, 165, 245, 0.4);
        transform: translateX(4px);
      }
      .save-slot .save-name { font-weight: 600; font-size: 14px; }
      .save-slot .save-date {
        color: rgba(144, 202, 249, 0.5); font-size: 12px; margin-top: 4px;
      }
      .save-empty {
        color: rgba(255,255,255,0.3); font-style: italic;
        padding: 20px; text-align: center;
      }
      #save-container {
        display: flex; flex-direction: column; min-width: 320px;
      }
    </style>
    <div class="menu-title">WebCity</div>
    <div class="menu-subtitle">City Builder Simulation</div>
    <div class="menu-buttons" id="menu-main">
      <button class="menu-btn" id="btn-new-game">New Game</button>
      <button class="menu-btn" id="btn-load-game">Load Game</button>
    </div>
    <div id="save-container" style="display:none">
      <div class="save-list" id="save-list"></div>
      <button class="menu-btn" id="btn-back" style="margin-top:12px">Back</button>
    </div>
    <div class="menu-version">v0.1.0</div>
  `;

  menu.querySelector('#btn-new-game')!.addEventListener('click', () => {
    menu.remove();
    onNewGame();
  });

  menu.querySelector('#btn-back')!.addEventListener('click', () => {
    (menu.querySelector('#save-container') as HTMLElement).style.display = 'none';
    (menu.querySelector('#menu-main') as HTMLElement).style.display = 'flex';
  });

  menu.querySelector('#btn-load-game')!.addEventListener('click', () => {
    const mainBtns = menu.querySelector('#menu-main') as HTMLElement;
    const saveContainer = menu.querySelector('#save-container') as HTMLElement;
    const saveList = menu.querySelector('#save-list') as HTMLElement;
    mainBtns.style.display = 'none';
    saveContainer.style.display = 'flex';
    saveList.innerHTML = '<div class="save-empty">Loading saves...</div>';

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
          saveList.innerHTML = '<div class="save-empty">No saves found</div>';
        } else {
          saveList.innerHTML = saves.map(s => {
            const d = new Date(s.date);
            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
            const sizeKB = Math.round(s.data.length / 1024);
            return `<div class="save-slot" data-slot="${s.id}">
              <div class="save-name">${s.name || 'Unnamed'} (Slot ${s.id})</div>
              <div class="save-date">${dateStr} \u2014 ${sizeKB}KB</div>
            </div>`;
          }).join('');
        }

        saveList.querySelectorAll('.save-slot').forEach(el => {
          el.addEventListener('click', () => {
            const slotId = parseInt((el as HTMLElement).dataset.slot!, 10);
            menu.remove();
            onLoadGame(slotId);
          });
        });

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
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: #080c1a;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 200; color: #d0d8e8;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
      }
      .loading-text {
        font-size: 20px; font-weight: 500; margin-bottom: 24px;
        color: rgba(144, 202, 249, 0.8);
      }
      .loading-bar-bg {
        width: 280px; height: 4px;
        background: rgba(255,255,255,0.06);
        border-radius: 2px; overflow: hidden;
      }
      .loading-bar-fill {
        width: 0%; height: 100%;
        background: linear-gradient(90deg, #42a5f5, #64b5f6);
        border-radius: 2px; transition: width 0.3s;
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
