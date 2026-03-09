import { Game, type ToolType, type SelectedBuilding } from '../Game';
import { ZoneType } from '../core/grid/types';
import { RoadType, ROAD_CONFIGS } from '../core/road/types';
import { getBuildingType, BUILDING_TYPES } from '../core/building/types';
import { calculateAttractiveness } from '../core/citizen/Migration';
import { CitySpecType } from '../core/district/CitySpecialization';
import { DebugTools } from '../core/simulation/DebugTools';
import { Tutorial } from '../core/tutorial/Tutorial';

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

const ROAD_GROUP: ToolGroup = {
  id: 'road', label: 'Roads', icon: '\u{1F6E3}', color: '#78909c',
  items: [
    { tool: 'road_rural', label: 'Rural', key: '7', color: '#8d6e63', icon: '\u{1F6A7}' },
    { tool: 'road_2lane', label: '2-Lane', key: '', color: '#78909c', icon: '\u{1F6E3}' },
    { tool: 'road_4lane', label: '4-Lane', key: '', color: '#607d8b', icon: '\u{1F6E4}' },
    { tool: 'road_6lane', label: '6-Lane', key: '', color: '#455a64', icon: '\u{1F6E3}' },
    { tool: 'road_highway', label: 'Highway', key: '', color: '#37474f', icon: '\u{1F6E3}' },
  ],
};

const CIVIC_GROUP: ToolGroup = {
  id: 'civic', label: 'Civic', icon: '\u{1F3DB}', color: '#5c6bc0',
  items: [
    { tool: 'police', label: 'Police', key: '', color: '#3f51b5', icon: '\u{1F694}' },
    { tool: 'fire', label: 'Fire Dept', key: '', color: '#d32f2f', icon: '\u{1F692}' },
    { tool: 'hospital', label: 'Hospital', key: '', color: '#e91e63', icon: '\u{1F3E5}' },
    { tool: 'school', label: 'Elementary', key: '', color: '#795548', icon: '\u{1F3EB}' },
    { tool: 'school_high', label: 'High School', key: '', color: '#6d4c41', icon: '\u{1F3E2}' },
    { tool: 'school_univ', label: 'University', key: '', color: '#4e342e', icon: '\u{1F393}' },
    { tool: 'cemetery', label: 'Cemetery', key: '', color: '#9e9e9e', icon: '\u{26B0}' },
  ],
};

const UTILITY_GROUP: ToolGroup = {
  id: 'utility', label: 'Utility', icon: '\u{26A1}', color: '#ffb300',
  items: [
    { tool: 'power', label: 'Power', key: '8', color: '#ffeb3b', icon: '\u{26A1}' },
    { tool: 'water', label: 'Water', key: '9', color: '#03a9f4', icon: '\u{1F4A7}' },
    { tool: 'sewage', label: 'Sewage', key: '', color: '#607d8b', icon: '\u{1F6B0}' },
    { tool: 'garbage', label: 'Landfill', key: '', color: '#795548', icon: '\u{1F5D1}' },
    { tool: 'park', label: 'Park', key: '', color: '#4caf50', icon: '\u{1F333}' },
  ],
};

const TRANSPORT_GROUP: ToolGroup = {
  id: 'transport', label: 'Transit', icon: '\u{1F68C}', color: '#ff9800',
  items: [
    { tool: 'bus_stop', label: 'Bus Stop', key: '', color: '#ff9800', icon: '\u{1F68F}' },
    { tool: 'metro_station', label: 'Metro', key: '', color: '#00bcd4', icon: '\u{1F687}' },
    { tool: 'tram_stop', label: 'Tram', key: '', color: '#8bc34a', icon: '\u{1F68A}' },
    { tool: 'train_station', label: 'Train', key: '', color: '#795548', icon: '\u{1F689}' },
    { tool: 'ferry_dock', label: 'Ferry', key: '', color: '#0288d1', icon: '\u{26F4}' },
    { tool: 'airport', label: 'Airport', key: '', color: '#9c27b0', icon: '\u{2708}' },
    { tool: 'taxi_stand', label: 'Taxi', key: '', color: '#ffc107', icon: '\u{1F695}' },
  ],
};

const DISTRICT_GROUP: ToolGroup = {
  id: 'district', label: 'District', icon: '\u{1F3F3}', color: '#ab47bc',
  items: [
    { tool: 'district', label: 'Paint', key: '', color: '#ab47bc', icon: '\u{1F58C}' },
  ],
};

// Legacy alias for code that references INFRA_GROUP
const INFRA_GROUP: ToolGroup = {
  id: 'infra', label: 'Infra', icon: '\u{1F3D7}', color: '#78909c',
  items: [...ROAD_GROUP.items, ...CIVIC_GROUP.items, ...UTILITY_GROUP.items],
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

  /* ===== Rotation Indicator ===== */
  #rotation-indicator {
    position: absolute; top: 54px; right: 16px;
    background: rgba(25, 55, 120, 0.85);
    border: 1px solid rgba(66, 165, 245, 0.4);
    border-radius: 6px; color: #e3f2fd;
    padding: 4px 10px; font-size: 12px; font-weight: 500;
    display: none; pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  #rotation-indicator.visible { display: block; }

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

  /* ===== MiniMap ===== */
  #minimap-container {
    position: absolute; bottom: 72px; left: 12px;
    pointer-events: auto;
    background: rgba(8, 12, 28, 0.88);
    border: 1px solid rgba(100,180,255,0.12);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  #minimap-canvas {
    display: block;
    border-radius: 4px;
    image-rendering: pixelated;
  }

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
  #bp-citizen-list { margin-top: 6px; max-height: 160px; overflow-y: auto; }
  .bp-citizen {
    font-size: 11px; color: #8899b0; padding: 3px 4px; cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .bp-citizen:hover { background: rgba(255,255,255,0.08); color: #d0d8e8; }
  .bp-citizen-detail {
    margin-top: 6px; padding: 6px; background: rgba(0,0,0,0.3);
    border-radius: 4px; font-size: 11px; color: #b0bec5;
  }
  .bp-citizen-detail .cd-name { font-weight: 600; color: #e4eaf4; margin-bottom: 4px; }
  .bp-citizen-detail .cd-row { display: flex; justify-content: space-between; margin: 2px 0; }
  .bp-citizen-detail .cd-row span { color: #d0d8e8; }

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

  /* Tutorial overlay */
  #tutorial-overlay {
    display: none;
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10, 15, 30, 0.95);
    border: 1px solid #0af;
    border-radius: 10px;
    padding: 16px 24px;
    max-width: 420px;
    min-width: 320px;
    z-index: 9999;
    box-shadow: 0 4px 20px rgba(0, 170, 255, 0.2);
    color: #e0e0e0;
    font-family: sans-serif;
  }
  #tutorial-overlay.visible { display: block; }
  #tutorial-overlay .tut-title {
    font-size: 15px;
    font-weight: bold;
    color: #0af;
    margin-bottom: 8px;
  }
  #tutorial-overlay .tut-desc {
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 12px;
  }
  #tutorial-overlay .tut-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #tutorial-overlay .tut-step {
    font-size: 11px;
    color: #888;
  }
  #tutorial-overlay .tut-btns {
    display: flex;
    gap: 6px;
  }
  #tutorial-overlay .tut-btns button {
    background: #1a2a40;
    border: 1px solid #0af;
    color: #0af;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  #tutorial-overlay .tut-btns button:hover { background: #0af; color: #000; }
  #tutorial-overlay .tut-btns .tut-dismiss {
    border-color: #666;
    color: #888;
  }
  #tutorial-overlay .tut-btns .tut-dismiss:hover { background: #444; color: #fff; }

`;

export function createGameUI(game: Game): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'game-ui';
  ui.innerHTML = `
    <style>${STYLES}</style>

    <div id="notification" role="alert" aria-live="assertive"></div>
    <div id="rotation-indicator" aria-live="polite"></div>

    <!-- Top Bar -->
    <div id="top-bar" role="banner" aria-label="City status bar">
      <div class="top-section" role="status" aria-label="City statistics">
        <div class="top-stat">
          <span class="stat-label">Date</span>
          <span class="stat-value" id="info-date" aria-live="polite">Day 1</span>
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
        <div class="speed-group" role="group" aria-label="Game speed controls">
          <button class="sp-btn" data-speed="pause" aria-label="Pause game">II</button>
          <button class="sp-btn active" data-speed="1" aria-label="Normal speed">1x</button>
          <button class="sp-btn" data-speed="2" aria-label="Double speed">2x</button>
          <button class="sp-btn" data-speed="3" aria-label="Triple speed">3x</button>
        </div>
        <button id="mute-btn" title="Toggle Sound" aria-label="Toggle sound mute">&#128266;</button>
      </div>
    </div>


    <!-- Toolbar -->
    <div id="toolbar" role="toolbar" aria-label="City building tools">
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

      ${[ROAD_GROUP, CIVIC_GROUP, UTILITY_GROUP, TRANSPORT_GROUP, DISTRICT_GROUP].map(g => `
      <div class="tb-group" data-group="${g.id}">
        <button class="tb-group-btn" data-group-toggle="${g.id}">
          <span class="tb-icon">${g.icon}</span>
          <span style="color:${g.color}">${g.label}</span>
          <span class="tb-caret">\u25B2</span>
        </button>
        <div class="tb-sub-panel" data-sub="${g.id}">
          ${g.items.map(b => `
            <button class="tb-btn" data-tool="${b.tool}">
              <span class="tb-icon">${b.icon}</span>
              <span style="color:${b.color}">${b.label}</span>
              <span class="tb-key">${b.key}</span>
            </button>
          `).join('')}
          ${g.id === 'district' ? '<button class="tb-btn" id="btn-district-manage"><span class="tb-icon">\u{2699}</span><span style="color:#ab47bc">Manage</span></button>' : ''}
          ${g.id === 'transport' ? '<button class="tb-btn" id="btn-transit-manage"><span class="tb-icon">\u{1F5FA}</span><span style="color:#ff9800">Routes</span></button>' : ''}
        </div>
      </div>
      `).join('')}

      <button class="tb-btn" data-tool="demolish">
        <span class="tb-icon">\u{1F4A5}</span>
        <span style="color:#ef5350">Demolish</span>
        <span class="tb-key">0</span>
      </button>

      <div class="tb-sep"></div>
      <div id="rci-bar" role="group" aria-label="RCI demand indicators">
        <div class="rci-col">
          <div class="rci-meter" role="meter" aria-label="Residential demand" aria-valuemin="0" aria-valuemax="100"><div class="rci-fill" id="rci-r" style="background:#66bb6a;height:50%"></div></div>
          <div class="rci-label">R</div>
        </div>
        <div class="rci-col">
          <div class="rci-meter" role="meter" aria-label="Commercial demand" aria-valuemin="0" aria-valuemax="100"><div class="rci-fill" id="rci-c" style="background:#42a5f5;height:50%"></div></div>
          <div class="rci-label">C</div>
        </div>
        <div class="rci-col">
          <div class="rci-meter" role="meter" aria-label="Industrial demand" aria-valuemin="0" aria-valuemax="100"><div class="rci-fill" id="rci-i" style="background:#ffa726;height:50%"></div></div>
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
      <button class="tb-action" id="btn-layers" title="Layers / Overlays">
        <span class="tb-icon">\u{1F5FA}</span>
        <span>Layers</span>
      </button>
      <button class="tb-action" id="btn-cityspec" title="City Specialization">
        <span class="tb-icon">\u{2B50}</span>
        <span>Specialize</span>
      </button>
      <button class="tb-action" id="btn-debug" title="Developer Debug Tools">
        <span class="tb-icon">\u{1F527}</span>
        <span>Debug</span>
      </button>
    </div>

    <!-- Overlay Indicator -->
    <div id="overlay-indicator">
      <span class="oi-label">Overlay:</span>
      <span class="oi-name" id="oi-name"></span>
      <button id="overlay-close">Close</button>
    </div>

    <!-- MiniMap -->
    <div id="minimap-container" role="img" aria-label="City minimap">
      <canvas id="minimap-canvas" width="120" height="120"></canvas>
    </div>

    <!-- Building Panel -->
    <div id="building-panel" class="g-panel">
      <div class="bp-title" id="bp-name"></div>
      <div class="bp-row">Level <span id="bp-level"></span></div>
      <div class="bp-row" id="bp-residents-row">Residents <span id="bp-residents"></span></div>
      <div class="bp-row" id="bp-workers-row">Workers <span id="bp-workers"></span></div>
      <div class="bp-row">Tax <span id="bp-tax"></span></div>
      <div class="bp-row">Zone <span id="bp-zone"></span></div>
      <div id="bp-citizen-list"></div>
      <div id="bp-citizen-detail" class="bp-citizen-detail" style="display:none"></div>
    </div>

    <!-- Economy Modal -->
    <div class="modal-overlay" id="economy-modal" role="dialog" aria-label="Economy Panel">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">$ Economy Overview</div>
          <button class="modal-close" data-close="economy-modal">&times;</button>
        </div>
        <div class="modal-body" id="economy-body"></div>
      </div>
    </div>

    <!-- Traffic Modal -->
    <div class="modal-overlay" id="traffic-modal" role="dialog" aria-label="Traffic Panel">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">\u{1F697} Traffic Overview</div>
          <button class="modal-close" data-close="traffic-modal">&times;</button>
        </div>
        <div class="modal-body" id="traffic-body"></div>
      </div>
    </div>

    <!-- Overview Modal -->
    <div class="modal-overlay" id="overview-modal" role="dialog" aria-label="City Overview">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">\u{1F3D9} City Overview</div>
          <button class="modal-close" data-close="overview-modal">&times;</button>
        </div>
        <div class="modal-body" id="overview-body"></div>
      </div>
    </div>

    <!-- Layers Modal -->
    <div class="modal-overlay" id="layers-modal" role="dialog" aria-label="Map Overlay Layers">
      <div class="modal-panel" style="min-width:360px;max-width:420px">
        <div class="modal-header">
          <div class="modal-title">\u{1F5FA} Map Layers</div>
          <button class="modal-close" data-close="layers-modal">&times;</button>
        </div>
        <div class="modal-body" id="layers-body">
          <div class="section-title">Infrastructure</div>
          <div class="overlay-btns">
            <button class="ov-btn" data-overlay="power">\u{26A1} Power</button>
            <button class="ov-btn" data-overlay="water">\u{1F4A7} Water</button>
          </div>
          <div class="section-title">City Data</div>
          <div class="overlay-btns">
            <button class="ov-btn" data-overlay="traffic">\u{1F697} Traffic</button>
            <button class="ov-btn" data-overlay="zone">\u{1F3D7} Zones</button>
            <button class="ov-btn" data-overlay="landValue">\u{1F4B0} Land Value</button>
            <button class="ov-btn" data-overlay="pollution">\u{1F32B} Pollution</button>
          </div>
          <div class="section-title">Services</div>
          <div class="overlay-btns">
            <button class="ov-btn" data-overlay="police">\u{1F694} Police</button>
            <button class="ov-btn" data-overlay="fire">\u{1F692} Fire</button>
            <button class="ov-btn" data-overlay="health">\u{1F3E5} Health</button>
            <button class="ov-btn" data-overlay="education">\u{1F3EB} Education</button>
            <button class="ov-btn" data-overlay="park">\u{1F333} Park</button>
            <button class="ov-btn" data-overlay="garbage">\u{1F5D1} Garbage</button>
            <button class="ov-btn" data-overlay="district">\u{1F3F3} District</button>
          </div>
        </div>
      </div>
    </div>

    <!-- City Specialization Modal -->
    <div class="modal-overlay" id="cityspec-modal" role="dialog" aria-label="City Specialization">
      <div class="modal-panel" style="min-width:380px;max-width:440px">
        <div class="modal-header">
          <div class="modal-title">\u{2B50} City Specialization</div>
          <button class="modal-close" data-close="cityspec-modal">&times;</button>
        </div>
        <div class="modal-body" id="cityspec-body">
          <div style="color:#888;text-align:center;padding:12px">Loading...</div>
        </div>
      </div>
    </div>

    <!-- District Management Modal -->
    <div class="modal-overlay" id="district-modal" role="dialog" aria-label="District Management">
      <div class="modal-panel" style="min-width:400px;max-width:480px">
        <div class="modal-header">
          <div class="modal-title">\u{1F3F3} District Management</div>
          <button class="modal-close" data-close="district-modal">&times;</button>
        </div>
        <div class="modal-body" id="district-body">
          <div style="color:#888;text-align:center;padding:12px">No districts created yet.<br>Use the District Paint tool to create one.</div>
        </div>
      </div>
    </div>

    <!-- Transit Route Management Modal -->
    <div class="modal-overlay" id="transit-modal" role="dialog" aria-label="Transit Route Management">
      <div class="modal-panel" style="min-width:400px;max-width:480px">
        <div class="modal-header">
          <div class="modal-title">\u{1F68C} Transit Routes</div>
          <button class="modal-close" data-close="transit-modal">&times;</button>
        </div>
        <div class="modal-body" id="transit-body">
          <div style="color:#888;text-align:center;padding:12px">No transit stops placed yet.<br>Place stops using the Transit tools, then create routes here.</div>
        </div>
      </div>
    </div>

    <!-- Developer Debug Modal -->
    <div class="modal-overlay" id="debug-modal" role="dialog" aria-label="Developer Debug Tools">
      <div class="modal-panel" style="min-width:420px;max-width:520px">
        <div class="modal-header">
          <div class="modal-title">\u{1F527} Developer Debug Tools</div>
          <button class="modal-close" data-close="debug-modal">&times;</button>
        </div>
        <div class="modal-body" id="debug-body">
          <div style="color:#888;text-align:center;padding:12px">Loading...</div>
        </div>
      </div>
    </div>

    <!-- Tutorial Overlay -->
    <div id="tutorial-overlay" role="dialog" aria-label="Tutorial">
      <div class="tut-title" id="tut-title"></div>
      <div class="tut-desc" id="tut-desc"></div>
      <div class="tut-footer">
        <span class="tut-step" id="tut-step"></span>
        <div class="tut-btns">
          <button class="tut-dismiss" id="tut-dismiss">Skip</button>
          <button id="tut-prev">Back</button>
          <button id="tut-next">Next</button>
        </div>
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
        ui.querySelector('#btn-layers')?.classList.remove('panel-open');
        ui.querySelector('#btn-cityspec')?.classList.remove('panel-open');
        ui.querySelector('#btn-debug')?.classList.remove('panel-open');
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
        ui.querySelector('#btn-layers')?.classList.remove('panel-open');
        ui.querySelector('#btn-cityspec')?.classList.remove('panel-open');
        ui.querySelector('#btn-debug')?.classList.remove('panel-open');
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

  // Layers panel button
  const btnLayers = ui.querySelector('#btn-layers');
  if (btnLayers) {
    btnLayers.addEventListener('click', () => {
      const modal = ui.querySelector('#layers-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnLayers.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateLayersPanel();
    });
  }

  // Overlay buttons inside Layers modal
  ui.querySelectorAll('#layers-body .ov-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlayType = (btn as HTMLElement).dataset['overlay'];
      if (overlayType) {
        game.toggleOverlay(overlayType as any);
        updateLayersPanel();
        updateUI();
      }
    });
  });

  function updateLayersPanel(): void {
    const currentOverlay = (game as any).overlayRenderer?.getOverlay?.() as string ?? 'none';
    ui.querySelectorAll('#layers-body .ov-btn').forEach(btn => {
      const ov = (btn as HTMLElement).dataset['overlay'];
      btn.classList.toggle('active', ov === currentOverlay);
    });
  }

  // City specialization button
  const btnCitySpec = ui.querySelector('#btn-cityspec');
  if (btnCitySpec) {
    btnCitySpec.addEventListener('click', () => {
      const modal = ui.querySelector('#cityspec-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnCitySpec.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateCitySpecPanel();
    });
  }

  // District management button
  const btnDistrictManage = ui.querySelector('#btn-district-manage');
  if (btnDistrictManage) {
    btnDistrictManage.addEventListener('click', (e) => {
      e.stopPropagation();
      const modal = ui.querySelector('#district-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      if (!isOpen) updateDistrictPanel();
    });
  }

  // Transit route management button
  const btnTransitManage = ui.querySelector('#btn-transit-manage');
  if (btnTransitManage) {
    btnTransitManage.addEventListener('click', (e) => {
      e.stopPropagation();
      const modal = ui.querySelector('#transit-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      if (!isOpen) updateTransitPanel();
    });
  }

  // Developer Debug button
  const btnDebug = ui.querySelector('#btn-debug');
  if (btnDebug) {
    btnDebug.addEventListener('click', () => {
      const modal = ui.querySelector('#debug-modal') as HTMLElement;
      const isOpen = modal.classList.contains('visible');
      modal.classList.toggle('visible');
      btnDebug.classList.toggle('panel-open', !isOpen);
      if (!isOpen) updateDebugPanel();
    });
  }

  let debugRefreshId: ReturnType<typeof setInterval> | null = null;

  function updateDebugPanel(): void {
    const body = ui.querySelector('#debug-body') as HTMLElement;
    if (!body) return;
    const state = game.getState();
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();

    body.innerHTML = `
      <div style="font-size:11px;line-height:1.6">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:bold;color:#0af">SIMULATION STATE</span>
          <span style="color:#888">Tick: ${snap.tick}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="color:#aaa">Population</td><td style="text-align:right;font-weight:bold">${snap.population}</td></tr>
          <tr><td style="color:#aaa">Vehicles</td><td style="text-align:right">${snap.vehicleCount}</td></tr>
          <tr><td style="color:#aaa">Buildings</td><td style="text-align:right">${snap.buildingCount}</td></tr>
          <tr><td style="color:#aaa">Infrastructure</td><td style="text-align:right">${snap.infraCount}</td></tr>
          <tr><td style="color:#aaa">Roads</td><td style="text-align:right">${snap.roadCount}</td></tr>
          <tr><td colspan="2" style="border-top:1px solid #333;padding-top:4px"></td></tr>
          <tr><td style="color:#aaa">Funds</td><td style="text-align:right;color:#4f4">$${snap.funds.toLocaleString()}</td></tr>
          <tr><td style="color:#aaa">Income</td><td style="text-align:right;color:#4f4">$${snap.income.toLocaleString()}</td></tr>
          <tr><td style="color:#aaa">Expenses</td><td style="text-align:right;color:#f44">$${snap.expenses.toLocaleString()}</td></tr>
          <tr><td colspan="2" style="border-top:1px solid #333;padding-top:4px"></td></tr>
          <tr><td style="color:#aaa">RCI Demand</td><td style="text-align:right">R:${Math.round(snap.rciDemand.r)} C:${Math.round(snap.rciDemand.c)} I:${Math.round(snap.rciDemand.i)}</td></tr>
          <tr><td style="color:#aaa">Power Supply</td><td style="text-align:right">${snap.powerSupply} MW</td></tr>
          <tr><td style="color:#aaa">Water Supply</td><td style="text-align:right">${snap.waterSupply}</td></tr>
          <tr><td style="color:#aaa">Avg Happiness</td><td style="text-align:right">${snap.avgHappiness}</td></tr>
          <tr><td style="color:#aaa">Avg Land Value</td><td style="text-align:right">${snap.avgLandValue}</td></tr>
          <tr><td style="color:#aaa">Avg Pollution</td><td style="text-align:right">${snap.avgPollution}</td></tr>
        </table>
        <div style="border-top:1px solid #333;margin-top:8px;padding-top:8px">
          <div style="font-weight:bold;color:#0af;margin-bottom:6px">MODIFY PARAMETERS</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Funds:</label>
            <input id="dbg-funds" type="number" value="${Math.round(snap.funds)}" style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px">
            <button id="dbg-set-funds" style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Tax Rate:</label>
            <input id="dbg-tax" type="number" value="${snap.taxRate}" min="0" max="30" style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px">
            <button id="dbg-set-tax" style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Speed:</label>
            <input id="dbg-speed" type="number" value="${snap.speed}" min="1" max="3" style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px">
            <button id="dbg-set-speed" style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="border-top:1px solid #333;margin-top:8px;padding-top:8px">
            <button id="dbg-save-game" style="background:#4caf50;color:#fff;border:none;padding:6px 16px;cursor:pointer;font-size:12px;border-radius:3px;width:100%">Save Game</button>
            <div id="dbg-save-status" style="color:#888;font-size:11px;margin-top:4px;text-align:center"></div>
          </div>
        </div>
      </div>
    `;

    // Attach handlers
    body.querySelector('#dbg-set-funds')?.addEventListener('click', () => {
      const val = parseInt((body.querySelector('#dbg-funds') as HTMLInputElement).value, 10);
      if (!isNaN(val)) { tools.setParam('funds', val); updateDebugPanel(); }
    });
    body.querySelector('#dbg-set-tax')?.addEventListener('click', () => {
      const val = parseInt((body.querySelector('#dbg-tax') as HTMLInputElement).value, 10);
      if (!isNaN(val)) { tools.setParam('taxRate', val); updateDebugPanel(); }
    });
    body.querySelector('#dbg-set-speed')?.addEventListener('click', () => {
      const val = parseInt((body.querySelector('#dbg-speed') as HTMLInputElement).value, 10);
      if (!isNaN(val)) { tools.setParam('speed', val); updateDebugPanel(); }
    });
    body.querySelector('#dbg-save-game')?.addEventListener('click', async () => {
      const statusEl = body.querySelector('#dbg-save-status') as HTMLElement;
      if (statusEl) statusEl.textContent = 'Saving...';
      try {
        await game.saveCurrentGame(0, `Manual Save - Tick ${snap.tick}`);
        if (statusEl) statusEl.textContent = 'Saved successfully!';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      } catch (e) {
        if (statusEl) statusEl.textContent = `Save failed: ${e}`;
      }
    });

    // Auto-refresh every 2 seconds while panel is open
    if (debugRefreshId) clearInterval(debugRefreshId);
    debugRefreshId = setInterval(() => {
      const modal = ui.querySelector('#debug-modal') as HTMLElement;
      if (modal && modal.classList.contains('visible')) {
        // Skip refresh if user is editing an input field or save status is showing
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT' && modal.contains(activeEl)) return;
        const saveStatus = modal.querySelector('#dbg-save-status');
        if (saveStatus && saveStatus.textContent) return;
        updateDebugPanel();
      } else {
        if (debugRefreshId) { clearInterval(debugRefreshId); debugRefreshId = null; }
      }
    }, 2000);
  }

  // Tutorial system
  const tutorial = new Tutorial();
  const tutOverlay = ui.querySelector('#tutorial-overlay') as HTMLElement;
  const tutTitle = ui.querySelector('#tut-title') as HTMLElement;
  const tutDesc = ui.querySelector('#tut-desc') as HTMLElement;
  const tutStep = ui.querySelector('#tut-step') as HTMLElement;

  function renderTutorial(): void {
    const step = tutorial.getCurrentStep();
    if (!step || !tutorial.isActive()) {
      tutOverlay.classList.remove('visible');
      return;
    }
    tutOverlay.classList.add('visible');
    tutTitle.textContent = step.title;
    tutDesc.textContent = step.description;
    tutStep.textContent = `Step ${tutorial.getStepIndex() + 1} of ${tutorial.getTotalSteps()}`;
    const nextBtn = ui.querySelector('#tut-next') as HTMLElement;
    if (nextBtn) {
      nextBtn.textContent = tutorial.getStepIndex() === tutorial.getTotalSteps() - 1 ? 'Finish' : 'Next';
    }
  }

  ui.querySelector('#tut-next')?.addEventListener('click', () => {
    tutorial.next();
    renderTutorial();
  });
  ui.querySelector('#tut-prev')?.addEventListener('click', () => {
    tutorial.prev();
    renderTutorial();
  });
  ui.querySelector('#tut-dismiss')?.addEventListener('click', () => {
    tutorial.dismiss();
    renderTutorial();
  });

  // Show tutorial on first load
  renderTutorial();

  function updateCitySpecPanel(): void {
    const body = ui.querySelector('#cityspec-body') as HTMLElement;
    if (!body) return;
    const state = game.getState();
    const pop = state.citizens.getPopulation();
    const currentSpec = state.citySpec.getCurrent();

    const specs = [
      { type: 'NONE', label: 'None', desc: 'No specialization', icon: '\u{2796}' },
      { type: 'MINING_CITY', label: 'Mining City', desc: 'Revenue +15%, Happiness -5, Crime +5', icon: '\u{26CF}' },
      { type: 'OIL_CITY', label: 'Oil City', desc: 'Revenue +20%, Happiness -5, Crime +3', icon: '\u{1F6E2}' },
      { type: 'TECH_CITY', label: 'Tech City', desc: 'Revenue +25%, Happiness +5, Crime -5', icon: '\u{1F4BB}' },
      { type: 'TOURISM_CITY', label: 'Tourism City', desc: 'Revenue +20%, Happiness +3, Crime +5', icon: '\u{1F3D6}' },
      { type: 'GAMBLING_CITY', label: 'Gambling City', desc: 'Revenue +40%, Happiness -10, Crime +15', icon: '\u{1F3B0}' },
      { type: 'TRADE_CITY', label: 'Trade City', desc: 'Revenue +15%, Happiness +2', icon: '\u{1F4E6}' },
    ];

    body.innerHTML = `
      <div style="margin-bottom:8px;font-size:12px;color:#aaa">Population: <strong style="color:#e0e0e0">${pop}</strong> (5,000 needed to specialize)</div>
      ${specs.map(s => {
        const isCurrent = s.type === currentSpec;
        const canChoose = s.type === 'NONE' || pop >= 5000;
        return `<button class="cityspec-btn" data-spec="${s.type}"
          style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;margin-bottom:4px;
          border-radius:6px;border:1px solid ${isCurrent ? '#ffc107' : '#333'};
          background:${isCurrent ? '#ffc10722' : '#1a2233'};color:${canChoose ? '#e0e0e0' : '#555'};
          cursor:${canChoose ? 'pointer' : 'not-allowed'};font-size:12px;text-align:left">
          <span style="font-size:18px">${s.icon}</span>
          <div>
            <div style="font-weight:600">${isCurrent ? '\u2605 ' : ''}${s.label}</div>
            <div style="font-size:11px;color:${canChoose ? '#888' : '#444'}">${s.desc}</div>
          </div>
        </button>`;
      }).join('')}
    `;

    body.querySelectorAll('.cityspec-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const specType = (btn as HTMLElement).dataset['spec']!;
        const success = state.citySpec.choose(specType as any, pop);
        if (success) updateCitySpecPanel();
      });
    });
  }

  function updateDistrictPanel(): void {
    const body = ui.querySelector('#district-body') as HTMLElement;
    if (!body) return;
    const state = game.getState();
    const districts = state.districts.getAllDistricts();

    if (districts.length === 0) {
      body.innerHTML = '<div style="color:#888;text-align:center;padding:12px">No districts created yet.<br>Use the District Paint tool to create one.</div>';
      return;
    }

    const policyTypes = ['NO_HEAVY_INDUSTRY', 'ENCOURAGE_RECYCLING', 'HIGH_DENSITY_BAN', 'ORGANIC_FOOD', 'TOURISM'];
    const policyLabels: Record<string, string> = {
      NO_HEAVY_INDUSTRY: 'No Heavy Industry ($150)',
      ENCOURAGE_RECYCLING: 'Encourage Recycling ($100)',
      HIGH_DENSITY_BAN: 'High Density Ban ($120)',
      ORGANIC_FOOD: 'Organic Food ($80)',
      TOURISM: 'Tourism Promotion ($200)',
    };

    body.innerHTML = districts.map(d => {
      const activePolicies = new Set(d.policies.filter(p => p.active).map(p => p.type));
      return `
        <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="color:#e0e0e0">${d.name}</strong>
            <span style="color:#888;font-size:11px">${d.cells.size} cells</span>
          </div>
          <div style="font-size:12px;color:#aaa;margin-bottom:4px">Policies:</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${policyTypes.map(pt => {
              const isActive = activePolicies.has(pt as unknown as import('../core/district/types').PolicyType);
              return `<button class="district-policy-btn" data-district="${d.id}" data-policy="${pt}"
                style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid ${isActive ? '#ab47bc' : '#444'};
                background:${isActive ? '#ab47bc33' : '#222'};color:${isActive ? '#ce93d8' : '#777'};cursor:pointer">
                ${isActive ? '\u2713 ' : ''}${policyLabels[pt]}
              </button>`;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Attach policy toggle handlers
    body.querySelectorAll('.district-policy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const districtId = (btn as HTMLElement).dataset['district']!;
        const policyType = (btn as HTMLElement).dataset['policy']!;
        if (state.policies.isPolicyActive(districtId, policyType as any)) {
          state.policies.removePolicy(districtId, policyType as any);
        } else {
          state.policies.applyPolicy(districtId, policyType as any);
        }
        updateDistrictPanel();
      });
    });
  }

  function updateTransitPanel(): void {
    const body = ui.querySelector('#transit-body') as HTMLElement;
    if (!body) return;
    const state = game.getState();

    const busStops = state.bus.getStops();
    const busRoutes = state.bus.getRoutes();
    const metroStations = state.metro.getStations();
    const metroLines = state.metro.getLines();
    const tramStops = state.tram.getStops();
    const tramRoutes = state.tram.getRoutes();

    const sections: string[] = [];

    // Bus section
    if (busStops.length > 0) {
      sections.push(`
        <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
          <div style="color:#ff9800;font-weight:600;margin-bottom:4px">\u{1F68F} Bus System</div>
          <div style="font-size:12px;color:#aaa">Stops: ${busStops.length} | Routes: ${busRoutes.length} | Cost: $${state.bus.getOperatingCost()}/tick</div>
          ${busStops.length >= 2 && busRoutes.length === 0
            ? `<button class="transit-create-route" data-type="bus" style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #ff9800;background:#ff980022;color:#ff9800;cursor:pointer">+ Create Route (all stops)</button>`
            : ''}
          ${busRoutes.map((r, i) => `<div style="font-size:11px;color:#ccc;margin-top:4px">Route ${i + 1}: ${r.stops.length} stops, ${r.vehicles} vehicle(s)</div>`).join('')}
        </div>
      `);
    }

    // Metro section
    if (metroStations.length > 0) {
      sections.push(`
        <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
          <div style="color:#00bcd4;font-weight:600;margin-bottom:4px">\u{1F687} Metro System</div>
          <div style="font-size:12px;color:#aaa">Stations: ${metroStations.length} | Lines: ${metroLines.length} | Cost: $${state.metro.getOperatingCost()}/tick</div>
          ${metroStations.length >= 2 && metroLines.length === 0
            ? `<button class="transit-create-route" data-type="metro" style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #00bcd4;background:#00bcd422;color:#00bcd4;cursor:pointer">+ Create Line (all stations)</button>`
            : ''}
          ${metroLines.map((l, i) => `<div style="font-size:11px;color:#ccc;margin-top:4px">Line ${i + 1}: ${l.stops.length} stations, ${l.vehicles} train(s)</div>`).join('')}
        </div>
      `);
    }

    // Tram section
    if (tramStops.length > 0) {
      sections.push(`
        <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
          <div style="color:#8bc34a;font-weight:600;margin-bottom:4px">\u{1F68A} Tram System</div>
          <div style="font-size:12px;color:#aaa">Stops: ${tramStops.length} | Routes: ${tramRoutes.length} | Cost: $${state.tram.getOperatingCost()}/tick</div>
          ${tramStops.length >= 2 && tramRoutes.length === 0
            ? `<button class="transit-create-route" data-type="tram" style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #8bc34a;background:#8bc34a22;color:#8bc34a;cursor:pointer">+ Create Route (all stops)</button>`
            : ''}
          ${tramRoutes.map((r, i) => `<div style="font-size:11px;color:#ccc;margin-top:4px">Route ${i + 1}: ${r.stops.length} stops, ${r.vehicles} vehicle(s)</div>`).join('')}
        </div>
      `);
    }

    if (sections.length === 0) {
      body.innerHTML = '<div style="color:#888;text-align:center;padding:12px">No transit stops placed yet.<br>Place stops using the Transit tools, then create routes here.</div>';
      return;
    }

    body.innerHTML = sections.join('');

    // Attach route creation handlers
    body.querySelectorAll('.transit-create-route').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset['type'];
        if (type === 'bus') {
          const stops = [...state.bus.getStops()];
          if (stops.length >= 2) {
            state.bus.createRoute(stops, 1);
          }
        } else if (type === 'metro') {
          const stations = [...state.metro.getStations()];
          if (stations.length >= 2) {
            state.metro.createLine(stations, 1);
          }
        } else if (type === 'tram') {
          const stops = [...state.tram.getStops()];
          if (stops.length >= 2) {
            state.tram.createRoute(stops, 1);
          }
        }
        updateTransitPanel();
      });
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
    if (taxEl) taxEl.textContent = `$${((bt.residents + bt.workers) * 0.5).toFixed(0)}/tick`;
    if (zoneEl) zoneEl.textContent = ZONE_NAMES[selected.zoneType] ?? 'Unknown';

    // Citizen list
    const citizenListEl = panel.querySelector('#bp-citizen-list') as HTMLElement;
    const citizenDetailEl = panel.querySelector('#bp-citizen-detail') as HTMLElement;
    if (citizenListEl) {
      const buildingKey = `${selected.x},${selected.y}`;
      const cm = game.getState().citizens;
      const residents = cm.getCitizensByHome(buildingKey);
      const workers = cm.getCitizensByWorkplace(buildingKey);
      const hasPeople = residents.length > 0 || workers.length > 0;

      if (!hasPeople) {
        citizenListEl.innerHTML = '';
        if (citizenDetailEl) citizenDetailEl.style.display = 'none';
      } else {
        let html = '';
        if (residents.length > 0) {
          html += `<div style="font-size:11px;color:#66bb6a;margin-top:4px">Residents (${residents.length})</div>`;
          for (const c of residents) {
            html += `<div class="bp-citizen" data-cid="${c.id}">Citizen #${c.id} - Age ${c.age} (${c.lifeStage})</div>`;
          }
        }
        if (workers.length > 0) {
          html += `<div style="font-size:11px;color:#42a5f5;margin-top:4px">Workers (${workers.length})</div>`;
          for (const c of workers) {
            html += `<div class="bp-citizen" data-cid="${c.id}">Citizen #${c.id} - Age ${c.age} (${c.lifeStage})</div>`;
          }
        }
        citizenListEl.innerHTML = html;
        citizenListEl.querySelectorAll('.bp-citizen').forEach((el) => {
          el.addEventListener('click', () => {
            const cid = Number((el as HTMLElement).dataset.cid);
            showCitizenDetail(cid, citizenDetailEl);
          });
        });
      }
    }
  }

  function showCitizenDetail(citizenId: number, detailEl: HTMLElement | null): void {
    if (!detailEl) return;
    const c = game.getState().citizens.getCitizen(citizenId);
    if (!c) {
      detailEl.style.display = 'none';
      return;
    }
    const homeLabel = c.homeId ?? 'Homeless';
    const workLabel = c.workplaceId ?? 'Unemployed';
    detailEl.innerHTML = `
      <div class="cd-name">Citizen #${c.id}</div>
      <div class="cd-row">Age <span>${c.age} (${c.lifeStage})</span></div>
      <div class="cd-row">Education <span>${c.education}</span></div>
      <div class="cd-row">Income <span>${c.incomeLevel}</span></div>
      <div class="cd-row">Happiness <span>${c.happiness}</span></div>
      <div class="cd-row">Health <span>${c.health}</span></div>
      <div class="cd-row">Home <span>${homeLabel}</span></div>
      <div class="cd-row">Work <span>${workLabel}</span></div>
    `;
    detailEl.style.display = 'block';
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
        <tr><td class="td-label">Income Tax (Residential)</td><td class="td-value">${state.taxRates.residential}%</td><td class="td-income" style="text-align:right">+$${breakdown.residential.toFixed(1)}</td></tr>
        <tr><td class="td-label">Business Tax (Commercial)</td><td class="td-value">${state.taxRates.business}%</td><td class="td-income" style="text-align:right">+$${breakdown.commercial.toFixed(1)}</td></tr>
        <tr><td class="td-label">Business Tax (Industrial)</td><td class="td-value">${state.taxRates.business}%</td><td class="td-income" style="text-align:right">+$${breakdown.industrial.toFixed(1)}</td></tr>
        <tr><td class="td-label">Business Tax (Office)</td><td class="td-value">${state.taxRates.business}%</td><td class="td-income" style="text-align:right">+$${breakdown.office.toFixed(1)}</td></tr>
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
        <label>\u6240\u5f97\u7a05\u7387</label>
        <input type="range" id="tax-slider-income" min="1" max="20" step="1" value="${state.taxRates.residential}">
        <span class="tax-val" id="tax-display-income">${state.taxRates.residential}%</span>
      </div>
      <div class="tax-row">
        <label>\u71df\u696d\u7a05\u7387</label>
        <input type="range" id="tax-slider-business" min="1" max="20" step="1" value="${state.taxRates.business}">
        <span class="tax-val" id="tax-display-business">${state.taxRates.business}%</span>
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

    // Income tax slider
    const incomeTaxSlider = body.querySelector('#tax-slider-income') as HTMLInputElement;
    const incomeTaxDisplay = body.querySelector('#tax-display-income') as HTMLElement;
    if (incomeTaxSlider) {
      incomeTaxSlider.addEventListener('input', () => {
        const rate = parseInt(incomeTaxSlider.value, 10);
        const taxes = game.getState().taxRates;
        taxes.residential = rate;
        if (incomeTaxDisplay) incomeTaxDisplay.textContent = `${rate}%`;
      });
    }

    // Business tax slider
    const businessTaxSlider = body.querySelector('#tax-slider-business') as HTMLInputElement;
    const businessTaxDisplay = body.querySelector('#tax-display-business') as HTMLElement;
    if (businessTaxSlider) {
      businessTaxSlider.addEventListener('input', () => {
        const rate = parseInt(businessTaxSlider.value, 10);
        const taxes = game.getState().taxRates;
        taxes.business = rate;
        taxes.commercial = rate;
        taxes.industrial = rate;
        taxes.office = rate;
        if (businessTaxDisplay) businessTaxDisplay.textContent = `${rate}%`;
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

    `;
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
  // ===== MiniMap =====
  const minimapCanvas = ui.querySelector('#minimap-canvas') as HTMLCanvasElement;
  const minimapCtx = minimapCanvas?.getContext('2d');
  let minimapTick = 0;

  function updateMiniMap(): void {
    if (!minimapCtx) return;
    // Only update every 10 frames for performance
    minimapTick++;
    if (minimapTick % 10 !== 0) return;

    const state = game.getState();
    const grid = state.grid;
    const w = grid.width;
    const h = grid.height;
    const cw = minimapCanvas.width;
    const ch = minimapCanvas.height;
    const sx = cw / w;
    const sy = ch / h;

    // Clear
    minimapCtx.fillStyle = '#1a2a1a';
    minimapCtx.fillRect(0, 0, cw, ch);

    // Draw each cell
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;

        let color: string | null = null;

        // Terrain
        if (cell.terrainType === 1) color = '#1a3a5c'; // water
        else if (cell.terrainType === 2) color = '#5c5c4c'; // mountain
        else if (cell.terrainType === 3) color = '#1c3a1c'; // forest

        // Roads override
        if (cell.roadType > 0) color = '#555';

        // Buildings override
        if (cell.buildingId > 0 && cell.buildingId < 243) {
          if (cell.zoneType === 1 || cell.zoneType === 2) color = '#4caf50'; // residential green
          else if (cell.zoneType === 3 || cell.zoneType === 4) color = '#42a5f5'; // commercial blue
          else if (cell.zoneType === 5) color = '#ffa726'; // industrial orange
          else if (cell.zoneType === 6) color = '#ab47bc'; // office purple
        }
        // Infrastructure
        if (cell.buildingId >= 243) color = '#ffeb3b'; // civic yellow

        // Zones without buildings (empty zones)
        if (cell.buildingId === 0 && cell.zoneType > 0 && !color) {
          if (cell.zoneType === 1 || cell.zoneType === 2) color = '#2e5e2e';
          else if (cell.zoneType === 3 || cell.zoneType === 4) color = '#1e4a6e';
          else if (cell.zoneType === 5) color = '#5e3e1e';
          else if (cell.zoneType === 6) color = '#4e2e5e';
        }

        if (color) {
          minimapCtx.fillStyle = color;
          minimapCtx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)));
        }
      }
    }
  }

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
    const roadTools = new Set(ROAD_GROUP.items.map(i => i.tool));
    const civicTools = new Set(CIVIC_GROUP.items.map(i => i.tool));
    const utilityTools = new Set(UTILITY_GROUP.items.map(i => i.tool));
    const transportTools = new Set(TRANSPORT_GROUP.items.map(i => i.tool));
    const districtTools = new Set(DISTRICT_GROUP.items.map(i => i.tool));
    const zoneGroupBtn = ui.querySelector('[data-group-toggle="zone"]');
    const roadGroupBtn = ui.querySelector('[data-group-toggle="road"]');
    const civicGroupBtn = ui.querySelector('[data-group-toggle="civic"]');
    const utilityGroupBtn = ui.querySelector('[data-group-toggle="utility"]');
    const transportGroupBtn = ui.querySelector('[data-group-toggle="transport"]');
    const districtGroupBtn = ui.querySelector('[data-group-toggle="district"]');
    if (zoneGroupBtn) zoneGroupBtn.classList.toggle('active', zoneTools.has(currentTool));
    if (roadGroupBtn) roadGroupBtn.classList.toggle('active', roadTools.has(currentTool));
    if (civicGroupBtn) civicGroupBtn.classList.toggle('active', civicTools.has(currentTool));
    if (utilityGroupBtn) utilityGroupBtn.classList.toggle('active', utilityTools.has(currentTool));
    if (transportGroupBtn) transportGroupBtn.classList.toggle('active', transportTools.has(currentTool));
    if (districtGroupBtn) districtGroupBtn.classList.toggle('active', districtTools.has(currentTool));

    // Overlay indicator
    const overlayIndicator = ui.querySelector('#overlay-indicator') as HTMLElement;
    const overlayName = ui.querySelector('#oi-name') as HTMLElement;
    if (overlayIndicator && overlayName) {
      const ov = (game as any).overlayRenderer?.getOverlay?.() as string | undefined;
      if (ov && ov !== 'none') {
        const names: Record<string, string> = {
          power: 'Power', water: 'Water', zone: 'Zones',
          traffic: 'Traffic', pollution: 'Pollution', landValue: 'Land Value',
          police: 'Police', fire: 'Fire', health: 'Health',
          education: 'Education', park: 'Park', garbage: 'Garbage', district: 'Districts',
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

    // Rotation indicator
    const rotEl = ui.querySelector('#rotation-indicator') as HTMLElement;
    if (rotEl) {
      const isInfra = ['power', 'water', 'police', 'fire', 'hospital', 'school', 'school_high', 'school_univ', 'park', 'garbage', 'sewage', 'cemetery'].includes(game.currentTool);
      if (isInfra && game.currentRotation !== 0) {
        rotEl.textContent = `R: ${game.currentRotation}°`;
        rotEl.classList.add('visible');
      } else {
        rotEl.classList.remove('visible');
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

    // MiniMap
    updateMiniMap();
  }

  game.setOnUIUpdate(updateUI);
  updateUI();

  return ui;
}
