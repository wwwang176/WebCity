import { listSaves, deleteSave } from '../core/save/SaveManager';

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
        padding: 14px 18px;
        transition: all 0.2s ease; text-align: left;
      }
      .save-slot:hover {
        background: rgba(25, 45, 85, 0.7);
        border-color: rgba(66, 165, 245, 0.4);
      }
      .save-slot .save-info { cursor: pointer; }
      .save-slot .save-info:hover { opacity: 0.85; }
      .save-slot .save-info { flex: 1; min-width: 0; }
      .save-slot .save-name { font-weight: 600; font-size: 14px; }
      .save-slot .save-date {
        color: rgba(144, 202, 249, 0.5); font-size: 12px; margin-top: 4px;
      }
      .save-slot .save-delete {
        background: none; border: none;
        color: rgba(255,255,255,0.2); border-radius: 6px;
        padding: 4px 8px; font-size: 15px; cursor: pointer;
        transition: all 0.2s ease; flex-shrink: 0; align-self: center;
        opacity: 0; pointer-events: none; line-height: 1;
      }
      .save-slot:hover .save-delete {
        opacity: 1; pointer-events: auto;
      }
      .save-slot .save-delete:hover {
        color: rgba(239,83,80,0.8);
      }
      .save-empty {
        color: rgba(255,255,255,0.3); font-style: italic;
        padding: 20px; text-align: center;
      }
      #save-container {
        display: flex; flex-direction: column; min-width: 320px;
      }
      .dm-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.35); z-index: 200;
        display: flex; align-items: center; justify-content: center;
        animation: dm-fade 0.2s ease;
      }
      @keyframes dm-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes dm-slide { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .dm-panel {
        background: rgba(12, 16, 32, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(100,180,255,0.15);
        border-radius: 16px; color: #d0d8e8; padding: 0;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(100,180,255,0.06);
        min-width: 280px; max-width: 380px; width: auto;
        animation: dm-slide 0.25s ease;
      }
      .dm-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px; border-bottom: 1px solid rgba(100,180,255,0.08);
      }
      .dm-title {
        font-size: 15px; font-weight: 600; color: #e4eaf4;
        display: flex; align-items: center; gap: 8px;
      }
      .dm-close {
        background: rgba(255,255,255,0.06); border: none;
        border-radius: 8px; color: #8899b0;
        width: 32px; height: 32px; cursor: pointer;
        font-size: 16px; display: flex; align-items: center; justify-content: center;
        transition: all 0.12s;
      }
      .dm-close:hover { background: rgba(239,83,80,0.2); color: #ef5350; }
      .dm-body { padding: 16px 20px; }
      .dm-text {
        font-size: 13px; color: #b0bec5; margin: 0 0 16px; line-height: 1.5;
      }
      .dm-actions { display: flex; gap: 8px; }
      .dm-btn {
        flex: 1; border: none; border-radius: 6px;
        padding: 8px 0; cursor: pointer; font-size: 13px;
        font-weight: 600; transition: opacity 0.1s;
        font-family: inherit;
      }
      .dm-btn:hover { opacity: 0.85; }
      .dm-btn--yes { background: #ef5350; color: #fff; }
      .dm-btn--no { background: rgba(100,180,255,0.12); color: #c0d0e8; }
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

  function showDeleteModal(saveName: string, onConfirm: () => void) {
    const overlay = document.createElement('div');
    overlay.className = 'dm-overlay';
    overlay.innerHTML = `
      <div class="dm-panel">
        <div class="dm-header">
          <div class="dm-title">\u26A0\uFE0F Delete Save</div>
          <button class="dm-close">&times;</button>
        </div>
        <div class="dm-body">
          <p class="dm-text">Are you sure you want to delete <strong style="color:#e4eaf4">${saveName}</strong>? This cannot be undone.</p>
          <div class="dm-actions">
            <button class="dm-btn dm-btn--yes">Delete</button>
            <button class="dm-btn dm-btn--no">Cancel</button>
          </div>
        </div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.dm-close')!.addEventListener('click', close);
    overlay.querySelector('.dm-btn--no')!.addEventListener('click', close);
    overlay.querySelector('.dm-btn--yes')!.addEventListener('click', () => {
      close();
      onConfirm();
    });
    menu.appendChild(overlay);
  }

  function renderSaveList(saveList: HTMLElement) {
    saveList.innerHTML = '<div class="save-empty">Loading saves...</div>';
    listSaves().then(saves => {
      if (saves.length === 0) {
        saveList.innerHTML = '<div class="save-empty">No saves found</div>';
        return;
      }
      saveList.innerHTML = saves.map(s => {
        const d = new Date(s.date);
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        const sizeKB = Math.round(s.data.length / 1024);
        const popStr = s.population !== undefined ? ` \u2014 Pop: ${s.population.toLocaleString()}` : '';
        return `<div class="save-slot" data-slot="${s.id}" style="display:flex;gap:10px;align-items:stretch">
          <div class="save-info" data-action="load">
            <div class="save-name">${s.name || 'Unnamed'} (Slot ${s.id})</div>
            <div class="save-date">${dateStr} \u2014 ${sizeKB}KB${popStr}</div>
          </div>
          <button class="save-delete" data-delete="${s.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>`;
      }).join('');

      saveList.querySelectorAll('.save-info').forEach(el => {
        el.addEventListener('click', () => {
          const slot = (el.closest('.save-slot') as HTMLElement).dataset.slot!;
          menu.remove();
          onLoadGame(parseInt(slot, 10));
        });
      });

      saveList.querySelectorAll('.save-delete').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const btn = el as HTMLButtonElement;
          const slotId = parseInt(btn.dataset.delete!, 10);
          const slotEl = btn.closest('.save-slot') as HTMLElement;
          const name = slotEl.querySelector('.save-name')!.textContent || 'Unnamed';
          showDeleteModal(name, () => {
            deleteSave(slotId).then(() => renderSaveList(saveList));
          });
        });
      });
    });
  }

  menu.querySelector('#btn-load-game')!.addEventListener('click', () => {
    const mainBtns = menu.querySelector('#menu-main') as HTMLElement;
    const saveContainer = menu.querySelector('#save-container') as HTMLElement;
    const saveList = menu.querySelector('#save-list') as HTMLElement;
    mainBtns.style.display = 'none';
    saveContainer.style.display = 'flex';
    renderSaveList(saveList);
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
