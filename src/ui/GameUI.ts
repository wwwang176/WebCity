import { Game, type ToolType, type SelectedBuilding } from '../Game';
import { ZoneType } from '../core/grid/types';

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
      .panel-toggle {
        pointer-events: auto;
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 10px;
        float: right;
        padding: 0 4px;
        line-height: 1;
      }
      .panel-toggle:hover { color: #fff; }
      .ui-panel.collapsed .panel-body { display: none; }
      .ui-panel.collapsed { padding: 4px 8px; }
      .ui-panel.collapsed .panel-toggle { transform: rotate(180deg); }
      #toolbar {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        justify-content: center;
        max-width: calc(100% - 200px);
      }
      .tool-btn {
        pointer-events: auto;
        background: rgba(30, 30, 60, 0.9);
        border: 2px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #ccc;
        padding: 6px 10px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.15s;
        white-space: nowrap;
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
      #building-panel {
        position: absolute;
        top: 120px;
        left: 10px;
        display: none;
        min-width: 180px;
      }
      #building-panel.visible { display: block; }
      #building-panel .bp-title { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
      #building-panel .bp-row { font-size: 12px; color: #bbb; margin: 2px 0; }
      #building-panel .bp-row span { color: #fff; }
      #mute-btn {
        pointer-events: auto;
        background: rgba(30, 30, 60, 0.9);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        color: #ccc;
        padding: 6px 10px;
        cursor: pointer;
        font-size: 14px;
        margin-left: 8px;
      }
      #mute-btn.muted { color: #f44336; }
      #notification {
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        background: linear-gradient(135deg, rgba(40, 80, 140, 0.95), rgba(30, 60, 114, 0.95));
        border: 2px solid #4fc3f7;
        border-radius: 10px;
        color: #e3f2fd;
        padding: 12px 24px;
        font-size: 14px;
        text-align: center;
        display: none;
        animation: notifSlide 0.3s ease-out;
        max-width: 400px;
      }
      #notification.visible { display: block; }
      #tax-panel {
        display: none;
      }
      .tax-inline .tax-label {
        font-size: 12px;
        margin-bottom: 2px;
        margin-top: 4px;
        border-top: 1px solid rgba(255,255,255,0.1);
        padding-top: 4px;
      }
      .tax-inline input[type="range"] {
        width: 120px;
        cursor: pointer;
      }
      .tax-inline .tax-value {
        font-size: 13px;
        font-weight: bold;
        color: #4fc3f7;
      }
      @keyframes notifSlide {
        from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
      }
    </style>
    <div id="notification"></div>
    <div id="info-panel" class="ui-panel">
      <button class="panel-toggle" data-panel="info-panel">&#9660;</button>
      <div class="panel-body">
        <div id="info-date"></div>
        <div id="info-funds"></div>
        <div id="info-pop"></div>
      </div>
    </div>
    <div id="stats-panel" class="ui-panel">
      <button class="panel-toggle" data-panel="stats-panel">&#9660;</button>
      <div class="panel-body">
        <div id="stats-income"></div>
        <div id="stats-tool"></div>
        <div id="stats-happiness" style="font-size:12px;color:#aaa;margin-top:2px"></div>
        <canvas id="stats-chart" width="140" height="60" style="margin-top:4px;border-radius:4px;background:rgba(0,0,0,0.3)"></canvas>
        <div class="tax-inline">
          <div class="tax-label">Tax Rate: <span class="tax-value" id="tax-display">9%</span></div>
          <input type="range" id="tax-slider" min="1" max="20" step="1" value="9">
        </div>
      </div>
    </div>
    <div id="tax-panel" class="ui-panel" style="display:none"></div>
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
    <div id="building-panel" class="ui-panel">
      <div class="bp-title" id="bp-name"></div>
      <div class="bp-row">Level: <span id="bp-level"></span></div>
      <div class="bp-row" id="bp-residents-row">Residents: <span id="bp-residents"></span></div>
      <div class="bp-row" id="bp-workers-row">Workers: <span id="bp-workers"></span></div>
      <div class="bp-row">Tax: <span id="bp-tax"></span>/tick</div>
      <div class="bp-row">Zone: <span id="bp-zone"></span></div>
    </div>
    <div id="speed-panel">
      <button class="speed-btn" data-speed="pause">&#9646;&#9646;</button>
      <button class="speed-btn active" data-speed="1">1x</button>
      <button class="speed-btn" data-speed="2">2x</button>
      <button class="speed-btn" data-speed="3">3x</button>
      <button id="mute-btn" title="Toggle Sound">&#128266;</button>
    </div>
  `;

  // Panel collapse/expand toggles
  ui.querySelectorAll('.panel-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = (btn as HTMLElement).dataset['panel'];
      if (panelId) {
        const panel = ui.querySelector(`#${panelId}`);
        if (panel) panel.classList.toggle('collapsed');
      }
    });
  });

  // Statistics chart data (rolling history)
  const chartHistory = { pop: [] as number[], income: [] as number[], happiness: [] as number[] };
  const CHART_MAX = 50; // Keep last 50 data points

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

  // Mute button
  const muteBtn = ui.querySelector('#mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const muted = game.getAudioManager().toggleMute();
      muteBtn.classList.toggle('muted', muted);
      muteBtn.innerHTML = muted ? '&#128264;' : '&#128266;';
    });
  }

  // Tax slider
  const taxSlider = ui.querySelector('#tax-slider') as HTMLInputElement;
  const taxDisplay = ui.querySelector('#tax-display') as HTMLElement;
  if (taxSlider) {
    // Initialize slider to current tax rate
    const initialRate = game.getState().taxRates.residential;
    taxSlider.value = String(initialRate);
    if (taxDisplay) taxDisplay.textContent = `${initialRate}%`;

    taxSlider.addEventListener('input', () => {
      const rate = parseInt(taxSlider.value, 10);
      game.getState().taxRates.residential = rate;
      if (taxDisplay) taxDisplay.textContent = `${rate}%`;
    });
  }

  const ZONE_NAMES: Record<number, string> = {
    [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
    [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
    [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
    [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
    [ZoneType.INDUSTRIAL]: 'Industrial',
    [ZoneType.OFFICE]: 'Office',
  };

  function updateBuildingPanel(selected: SelectedBuilding | null): void {
    const panel = ui.querySelector('#building-panel') as HTMLElement;
    if (!panel) return;
    if (!selected) {
      panel.classList.remove('visible');
      return;
    }
    panel.classList.add('visible');
    const nameEl = panel.querySelector('#bp-name') as HTMLElement;
    const levelEl = panel.querySelector('#bp-level') as HTMLElement;
    const residentsEl = panel.querySelector('#bp-residents') as HTMLElement;
    const workersEl = panel.querySelector('#bp-workers') as HTMLElement;
    const taxEl = panel.querySelector('#bp-tax') as HTMLElement;
    const zoneEl = panel.querySelector('#bp-zone') as HTMLElement;
    const residentsRow = panel.querySelector('#bp-residents-row') as HTMLElement;
    const workersRow = panel.querySelector('#bp-workers-row') as HTMLElement;

    const bt = selected.buildingType;
    if (nameEl) nameEl.textContent = bt.name;
    if (levelEl) levelEl.textContent = `${'★'.repeat(bt.level)}${'☆'.repeat(3 - bt.level)}`;
    if (residentsRow) residentsRow.style.display = bt.residents > 0 ? '' : 'none';
    if (residentsEl) residentsEl.textContent = String(bt.residents);
    if (workersRow) workersRow.style.display = bt.workers > 0 ? '' : 'none';
    if (workersEl) workersEl.textContent = String(bt.workers);
    if (taxEl) taxEl.textContent = `$${bt.taxRevenue}`;
    if (zoneEl) zoneEl.textContent = ZONE_NAMES[selected.zoneType] ?? 'Unknown';
  }

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

    // Tool + preview cost
    const toolEl = ui.querySelector('#stats-tool');
    if (toolEl) {
      const costStr = game.previewCost != null ? ` (Est: $${game.previewCost})` : '';
      toolEl.textContent = `Tool: ${game.getToolType()}${costStr}`;
    }

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

    // Building info panel
    updateBuildingPanel(game.getSelectedBuilding());

    // Notification
    const notifEl = ui.querySelector('#notification') as HTMLElement;
    if (notifEl) {
      const notif = game.getNotification();
      if (notif) {
        notifEl.textContent = notif;
        notifEl.classList.add('visible');
      } else {
        notifEl.classList.remove('visible');
      }
    }

    // Tax slider sync
    const taxSliderEl = ui.querySelector('#tax-slider') as HTMLInputElement;
    const taxDisplayEl = ui.querySelector('#tax-display') as HTMLElement;
    if (taxSliderEl && taxDisplayEl) {
      const currentRate = state.taxRates.residential;
      taxSliderEl.value = String(currentRate);
      taxDisplayEl.textContent = `${currentRate}%`;
    }

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

    // Happiness display
    const happyEl = ui.querySelector('#stats-happiness') as HTMLElement;
    if (happyEl) {
      const citizens = state.citizens.citizens;
      if (citizens.length > 0) {
        const avg = Math.round(citizens.reduce((s: number, c: { happiness: number }) => s + c.happiness, 0) / citizens.length);
        happyEl.textContent = `Happiness: ${avg}%`;
      } else {
        happyEl.textContent = 'Happiness: --';
      }
    }

    // Statistics chart (population over time)
    const pop = state.citizens.getPopulation();
    const income = Math.floor(state.budget.income - state.budget.expenses);
    const citizens2 = state.citizens.citizens;
    const avgH = citizens2.length > 0 ? Math.round(citizens2.reduce((s: number, c: { happiness: number }) => s + c.happiness, 0) / citizens2.length) : 50;
    chartHistory.pop.push(pop);
    chartHistory.income.push(income);
    chartHistory.happiness.push(avgH);
    if (chartHistory.pop.length > CHART_MAX) { chartHistory.pop.shift(); chartHistory.income.shift(); chartHistory.happiness.shift(); }

    const canvas = ui.querySelector('#stats-chart') as HTMLCanvasElement;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Draw population line (green)
        const maxPop = Math.max(10, ...chartHistory.pop);
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < chartHistory.pop.length; i++) {
          const x = (i / (CHART_MAX - 1)) * w;
          const y = h - (chartHistory.pop[i]! / maxPop) * (h - 4) - 2;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw happiness line (yellow)
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < chartHistory.happiness.length; i++) {
          const x = (i / (CHART_MAX - 1)) * w;
          const y = h - (chartHistory.happiness[i]! / 100) * (h - 4) - 2;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#4caf50';
        ctx.font = '8px sans-serif';
        ctx.fillText(`Pop: ${pop}`, 2, 8);
        ctx.fillStyle = '#ffeb3b';
        ctx.fillText(`Happy: ${avgH}%`, 70, 8);
      }
    }
  }

  game.setOnUIUpdate(updateUI);
  updateUI();

  return ui;
}
