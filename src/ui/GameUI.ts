import { Game, type ToolType } from '../Game';

const TOOL_BUTTONS: { tool: ToolType; label: string; key: string; color: string }[] = [
  { tool: 'select', label: 'Select', key: '1', color: '#ffffff' },
  { tool: 'road', label: 'Road', key: '2', color: '#424242' },
  { tool: 'zone_r', label: 'Residential', key: '3', color: '#4caf50' },
  { tool: 'zone_c', label: 'Commercial', key: '4', color: '#2196f3' },
  { tool: 'zone_i', label: 'Industrial', key: '5', color: '#ffa726' },
  { tool: 'zone_o', label: 'Office', key: '6', color: '#ab47bc' },
  { tool: 'demolish', label: 'Demolish', key: '7', color: '#f44336' },
];

export function createGameUI(game: Game): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'game-ui';
  ui.innerHTML = `
    <style>
      #game-ui {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      .ui-panel {
        pointer-events: auto;
        background: rgba(20, 20, 40, 0.9);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        color: #eee;
        padding: 8px 12px;
      }
      #toolbar {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 4px;
      }
      .tool-btn {
        pointer-events: auto;
        background: rgba(30, 30, 60, 0.9);
        border: 2px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #ccc;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.15s;
      }
      .tool-btn:hover {
        background: rgba(50, 50, 80, 0.95);
      }
      .tool-btn.active {
        border-color: #4fc3f7;
        color: #fff;
        background: rgba(40, 60, 100, 0.95);
      }
      .tool-btn .key {
        font-size: 10px;
        opacity: 0.5;
        display: block;
      }
      #info-panel {
        position: absolute;
        top: 10px;
        left: 10px;
      }
      #stats-panel {
        position: absolute;
        top: 10px;
        right: 10px;
      }
      #speed-panel {
        position: absolute;
        bottom: 20px;
        right: 20px;
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .speed-btn {
        pointer-events: auto;
        background: rgba(30, 30, 60, 0.9);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        color: #ccc;
        padding: 6px 10px;
        cursor: pointer;
        font-size: 12px;
      }
      .speed-btn.active {
        border-color: #4fc3f7;
        color: #fff;
      }
      #rci-bar {
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 6px;
        align-items: flex-end;
      }
      .rci-meter {
        width: 20px;
        background: rgba(20,20,40,0.8);
        border-radius: 3px;
        overflow: hidden;
        position: relative;
        height: 50px;
      }
      .rci-fill {
        position: absolute;
        bottom: 0;
        width: 100%;
        transition: height 0.3s;
        border-radius: 3px;
      }
      .rci-label {
        font-size: 10px;
        text-align: center;
        color: #ccc;
      }
    </style>
    <div id="info-panel" class="ui-panel">
      <div id="info-date"></div>
      <div id="info-funds"></div>
      <div id="info-pop"></div>
    </div>
    <div id="stats-panel" class="ui-panel">
      <div id="stats-income"></div>
      <div id="stats-tool"></div>
    </div>
    <div id="toolbar">
      ${TOOL_BUTTONS.map(b => `
        <button class="tool-btn" data-tool="${b.tool}">
          <span style="color:${b.color}">&#9632;</span> ${b.label}
          <span class="key">[${b.key}]</span>
        </button>
      `).join('')}
    </div>
    <div id="rci-bar">
      <div>
        <div class="rci-meter"><div class="rci-fill" id="rci-r" style="background:#4caf50;height:50%"></div></div>
        <div class="rci-label">R</div>
      </div>
      <div>
        <div class="rci-meter"><div class="rci-fill" id="rci-c" style="background:#2196f3;height:50%"></div></div>
        <div class="rci-label">C</div>
      </div>
      <div>
        <div class="rci-meter"><div class="rci-fill" id="rci-i" style="background:#ffa726;height:50%"></div></div>
        <div class="rci-label">I</div>
      </div>
    </div>
    <div id="speed-panel">
      <button class="speed-btn" data-speed="pause">&#9646;&#9646;</button>
      <button class="speed-btn active" data-speed="1">1x</button>
      <button class="speed-btn" data-speed="2">2x</button>
      <button class="speed-btn" data-speed="3">3x</button>
    </div>
  `;

  // Tool buttons
  ui.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset['tool'] as ToolType;
      game.setTool(tool);
      updateUI();
    });
  });

  // Speed buttons
  ui.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = (btn as HTMLElement).dataset['speed'];
      if (speed === 'pause') {
        game.paused = !game.paused;
        const state = game.getState();
        if (game.paused) state.clock.pause();
        else state.clock.resume();
      } else {
        const s = parseInt(speed ?? '1') as 1 | 2 | 3;
        game.speed = s;
        game.getState().clock.setSpeed(s);
        game.paused = false;
      }
      updateUI();
    });
  });

  function updateUI(): void {
    const state = game.getState();
    const clock = state.clock;

    // Date
    const dateEl = ui.querySelector('#info-date');
    if (dateEl) dateEl.textContent = `Day ${(clock.getDay() % 30) + 1} | Month ${(clock.getMonth() % 12) + 1} | Year ${clock.getYear() + 1}`;

    // Funds
    const fundsEl = ui.querySelector('#info-funds');
    if (fundsEl) fundsEl.textContent = `Funds: $${Math.floor(state.budget.funds).toLocaleString()}`;

    // Population
    const popEl = ui.querySelector('#info-pop');
    if (popEl) popEl.textContent = `Population: ${state.citizens.getPopulation()}`;

    // Income
    const incomeEl = ui.querySelector('#stats-income');
    if (incomeEl) incomeEl.textContent = `Balance: $${Math.floor(state.budget.income - state.budget.expenses)}/tick`;

    // Tool
    const toolEl = ui.querySelector('#stats-tool');
    if (toolEl) toolEl.textContent = `Tool: ${game.getToolType()}`;

    // Active tool button
    ui.querySelectorAll('.tool-btn').forEach(btn => {
      const tool = (btn as HTMLElement).dataset['tool'];
      btn.classList.toggle('active', tool === game.getToolType());
    });

    // Speed buttons
    ui.querySelectorAll('.speed-btn').forEach(btn => {
      const speed = (btn as HTMLElement).dataset['speed'];
      if (speed === 'pause') {
        btn.classList.toggle('active', game.paused);
      } else {
        btn.classList.toggle('active', !game.paused && game.speed === parseInt(speed ?? '1'));
      }
    });

    // RCI bars
    const rci = state.rciDemand;
    if (rci) {
      const rciR = ui.querySelector('#rci-r') as HTMLElement;
      const rciC = ui.querySelector('#rci-c') as HTMLElement;
      const rciI = ui.querySelector('#rci-i') as HTMLElement;
      if (rciR) rciR.style.height = `${Math.max(5, (rci.residential + 100) / 2)}%`;
      if (rciC) rciC.style.height = `${Math.max(5, (rci.commercial + 100) / 2)}%`;
      if (rciI) rciI.style.height = `${Math.max(5, (rci.industrial + 100) / 2)}%`;
    }
  }

  game.setOnUIUpdate(updateUI);
  updateUI();

  return ui;
}
