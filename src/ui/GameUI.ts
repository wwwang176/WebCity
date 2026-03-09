import { Game, type ToolType, type SelectedBuilding } from '../Game';
import { ZoneType } from '../core/grid/types';
import { RoadType, ROAD_CONFIGS } from '../core/road/types';
import { getBuildingType, BUILDING_TYPES } from '../core/building/types';
import { calculateAttractiveness } from '../core/citizen/Migration';

interface SubTool { tool: ToolType; label: string; key: string; color: string; icon: string }
interface ToolGroup { id: string; label: string; icon: string; color: string; items: SubTool[] }

const ZONE_GROUP: ToolGroup = {
  id: 'zone', label: 'Zones', icon: '\u{1F3D8}', color: '#66bb6a',
  items: [
    { tool: 'zone_r', label: 'Res Low', key: '3', color: '#66bb6a', icon: '\u{1F3E0}' },
    { tool: 'zone_rh', label: 'Res High', key: '', color: '#2e7d32', icon: '\u{1F3E2}' },
    { tool: 'zone_c', label: 'Com Low', key: '4', color: '#42a5f5', icon: '\u{1F3EC}' },
    { tool: 'zone_ch', label: 'Com High', key: '', color: '#1565c0', icon: '\u{1F3EC}' },
    { tool: 'zone_i', label: 'Industrial', key: '5', color: '#ffa726', icon: '\u{1F3ED}' },
    { tool: 'zone_o', label: 'Office', key: '6', color: '#ab47bc', icon: '\u{1F3E2}' },
  ],
};

const INFRA_GROUP: ToolGroup = {
  id: 'infra', label: 'Infra', icon: '\u{1F3D7}', color: '#78909c',
  items: [
    { tool: 'road_rural', label: 'Road Rural', key: '7', color: '#8d6e63', icon: '\u{1F6A7}' },
    { tool: 'road_2lane', label: 'Road 2-Lane', key: '', color: '#78909c', icon: '\u{1F6E3}' },
    { tool: 'road_4lane', label: 'Road 4-Lane', key: '', color: '#607d8b', icon: '\u{1F6E4}' },
    { tool: 'power', label: 'Power', key: '8', color: '#ffeb3b', icon: '\u{26A1}' },
    { tool: 'water', label: 'Water', key: '9', color: '#03a9f4', icon: '\u{1F4A7}' },
    { tool: 'police', label: 'Police', key: '', color: '#3f51b5', icon: '\u{1F694}' },
    { tool: 'fire', label: 'Fire Dept', key: '', color: '#d32f2f', icon: '\u{1F692}' },
    { tool: 'hospital', label: 'Hospital', key: '', color: '#e91e63', icon: '\u{1F3E5}' },
    { tool: 'school', label: 'School', key: '', color: '#795548', icon: '\u{1F3EB}' },
    { tool: 'park', label: 'Park', key: '', color: '#4caf50', icon: '\u{1F333}' },
    { tool: 'garbage', label: 'Landfill', key: '', color: '#795548', icon: '\u{1F5D1}' },
    { tool: 'sewage', label: 'Sewage', key: '', color: '#607d8b', icon: '\u{1F6B0}' },
    { tool: 'cemetery', label: 'Cemetery', key: '', color: '#9e9e9e', icon: '\u{26B0}' },
  ],
};

const STANDALONE_TOOLS: SubTool[] = [
  { tool: 'select', label: 'Select', key: '1', color: '#b0bec5', icon: '\u{1F5B1}' },
  { tool: 'demolish', label: 'Demolish', key: '0', color: '#ef5350', icon: '\u{1F4A5}' },
];

// All tools in all groups (for keyboard shortcuts)
const ALL_TOOLS: SubTool[] = [
  ...STANDALONE_TOOLS,
  ...ZONE_GROUP.items,
  ...INFRA_GROUP.items,
];


const STYLES = `
  /* ===== Base ===== */
  #game-ui {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 10;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* ===== Glass Panels ===== */
  .g-panel {
    pointer-events: auto;
    background: rgba(8, 12, 28, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(100, 180, 255, 0.12);
    border-radius: 12px;
    color: #d0d8e8;
    padding: 10px 14px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .g-panel-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px; padding-bottom: 6px;
    border-bottom: 1px solid rgba(100,180,255,0.08);
  }
  .g-panel-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 1.2px; color: rgba(120,180,255,0.7);
  }

  /* ===== Top Bar ===== */
  #top-bar {
    position: absolute; top: 0; left: 0; right: 0;
    pointer-events: auto;
    background: rgba(8, 12, 28, 0.82);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(100,180,255,0.08);
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 16px; min-height: 44px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  }
  .top-section { display: flex; align-items: center; gap: 16px; }
  .top-stat {
    display: flex; flex-direction: column; align-items: flex-start;
    font-size: 11px; color: #8899b0;
  }
  .top-stat .stat-value {
    font-size: 15px; font-weight: 600; color: #e4eaf4;
    font-variant-numeric: tabular-nums;
  }
  .top-stat .stat-label { font-size: 10px; letter-spacing: 0.5px; }
  .stat-positive { color: #66bb6a !important; }
  .stat-negative { color: #ef5350 !important; }
  .stat-accent { color: #42a5f5 !important; }

  /* Top bar dividers */
  .top-divider {
    width: 1px; height: 28px;
    background: rgba(100,180,255,0.12);
  }

  /* Speed Controls in top bar */
  .speed-group { display: flex; gap: 3px; align-items: center; }
  .sp-btn {
    pointer-events: auto;
    background: rgba(30, 40, 65, 0.8);
    border: 1px solid rgba(100,180,255,0.12);
    border-radius: 6px; color: #8899b0;
    padding: 4px 10px; cursor: pointer; font-size: 12px;
    transition: all 0.12s ease;
    font-weight: 500;
  }
  .sp-btn:hover { background: rgba(40, 55, 90, 0.9); color: #c0d0e8; }
  .sp-btn.active {
    background: rgba(40, 80, 160, 0.6);
    border-color: rgba(66, 165, 245, 0.5);
    color: #42a5f5; font-weight: 600;
  }

  /* ===== Toolbar ===== */
  #toolbar {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 3px; align-items: stretch;
    background: rgba(8, 12, 28, 0.88);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(100,180,255,0.1);
    border-radius: 14px; padding: 5px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }
  .tb-btn {
    pointer-events: auto;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 10px; color: #8899b0;
    padding: 6px 12px; cursor: pointer;
    font-size: 11px; font-weight: 500;
    transition: all 0.15s ease;
    display: flex; flex-direction: column; align-items: center; gap: 1px;
    min-width: 58px;
  }
  .tb-btn:hover { background: rgba(40, 55, 90, 0.5); color: #c0d0e8; }
  .tb-btn.active {
    background: rgba(40, 70, 130, 0.6);
    border-color: rgba(66, 165, 245, 0.5);
    color: #fff;
    box-shadow: 0 0 12px rgba(66, 165, 245, 0.15);
  }
  .tb-btn .tb-icon { font-size: 16px; line-height: 1; }
  .tb-btn .tb-key { font-size: 9px; opacity: 0.4; }
  .tb-sep {
    width: 1px; margin: 4px 2px;
    background: rgba(100,180,255,0.1);
  }
  /* ===== Tool Group (expandable) ===== */
  .tb-group { position: relative; }
  .tb-group-btn {
    pointer-events: auto;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 10px; color: #8899b0;
    padding: 6px 12px; cursor: pointer;
    font-size: 11px; font-weight: 500;
    transition: all 0.15s ease;
    display: flex; flex-direction: column; align-items: center; gap: 1px;
    min-width: 58px;
  }
  .tb-group-btn:hover { background: rgba(40, 55, 90, 0.5); color: #c0d0e8; }
  .tb-group-btn.active {
    background: rgba(40, 70, 130, 0.6);
    border-color: rgba(66, 165, 245, 0.5);
    color: #fff;
    box-shadow: 0 0 12px rgba(66, 165, 245, 0.15);
  }
  .tb-group-btn .tb-icon { font-size: 16px; line-height: 1; }
  .tb-group-btn .tb-caret { font-size: 8px; opacity: 0.4; margin-top: 1px; }
  .tb-sub-panel {
    display: none; position: absolute; bottom: calc(100% + 8px); left: 50%;
    transform: translateX(-50%);
    background: rgba(8, 12, 28, 0.92);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(100,180,255,0.15);
    border-radius: 12px; padding: 5px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    flex-direction: row; gap: 3px; white-space: nowrap;
    z-index: 20;
    animation: subPanelIn 0.15s ease-out;
  }
  .tb-sub-panel.open { display: flex; }
  @keyframes subPanelIn {
    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .tb-action {
    pointer-events: auto;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 10px; color: #8899b0;
    padding: 6px 10px; cursor: pointer;
    font-size: 11px; font-weight: 500;
    transition: all 0.15s ease;
    display: flex; flex-direction: column; align-items: center; gap: 1px;
    min-width: 48px;
  }
  .tb-action:hover { background: rgba(40, 55, 90, 0.5); color: #c0d0e8; }
  .tb-action.panel-open {
    background: rgba(40, 70, 130, 0.5);
    border-color: rgba(66, 165, 245, 0.3);
    color: #42a5f5;
  }
  .tb-action .tb-icon { font-size: 16px; line-height: 1; }

  /* ===== RCI Bar (inside toolbar) ===== */
  #rci-bar {
    display: flex; gap: 3px; align-items: flex-end;
    padding: 2px 4px;
  }
  .rci-col { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .rci-meter {
    width: 16px; height: 36px;
    background: rgba(20, 30, 50, 0.6);
    border: 1px solid rgba(100,180,255,0.08);
    border-radius: 3px; overflow: hidden; position: relative;
  }
  .rci-fill {
    position: absolute; bottom: 0; width: 100%;
    transition: height 0.4s ease; border-radius: 2px;
  }
  .rci-label { font-size: 8px; color: #8899b0; font-weight: 600; letter-spacing: 0.5px; }

  /* ===== Notification ===== */
  #notification {
    position: absolute; top: 54px; left: 50%; transform: translateX(-50%);
    pointer-events: none;
    background: linear-gradient(135deg, rgba(25, 55, 120, 0.95), rgba(20, 45, 100, 0.95));
    border: 1px solid rgba(66, 165, 245, 0.4);
    border-radius: 10px; color: #e3f2fd;
    padding: 10px 20px; font-size: 13px; font-weight: 500;
    text-align: center; display: none;
    animation: notifSlide 0.3s ease-out;
    max-width: 420px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  }
  #notification.visible { display: block; }
  @keyframes notifSlide {
    from { transform: translateX(-50%) translateY(-16px); opacity: 0; }
    to { transform: translateX(-50%) translateY(0); opacity: 1; }
  }

  /* ===== Overlay Indicator ===== */
  #overlay-indicator {
    position: absolute; top: 46px; right: 12px;
    pointer-events: auto;
    display: none; align-items: center; gap: 8px;
    background: rgba(8, 12, 28, 0.88);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(100,180,255,0.15);
    border-radius: 8px; padding: 6px 10px 6px 14px;
    color: #b0c4de; font-size: 12px; font-weight: 500;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  }
  #overlay-indicator.visible { display: flex; }
  #overlay-indicator .oi-label { opacity: 0.6; }
  #overlay-indicator .oi-name { color: #e3f2fd; font-weight: 600; }
  #overlay-close {
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px; color: #8899b0; cursor: pointer;
    font-size: 11px; padding: 2px 8px; transition: all 0.15s;
  }
  #overlay-close:hover { background: rgba(239,83,80,0.3); color: #ef5350; border-color: rgba(239,83,80,0.4); }

  /* ===== Building Panel ===== */
  #building-panel {
    position: absolute; top: 56px; left: 12px;
    display: none; min-width: 200px;
  }
  #building-panel.visible { display: block; }
  #building-panel .bp-title {
    font-size: 14px; font-weight: 600; color: #e4eaf4; margin-bottom: 6px;
  }
  #building-panel .bp-row {
    font-size: 12px; color: #8899b0; margin: 3px 0;
    display: flex; justify-content: space-between;
  }
  #building-panel .bp-row span { color: #d0d8e8; font-weight: 500; }

  /* ===== Tax Slider (in Economy modal) ===== */
  .tax-row {
    display: flex; align-items: center; gap: 8px;
    margin-top: 6px; padding-top: 6px;
    border-top: 1px solid rgba(100,180,255,0.06);
  }
  .tax-row label { font-size: 11px; color: #8899b0; white-space: nowrap; }
  .tax-row input[type="range"] {
    flex: 1; cursor: pointer;
    accent-color: #42a5f5;
    height: 4px;
  }
  .tax-val { font-size: 13px; font-weight: 600; color: #42a5f5; min-width: 28px; text-align: right; }

  /* ===== Modal Panels ===== */
  .modal-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.35);
    pointer-events: auto; z-index: 50;
    display: none; align-items: center; justify-content: center;
    animation: modalFade 0.2s ease;
  }
  .modal-overlay.visible { display: flex; }
  @keyframes modalFade {
    from { opacity: 0; } to { opacity: 1; }
  }
  .modal-panel {
    background: rgba(12, 16, 32, 0.96);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(100,180,255,0.15);
    border-radius: 16px;
    color: #d0d8e8; padding: 0;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(100,180,255,0.06);
    min-width: 420px; max-width: 540px; width: 90vw;
    max-height: 80vh; overflow-y: auto;
    animation: modalSlide 0.25s ease;
  }
  @keyframes modalSlide {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid rgba(100,180,255,0.08);
    position: sticky; top: 0;
    background: rgba(12, 16, 32, 0.98);
    border-radius: 16px 16px 0 0;
  }
  .modal-title {
    font-size: 15px; font-weight: 600; color: #e4eaf4;
    display: flex; align-items: center; gap: 8px;
  }
  .modal-close {
    pointer-events: auto;
    background: rgba(255,255,255,0.06); border: none;
    border-radius: 8px; color: #8899b0;
    width: 32px; height: 32px; cursor: pointer;
    font-size: 16px; display: flex; align-items: center; justify-content: center;
    transition: all 0.12s;
  }
  .modal-close:hover { background: rgba(239,83,80,0.2); color: #ef5350; }
  .modal-body { padding: 16px 20px; }

  /* Summary Cards */
  .summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px; margin-bottom: 16px;
  }
  .summary-card {
    background: rgba(20, 30, 55, 0.6);
    border: 1px solid rgba(100,180,255,0.06);
    border-radius: 10px; padding: 10px 12px;
    text-align: center;
  }
  .summary-card .sc-value {
    font-size: 18px; font-weight: 700; color: #e4eaf4;
    font-variant-numeric: tabular-nums;
  }
  .summary-card .sc-label {
    font-size: 10px; color: #667a90; margin-top: 2px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }

  /* Data Table */
  .data-table {
    width: 100%; border-collapse: collapse; margin-bottom: 12px;
  }
  .data-table th {
    font-size: 10px; color: #667a90; text-transform: uppercase;
    letter-spacing: 0.5px; padding: 6px 8px; text-align: left;
    border-bottom: 1px solid rgba(100,180,255,0.06);
    font-weight: 600;
  }
  .data-table td {
    font-size: 12px; padding: 6px 8px;
    border-bottom: 1px solid rgba(100,180,255,0.03);
    font-variant-numeric: tabular-nums;
  }
  .data-table tr:hover td { background: rgba(40, 55, 90, 0.15); }
  .td-label { color: #8899b0; }
  .td-income { color: #66bb6a; font-weight: 500; }
  .td-expense { color: #ef5350; font-weight: 500; }
  .td-value { color: #d0d8e8; font-weight: 500; }

  /* Chart canvas in modal */
  .modal-chart {
    width: 100%; height: 100px; border-radius: 8px;
    background: rgba(0,0,0,0.2); margin: 8px 0 12px;
  }

  /* Section Title */
  .section-title {
    font-size: 11px; font-weight: 600; color: rgba(120,180,255,0.6);
    text-transform: uppercase; letter-spacing: 1px;
    margin: 12px 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid rgba(100,180,255,0.06);
  }

  /* Loan Controls */
  .loan-row {
    display: flex; gap: 8px; align-items: center; margin-top: 8px;
  }
  .loan-btn {
    pointer-events: auto;
    background: rgba(30, 50, 85, 0.7);
    border: 1px solid rgba(100,180,255,0.15);
    border-radius: 8px; color: #b0c0d8;
    padding: 6px 14px; cursor: pointer;
    font-size: 12px; font-weight: 500;
    transition: all 0.12s;
  }
  .loan-btn:hover { background: rgba(40, 65, 115, 0.8); color: #e4eaf4; }

  /* Congestion Bar */
  .cong-bar-bg {
    width: 100%; height: 6px; background: rgba(255,255,255,0.05);
    border-radius: 3px; overflow: hidden;
  }
  .cong-bar-fill {
    height: 100%; border-radius: 3px;
    transition: width 0.3s;
  }

  /* Overlay Quick Buttons */
  .overlay-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .ov-btn {
    pointer-events: auto;
    background: rgba(30, 40, 65, 0.7);
    border: 1px solid rgba(100,180,255,0.1);
    border-radius: 6px; color: #8899b0;
    padding: 4px 10px; cursor: pointer;
    font-size: 11px; transition: all 0.12s;
  }
  .ov-btn:hover { background: rgba(40, 55, 90, 0.8); color: #c0d0e8; }
  .ov-btn.active { background: rgba(66, 165, 245, 0.25); border-color: rgba(66, 165, 245, 0.6); color: #90caf9; }

  /* Mute button */
  #mute-btn {
    pointer-events: auto;
    background: rgba(30, 40, 65, 0.8);
    border: 1px solid rgba(100,180,255,0.12);
    border-radius: 6px; color: #8899b0;
    padding: 4px 8px; cursor: pointer; font-size: 14px;
    transition: all 0.12s;
  }
  #mute-btn:hover { color: #c0d0e8; }
  #mute-btn.muted { color: #ef5350; }

`;

export function createGameUI(game: Game): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'game-ui';
  ui.innerHTML = `
    <style>${STYLES}</style>

    <div id="notification"></div>

    <!-- Top Bar -->
    <div id="top-bar">
      <div class="top-section">
        <div class="top-stat">
          <span class="stat-label">Date</span>
          <span class="stat-value" id="info-date">Day 1</span>
        </div>
        <div class="top-divider"></div>
        <div class="top-stat">
          <span class="stat-label">Funds</span>
          <span class="stat-value" id="info-funds">$50,000</span>
        </div>
        <div class="top-divider"></div>
        <div class="top-stat">
          <span class="stat-label">Population</span>
          <span class="stat-value stat-accent" id="info-pop">0</span>
        </div>
        <div class="top-divider"></div>
        <div class="top-stat">
          <span class="stat-label">Balance</span>
          <span class="stat-value" id="info-balance">$0/tick</span>
        </div>
        <div class="top-divider"></div>
        <div class="top-stat">
          <span class="stat-label">Happiness</span>
          <span class="stat-value" id="info-happy">--</span>
        </div>
        <div class="top-divider"></div>
        <div class="top-stat">
          <span class="stat-label">Tool</span>
          <span class="stat-value" id="info-tool" style="font-size:12px">select</span>
        </div>
      </div>
      <div class="top-section">
        <div class="speed-group">
          <button class="sp-btn" data-speed="pause">II</button>
          <button class="sp-btn active" data-speed="1">1x</button>
          <button class="sp-btn" data-speed="2">2x</button>
          <button class="sp-btn" data-speed="3">3x</button>
        </div>
        <button id="mute-btn" title="Toggle Sound">&#128266;</button>
      </div>
    </div>


    <!-- Toolbar -->
    <div id="toolbar">
      <button class="tb-btn" data-tool="select">
        <span class="tb-icon">\u{1F5B1}</span>
        <span style="color:#b0bec5">Select</span>
        <span class="tb-key">1</span>
      </button>

      <div class="tb-group" data-group="zone">
        <button class="tb-group-btn" data-group-toggle="zone">
          <span class="tb-icon">${ZONE_GROUP.icon}</span>
          <span style="color:${ZONE_GROUP.color}">${ZONE_GROUP.label}</span>
          <span class="tb-caret">\u25B2</span>
        </button>
        <div class="tb-sub-panel" data-sub="zone">
          ${ZONE_GROUP.items.map(b => `
            <button class="tb-btn" data-tool="${b.tool}">
              <span class="tb-icon">${b.icon}</span>
              <span style="color:${b.color}">${b.label}</span>
              <span class="tb-key">${b.key}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="tb-group" data-group="infra">
        <button class="tb-group-btn" data-group-toggle="infra">
          <span class="tb-icon">${INFRA_GROUP.icon}</span>
          <span style="color:${INFRA_GROUP.color}">${INFRA_GROUP.label}</span>
          <span class="tb-caret">\u25B2</span>
        </button>
        <div class="tb-sub-panel" data-sub="infra">
          ${INFRA_GROUP.items.map(b => `
            <button class="tb-btn" data-tool="${b.tool}">
              <span class="tb-icon">${b.icon}</span>
              <span style="color:${b.color}">${b.label}</span>
              <span class="tb-key">${b.key}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <button class="tb-btn" data-tool="demolish">
        <span class="tb-icon">\u{1F4A5}</span>
        <span style="color:#ef5350">Demolish</span>
        <span class="tb-key">0</span>
      </button>

      <div class="tb-sep"></div>
      <div id="rci-bar">
        <div class="rci-col">
          <div class="rci-meter"><div class="rci-fill" id="rci-r" style="background:#66bb6a;height:50%"></div></div>
          <div class="rci-label">R</div>
        </div>
        <div class="rci-col">
          <div class="rci-meter"><div class="rci-fill" id="rci-c" style="background:#42a5f5;height:50%"></div></div>
          <div class="rci-label">C</div>
        </div>
        <div class="rci-col">
          <div class="rci-meter"><div class="rci-fill" id="rci-i" style="background:#ffa726;height:50%"></div></div>
          <div class="rci-label">I</div>
        </div>
      </div>
      <div class="tb-sep"></div>
      <button class="tb-action" id="btn-overview" title="City Overview">
        <span class="tb-icon">\u{1F3D9}</span>
        <span>Overview</span>
      </button>
      <button class="tb-action" id="btn-economy" title="Economy Panel">
        <span class="tb-icon">$</span>
        <span>Economy</span>
      </button>
      <button class="tb-action" id="btn-traffic" title="Traffic Panel">
        <span class="tb-icon">\u{1F697}</span>
        <span>Traffic</span>
      </button>
    </div>

    <!-- Overlay Indicator -->
    <div id="overlay-indicator">
      <span class="oi-label">Overlay:</span>
      <span class="oi-name" id="oi-name"></span>
      <button id="overlay-close">Close</button>
    </div>

    <!-- Building Panel -->
    <div id="building-panel" class="g-panel">
      <div class="bp-title" id="bp-name"></div>
      <div class="bp-row">Level <span id="bp-level"></span></div>
      <div class="bp-row" id="bp-residents-row">Residents <span id="bp-residents"></span></div>
      <div class="bp-row" id="bp-workers-row">Workers <span id="bp-workers"></span></div>
      <div class="bp-row">Tax <span id="bp-tax"></span></div>
      <div class="bp-row">Zone <span id="bp-zone"></span></div>
    </div>

    <!-- Economy Modal -->
    <div class="modal-overlay" id="economy-modal">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">$ Economy Overview</div>
          <button class="modal-close" data-close="economy-modal">&times;</button>
        </div>
        <div class="modal-body" id="economy-body"></div>
      </div>
    </div>

    <!-- Traffic Modal -->
    <div class="modal-overlay" id="traffic-modal">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">\u{1F697} Traffic Overview</div>
          <button class="modal-close" data-close="traffic-modal">&times;</button>
        </div>
        <div class="modal-body" id="traffic-body"></div>
      </div>
    </div>

    <!-- Overview Modal -->
    <div class="modal-overlay" id="overview-modal">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">\u{1F3D9} City Overview</div>
          <button class="modal-close" data-close="overview-modal">&times;</button>
        </div>
        <div class="modal-body" id="overview-body"></div>
      </div>
    </div>
  `;

  // ===== Event Handlers =====

  // Track which group sub-panel is open
  let openGroup: string | null = null;

  function closeAllSubPanels(): void {
    ui.querySelectorAll('.tb-sub-panel').forEach(p => p.classList.remove('open'));
    ui.querySelectorAll('.tb-group-btn').forEach(b => b.classList.remove('active'));
    openGroup = null;
  }

  // Group toggle buttons (Zone, Infra)
  ui.querySelectorAll('.tb-group-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = (btn as HTMLElement).dataset['groupToggle'];
      if (!group) return;
      if (openGroup === group) {
        closeAllSubPanels();
      } else {
        closeAllSubPanels();
        const panel = ui.querySelector(`.tb-sub-panel[data-sub="${group}"]`);
        if (panel) panel.classList.add('open');
        btn.classList.add('active');
        openGroup = group;
      }
    });
  });

  // Tool buttons (both standalone and inside sub-panels)
  ui.querySelectorAll('.tb-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tool = (btn as HTMLElement).dataset['tool'] as ToolType;
      game.setTool(tool);
      // Keep sub-panel open if the selected tool belongs to the open group
      const parentGroup = (btn as HTMLElement).closest('.tb-group');
      if (!parentGroup) {
        // Standalone tool (Select/Demolish) — close all panels
        closeAllSubPanels();
      }
      updateUI();
    });
  });

  // Overlay close button
  const overlayCloseBtn = ui.querySelector('#overlay-close');
  if (overlayCloseBtn) {
    overlayCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      game.setOverlay('none');
      updateUI();
    });
  }

  // Speed buttons
  ui.querySelectorAll('.sp-btn').forEach(btn => {
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

  // Tax slider is now inside Economy modal (bound dynamically in updateEconomyPanel)

  // Modal close buttons
  ui.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = (btn as HTMLElement).dataset['close'];
      if (modalId) {
        const modal = ui.querySelector(`#${modalId}`) as HTMLElement;
        if (modal) modal.classList.remove('visible');
        // Remove panel-open state from action buttons
        ui.querySelector('#btn-overview')?.classList.remove('panel-open');
        ui.querySelector('#btn-economy')?.classList.remove('panel-open');
        ui.querySelector('#btn-traffic')?.classList.remove('panel-open');
      }
    });
  });

  // Close modals on overlay click
  ui.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        ui.querySelector('#btn-overview')?.classList.remove('panel-open');
        ui.querySelector('#btn-economy')?.classList.remove('panel-open');
        ui.querySelector('#btn-traffic')?.classList.remove('panel-open');
      }
    });
  });

  // Overview panel button
  const btnOverview = ui.querySelector('#btn-overview');
  if (btnOverview) {
    btnOverview.addEventListener('click', () => {
      const modal = ui.querySelector('#overview-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnOverview.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateOverviewPanel();
    });
  }

  // Economy panel button
  const btnEconomy = ui.querySelector('#btn-economy');
  if (btnEconomy) {
    btnEconomy.addEventListener('click', () => {
      const modal = ui.querySelector('#economy-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnEconomy.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateEconomyPanel();
    });
  }

  // Traffic panel button
  const btnTraffic = ui.querySelector('#btn-traffic');
  if (btnTraffic) {
    btnTraffic.addEventListener('click', () => {
      const modal = ui.querySelector('#traffic-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnTraffic.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateTrafficPanel();
    });
  }

  // ===== Chart History =====
  const chartHistory = { pop: [] as number[], happiness: [] as number[] };
  const CHART_MAX = 60;

  // Economy chart history
  const econHistory = { funds: [] as number[], income: [] as number[], expenses: [] as number[] };
  const ECON_MAX = 60;

  // ===== Zone Names =====
  const ZONE_NAMES: Record<number, string> = {
    [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
    [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
    [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
    [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
    [ZoneType.INDUSTRIAL]: 'Industrial',
    [ZoneType.OFFICE]: 'Office',
  };

  // ===== Building Panel =====
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
    if (taxEl) taxEl.textContent = `$${bt.taxRevenue}/tick`;
    if (zoneEl) zoneEl.textContent = ZONE_NAMES[selected.zoneType] ?? 'Unknown';
  }

  // ===== Overview Panel Content =====
  const ZONE_ORDER = [
    ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
    ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
    ZoneType.INDUSTRIAL, ZoneType.OFFICE,
  ] as const;
  const ZONE_LABELS: Record<number, string> = {
    [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
    [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
    [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
    [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
    [ZoneType.INDUSTRIAL]: 'Industrial',
    [ZoneType.OFFICE]: 'Office',
  };
  const CHECK_LABELS = ['Attractiveness > 50', 'Vacant Homes > 0', 'Job Openings > 0'];
  let overviewBuilt = false;

  function buildOverviewDOM(body: HTMLElement): void {
    const capLabel = (zt: number) => zt <= ZoneType.RESIDENTIAL_HIGH ? 'Residents' : 'Workers';
    body.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card"><div class="sc-value stat-accent" id="ov-pop">0</div><div class="sc-label">Population</div></div>
        <div class="summary-card"><div class="sc-value" id="ov-vacant">0</div><div class="sc-label">Vacant Homes</div></div>
        <div class="summary-card"><div class="sc-value" id="ov-jobs">0</div><div class="sc-label">Total Jobs</div></div>
        <div class="summary-card"><div class="sc-value" id="ov-openings">0</div><div class="sc-label">Job Openings</div></div>
      </div>
      <div class="section-title">Buildings by Zone</div>
      <table class="data-table">
        <tr><th>Zone</th><th style="text-align:right">Buildings</th><th style="text-align:right">Capacity</th></tr>
        ${ZONE_ORDER.map(zt => `<tr>
          <td class="td-label">${ZONE_LABELS[zt]}</td>
          <td class="td-value" style="text-align:right" id="ov-zc-${zt}">0</td>
          <td class="td-value" style="text-align:right" id="ov-zcap-${zt}">0 ${capLabel(zt)}</td>
        </tr>`).join('')}
        <tr style="border-top:1px solid rgba(100,120,150,0.3)">
          <td class="td-label" style="font-weight:600">Total Housing</td><td></td>
          <td class="td-value" style="text-align:right;font-weight:600" id="ov-total-homes">0</td>
        </tr>
        <tr>
          <td class="td-label" style="font-weight:600">Total Jobs</td><td></td>
          <td class="td-value" style="text-align:right;font-weight:600" id="ov-total-jobs">0</td>
        </tr>
      </table>
      <div class="section-title">Migration Status</div>
      <table class="data-table">
        <tr><th>Condition</th><th style="text-align:right">Value</th><th style="text-align:center">Status</th></tr>
        ${CHECK_LABELS.map((label, i) => `<tr>
          <td class="td-label">${label}</td>
          <td class="td-value" style="text-align:right" id="ov-chk-val-${i}">0</td>
          <td style="text-align:center" id="ov-chk-icon-${i}">\u2717</td>
        </tr>`).join('')}
      </table>
      <div id="ov-migrate-status" style="margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:600"></div>
    `;
    overviewBuilt = true;
  }

  // Cache previous values to skip unchanged DOM writes
  const ovCache: Record<string, string> = {};
  function ovSet(id: string, text: string): void {
    if (ovCache[id] === text) return;
    ovCache[id] = text;
    const el = ui.querySelector(`#${id}`);
    if (el) el.textContent = text;
  }
  function ovSetStyle(id: string, prop: string, value: string): void {
    const cacheKey = `${id}__${prop}`;
    if (ovCache[cacheKey] === value) return;
    ovCache[cacheKey] = value;
    const el = ui.querySelector(`#${id}`) as HTMLElement | null;
    if (el) (el.style as any)[prop] = value;
  }

  function updateOverviewPanel(): void {
    const body = ui.querySelector('#overview-body') as HTMLElement;
    if (!body) return;
    if (!overviewBuilt) buildOverviewDOM(body);

    const state = game.getState();
    const grid = state.grid;
    const population = state.citizens.getPopulation();

    // Count buildings and capacity/jobs by zone type
    const zoneCounts: Record<number, { count: number; capacity: number }> = {};
    for (const zt of ZONE_ORDER) zoneCounts[zt] = { count: 0, capacity: 0 };

    let totalPollution = 0;
    let pollutionCount = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.buildingId > 0 || cell.zoneType > 0) {
          totalPollution += cell.pollution;
          pollutionCount++;
        }
        if (cell.buildingId <= 0 || cell.zoneType === ZoneType.NONE) continue;
        const entry = zoneCounts[cell.zoneType];
        if (!entry) continue;
        entry.count++;
        const bt = getBuildingType(cell.buildingId);
        if (bt) entry.capacity += bt.residents + bt.workers;
      }
    }
    const avgPollution = pollutionCount > 0 ? totalPollution / pollutionCount : 0;

    const totalHomes = (zoneCounts[ZoneType.RESIDENTIAL_LOW]?.capacity ?? 0) +
      (zoneCounts[ZoneType.RESIDENTIAL_HIGH]?.capacity ?? 0);
    const totalJobs = (zoneCounts[ZoneType.COMMERCIAL_LOW]?.capacity ?? 0) +
      (zoneCounts[ZoneType.COMMERCIAL_HIGH]?.capacity ?? 0) +
      (zoneCounts[ZoneType.INDUSTRIAL]?.capacity ?? 0) +
      (zoneCounts[ZoneType.OFFICE]?.capacity ?? 0);
    const vacantHomes = Math.max(0, totalHomes - population);
    const jobOpenings = Math.max(0, totalJobs - population);

    // Summary cards
    ovSet('ov-pop', String(population));
    ovSet('ov-vacant', String(vacantHomes));
    ovSet('ov-jobs', String(totalJobs));
    ovSet('ov-openings', String(jobOpenings));

    // Zone table
    const capLabel = (zt: number) => zt <= ZoneType.RESIDENTIAL_HIGH ? 'Residents' : 'Workers';
    for (const zt of ZONE_ORDER) {
      const e = zoneCounts[zt]!;
      ovSet(`ov-zc-${zt}`, String(e.count));
      ovSet(`ov-zcap-${zt}`, `${e.capacity} ${capLabel(zt)}`);
    }
    ovSet('ov-total-homes', String(totalHomes));
    ovSet('ov-total-jobs', String(totalJobs));

    // Migration diagnostics
    const avgHappiness = population > 0
      ? Math.round(state.citizens.citizens.reduce((s: number, c: { happiness: number }) => s + c.happiness, 0) / population)
      : 70;
    const taxRate = state.taxRates.residential ?? 9;
    const attractiveness = calculateAttractiveness({
      jobOpenings, vacantHomes, avgHappiness, taxRate,
      pollution: avgPollution, crimeRate: Math.min(50, population * 0.02),
    });
    const canMigrate = attractiveness > 50 && vacantHomes > 0 && jobOpenings > 0;

    const checkValues = [attractiveness.toFixed(1), String(vacantHomes), String(jobOpenings)];
    const checkOk = [attractiveness > 50, vacantHomes > 0, jobOpenings > 0];
    for (let i = 0; i < 3; i++) {
      ovSet(`ov-chk-val-${i}`, checkValues[i]!);
      ovSet(`ov-chk-icon-${i}`, checkOk[i] ? '\u2713' : '\u2717');
      ovSetStyle(`ov-chk-icon-${i}`, 'color', checkOk[i] ? '#66bb6a' : '#ef5350');
    }

    // Migration status banner
    const statusEl = ui.querySelector('#ov-migrate-status') as HTMLElement | null;
    if (statusEl) {
      const newText = canMigrate
        ? '\u2713 Citizens can migrate in'
        : '\u2717 Migration blocked \u2014 fix conditions marked \u2717 above';
      if (ovCache['migrate-text'] !== newText) {
        ovCache['migrate-text'] = newText;
        statusEl.textContent = newText;
        statusEl.style.background = canMigrate ? 'rgba(102,187,106,0.15)' : 'rgba(239,83,80,0.15)';
        statusEl.style.color = canMigrate ? '#66bb6a' : '#ef5350';
      }
    }
  }

  // ===== Economy Panel Content =====
  function updateEconomyPanel(): void {
    const body = ui.querySelector('#economy-body') as HTMLElement;
    if (!body) return;

    const state = game.getState();
    const breakdown = game.getEconomyBreakdown();
    const totalIncome = breakdown.residential + breakdown.commercial + breakdown.industrial + breakdown.office;
    const totalExpenses = breakdown.roadMaintenance + breakdown.loanInterest + breakdown.powerCost + breakdown.waterCost;
    const balance = totalIncome - totalExpenses;

    body.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="sc-value">$${Math.floor(state.budget.funds).toLocaleString()}</div>
          <div class="sc-label">Treasury</div>
        </div>
        <div class="summary-card">
          <div class="sc-value stat-positive">+$${totalIncome.toFixed(1)}</div>
          <div class="sc-label">Income/tick</div>
        </div>
        <div class="summary-card">
          <div class="sc-value stat-negative">-$${totalExpenses.toFixed(1)}</div>
          <div class="sc-label">Expenses/tick</div>
        </div>
        <div class="summary-card">
          <div class="sc-value ${balance >= 0 ? 'stat-positive' : 'stat-negative'}">$${balance.toFixed(1)}</div>
          <div class="sc-label">Net Balance</div>
        </div>
      </div>

      <div class="section-title">Income Breakdown</div>
      <table class="data-table">
        <tr><th>Source</th><th>Rate</th><th style="text-align:right">Amount</th></tr>
        <tr><td class="td-label">Residential Tax</td><td class="td-value">${state.taxRates.residential}%</td><td class="td-income" style="text-align:right">+$${breakdown.residential.toFixed(1)}</td></tr>
        <tr><td class="td-label">Commercial Tax</td><td class="td-value">${state.taxRates.commercial}%</td><td class="td-income" style="text-align:right">+$${breakdown.commercial.toFixed(1)}</td></tr>
        <tr><td class="td-label">Industrial Tax</td><td class="td-value">${state.taxRates.industrial}%</td><td class="td-income" style="text-align:right">+$${breakdown.industrial.toFixed(1)}</td></tr>
        <tr><td class="td-label">Office Tax</td><td class="td-value">${state.taxRates.office}%</td><td class="td-income" style="text-align:right">+$${breakdown.office.toFixed(1)}</td></tr>
      </table>

      <div class="section-title">Expenses Breakdown</div>
      <table class="data-table">
        <tr><th>Category</th><th style="text-align:right">Amount</th></tr>
        <tr><td class="td-label">Road Maintenance</td><td class="td-expense" style="text-align:right">-$${breakdown.roadMaintenance.toFixed(1)}</td></tr>
        <tr><td class="td-label">Power Plants</td><td class="td-expense" style="text-align:right">-$${breakdown.powerCost}</td></tr>
        <tr><td class="td-label">Water Plants</td><td class="td-expense" style="text-align:right">-$${breakdown.waterCost}</td></tr>
        <tr><td class="td-label">Loan Interest (${(state.budget.loanInterestRate * 100).toFixed(0)}%)</td><td class="td-expense" style="text-align:right">-$${breakdown.loanInterest.toFixed(1)}</td></tr>
      </table>

      <div class="section-title">Tax Rate</div>
      <div class="tax-row">
        <label>All Zones</label>
        <input type="range" id="tax-slider" min="1" max="20" step="1" value="${state.taxRates.residential}">
        <span class="tax-val" id="tax-display">${state.taxRates.residential}%</span>
      </div>

      <div class="section-title">City Statistics</div>
      <canvas class="modal-chart" id="pop-chart" width="480" height="80"></canvas>

      <div class="section-title">Economic History</div>
      <canvas class="modal-chart" id="econ-chart" width="480" height="100"></canvas>

      <div class="section-title">Loans</div>
      <div style="font-size:12px;color:#8899b0;margin-bottom:8px">
        Outstanding: <span style="color:#e4eaf4;font-weight:600">$${state.budget.loans.toLocaleString()}</span>
      </div>
      <div class="loan-row">
        <button class="loan-btn" id="loan-take-5k">Borrow $5,000</button>
        <button class="loan-btn" id="loan-take-10k">Borrow $10,000</button>
        <button class="loan-btn" id="loan-repay">Repay $5,000</button>
      </div>
    `;

    // Draw charts
    drawEconChart();
    drawPopChart();

    // Tax slider
    const taxSlider = body.querySelector('#tax-slider') as HTMLInputElement;
    const taxDisplay = body.querySelector('#tax-display') as HTMLElement;
    if (taxSlider) {
      taxSlider.addEventListener('input', () => {
        const rate = parseInt(taxSlider.value, 10);
        const taxes = game.getState().taxRates;
        taxes.residential = rate;
        taxes.commercial = rate;
        taxes.industrial = rate;
        taxes.office = rate;
        if (taxDisplay) taxDisplay.textContent = `${rate}%`;
      });
    }

    // Loan buttons
    body.querySelector('#loan-take-5k')?.addEventListener('click', () => { game.takeLoan(5000); updateEconomyPanel(); });
    body.querySelector('#loan-take-10k')?.addEventListener('click', () => { game.takeLoan(10000); updateEconomyPanel(); });
    body.querySelector('#loan-repay')?.addEventListener('click', () => { game.repayLoan(5000); updateEconomyPanel(); });
  }

  function drawEconChart(): void {
    const canvas = ui.querySelector('#econ-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (econHistory.funds.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    // Draw funds line
    const maxFunds = Math.max(1000, ...econHistory.funds);
    const minFunds = Math.min(0, ...econHistory.funds);
    const range = maxFunds - minFunds || 1;

    ctx.strokeStyle = '#42a5f5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < econHistory.funds.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - ((econHistory.funds[i]! - minFunds) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw income line (green)
    const maxInc = Math.max(1, ...econHistory.income, ...econHistory.expenses);
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < econHistory.income.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - (econHistory.income[i]! / maxInc) * (h / 3) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw expense line (red)
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < econHistory.expenses.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - (econHistory.expenses[i]! / maxInc) * (h / 3) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#42a5f5';
    ctx.fillText('Funds', 4, 10);
    ctx.fillStyle = '#66bb6a';
    ctx.fillText('Income', 50, 10);
    ctx.fillStyle = '#ef5350';
    ctx.fillText('Expenses', 100, 10);
  }

  // ===== Traffic Panel Content =====
  function updateTrafficPanel(): void {
    const body = ui.querySelector('#traffic-body') as HTMLElement;
    if (!body) return;

    const stats = game.getTrafficStats();
    const maxDensity = stats.topCongested.length > 0 ? stats.topCongested[0]!.density : 1;

    body.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="sc-value">${stats.vehicleCount}</div>
          <div class="sc-label">Active Vehicles</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">${stats.avgPathLength}</div>
          <div class="sc-label">Avg Path Length</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">${stats.totalRoads}</div>
          <div class="sc-label">Road Tiles</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">${stats.topCongested.length > 0 ? stats.topCongested[0]!.density : 0}</div>
          <div class="sc-label">Peak Density</div>
        </div>
      </div>

      <div class="section-title">Top Congested Segments</div>
      ${stats.topCongested.length === 0 ? '<div style="font-size:12px;color:#667a90;padding:8px 0">No traffic data yet</div>' :
        `<table class="data-table">
          <tr><th>Location</th><th>Vehicles</th><th>Congestion</th></tr>
          ${stats.topCongested.map(seg => {
            const pct = Math.round((seg.density / maxDensity) * 100);
            const color = pct > 75 ? '#ef5350' : pct > 40 ? '#ffa726' : '#66bb6a';
            return `<tr>
              <td class="td-label">(${seg.segment})</td>
              <td class="td-value">${seg.density}</td>
              <td><div class="cong-bar-bg"><div class="cong-bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
            </tr>`;
          }).join('')}
        </table>`
      }

      <div class="section-title">Overlay Shortcuts</div>
      <div class="overlay-btns">
        <button class="ov-btn" data-overlay="traffic">Traffic [F5]</button>
        <button class="ov-btn" data-overlay="power">Power [F1]</button>
        <button class="ov-btn" data-overlay="water">Water [F2]</button>
        <button class="ov-btn" data-overlay="pollution">Pollution [F3]</button>
        <button class="ov-btn" data-overlay="landValue">Land Value [F4]</button>
        <button class="ov-btn" data-overlay="zone">Zones [F6]</button>
      </div>
    `;

    // Overlay shortcut buttons — use toggleOverlay so clicking again turns it off
    const ovBtns = body.querySelectorAll('.ov-btn');
    ovBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = (btn as HTMLElement).dataset['overlay'];
        if (overlay) {
          game.toggleOverlay(overlay as Parameters<typeof game.toggleOverlay>[0]);
          // Update active state on all overlay buttons
          ovBtns.forEach(b => b.classList.remove('active'));
          const current = (game as any).overlayRenderer?.getOverlay?.();
          if (current && current !== 'none') {
            const activeBtn = body.querySelector(`.ov-btn[data-overlay="${current}"]`);
            if (activeBtn) activeBtn.classList.add('active');
          }
        }
      });
    });
  }

  function drawPopChart(): void {
    const canvas = ui.querySelector('#pop-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (chartHistory.pop.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    // Population line (green)
    const maxPop = Math.max(10, ...chartHistory.pop);
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < chartHistory.pop.length; i++) {
      const x = (i / (CHART_MAX - 1)) * w;
      const y = h - (chartHistory.pop[i]! / maxPop) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Happiness line (yellow)
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < chartHistory.happiness.length; i++) {
      const x = (i / (CHART_MAX - 1)) * w;
      const y = h - (chartHistory.happiness[i]! / 100) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#66bb6a';
    const pop = chartHistory.pop[chartHistory.pop.length - 1] ?? 0;
    ctx.fillText(`Pop: ${pop}`, 4, 10);
    ctx.fillStyle = '#ffd54f';
    const happy = chartHistory.happiness[chartHistory.happiness.length - 1] ?? 0;
    ctx.fillText(`Happy: ${happy}%`, 80, 10);
  }

  // ===== Main UI Update =====
  function updateUI(): void {
    const state = game.getState();
    const clock = state.clock;

    // Date
    const dateEl = ui.querySelector('#info-date');
    if (dateEl) dateEl.textContent = `Y${clock.getYear() + 1} M${(clock.getMonth() % 12) + 1} D${(clock.getDay() % 30) + 1}`;

    // Funds
    const fundsEl = ui.querySelector('#info-funds');
    if (fundsEl) fundsEl.textContent = `$${Math.floor(state.budget.funds).toLocaleString()}`;

    // Population
    const popEl = ui.querySelector('#info-pop');
    if (popEl) popEl.textContent = String(state.citizens.getPopulation());

    // Balance
    const balanceEl = ui.querySelector('#info-balance');
    if (balanceEl) {
      const bal = Math.floor(state.budget.income - state.budget.expenses);
      balanceEl.textContent = `${bal >= 0 ? '+' : ''}$${bal}/tick`;
      balanceEl.className = `stat-value ${bal >= 0 ? 'stat-positive' : 'stat-negative'}`;
    }

    // Happiness
    const happyEl = ui.querySelector('#info-happy');
    if (happyEl) {
      const citizens = state.citizens.citizens;
      if (citizens.length > 0) {
        const avg = Math.round(citizens.reduce((s: number, c: { happiness: number }) => s + c.happiness, 0) / citizens.length);
        happyEl.textContent = `${avg}%`;
      } else {
        happyEl.textContent = '--';
      }
    }

    // Active tool button (standalone + sub-panel items)
    const currentTool = game.getToolType();

    // Tool display (top bar)
    const toolEl = ui.querySelector('#info-tool');
    if (toolEl) {
      const costStr = game.previewCost != null ? ` $${game.previewCost}` : '';
      toolEl.textContent = `${currentTool}${costStr}`;
    }

    ui.querySelectorAll('.tb-btn').forEach(btn => {
      const tool = (btn as HTMLElement).dataset['tool'];
      btn.classList.toggle('active', tool === currentTool);
    });
    // Highlight parent group button if a child tool is active
    const zoneTools = new Set(ZONE_GROUP.items.map(i => i.tool));
    const infraTools = new Set(INFRA_GROUP.items.map(i => i.tool));
    const zoneGroupBtn = ui.querySelector('[data-group-toggle="zone"]');
    const infraGroupBtn = ui.querySelector('[data-group-toggle="infra"]');
    if (zoneGroupBtn) zoneGroupBtn.classList.toggle('active', zoneTools.has(currentTool));
    if (infraGroupBtn) infraGroupBtn.classList.toggle('active', infraTools.has(currentTool));

    // Overlay indicator
    const overlayIndicator = ui.querySelector('#overlay-indicator') as HTMLElement;
    const overlayName = ui.querySelector('#oi-name') as HTMLElement;
    if (overlayIndicator && overlayName) {
      const ov = (game as any).overlayRenderer?.getOverlay?.() as string | undefined;
      if (ov && ov !== 'none') {
        const names: Record<string, string> = {
          power: 'Power', water: 'Water', zone: 'Zones',
          traffic: 'Traffic', pollution: 'Pollution', landValue: 'Land Value',
        };
        overlayName.textContent = names[ov] ?? ov;
        overlayIndicator.classList.add('visible');
      } else {
        overlayIndicator.classList.remove('visible');
      }
    }

    // Speed buttons
    ui.querySelectorAll('.sp-btn').forEach(btn => {
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

    // Collect history data for charts
    const pop = state.citizens.getPopulation();
    const citizens2 = state.citizens.citizens;
    const avgH = citizens2.length > 0 ? Math.round(citizens2.reduce((s: number, c: { happiness: number }) => s + c.happiness, 0) / citizens2.length) : 50;
    chartHistory.pop.push(pop);
    chartHistory.happiness.push(avgH);
    if (chartHistory.pop.length > CHART_MAX) { chartHistory.pop.shift(); chartHistory.happiness.shift(); }

    // Economy history
    econHistory.funds.push(state.budget.funds);
    econHistory.income.push(state.budget.income);
    econHistory.expenses.push(state.budget.expenses);
    if (econHistory.funds.length > ECON_MAX) { econHistory.funds.shift(); econHistory.income.shift(); econHistory.expenses.shift(); }

    // Only update canvas charts if modals are open (no innerHTML rebuild)
    if (ui.querySelector('#economy-modal')?.classList.contains('visible')) {
      drawEconChart();
      drawPopChart();
    }

    // Auto-refresh overview panel when open
    if (ui.querySelector('#overview-modal')?.classList.contains('visible')) {
      updateOverviewPanel();
    }
  }

  game.setOnUIUpdate(updateUI);
  updateUI();

  return ui;
}
