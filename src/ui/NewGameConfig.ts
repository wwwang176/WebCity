import { getDefaultMapConfig, type MapConfig } from '../core/config/MapConfig';
import { renderMapPreview } from './MapPreviewRenderer';

/**
 * Create the New Game configuration page.
 * Full-page layout matching MainMenu style — not a modal overlay.
 */
export function createNewGameConfig(
  onStart: (config: MapConfig) => void,
  onBack: () => void,
): HTMLElement {
  const config = getDefaultMapConfig();

  const el = document.createElement('div');
  el.id = 'new-game-config';
  el.innerHTML = `
    <style>
      #new-game-config {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: linear-gradient(160deg, #080c1a 0%, #0d1526 30%, #0f1e3d 60%, #0a1428 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 100;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #d0d8e8; overflow: hidden;
      }
      #new-game-config::before {
        content: '';
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: radial-gradient(ellipse at 50% 30%, rgba(30, 80, 180, 0.12) 0%, transparent 60%),
                    radial-gradient(ellipse at 70% 80%, rgba(20, 60, 140, 0.08) 0%, transparent 50%);
        pointer-events: none;
      }
      .ngc-page-title {
        font-size: 36px; font-weight: 800; letter-spacing: -1px;
        background: linear-gradient(135deg, #42a5f5 0%, #64b5f6 30%, #90caf9 60%, #42a5f5 100%);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 32px; position: relative;
      }
      .ngc-content {
        display: flex; gap: 40px; align-items: flex-start;
        position: relative;
        animation: ngc-fade 0.3s ease;
      }
      @keyframes ngc-fade {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Left: settings */
      .ngc-settings {
        display: flex; flex-direction: column; gap: 18px;
        min-width: 320px;
      }
      .ngc-row {
        display: flex; align-items: center; gap: 12px;
      }
      .ngc-label {
        font-size: 13px; font-weight: 500; color: #b0bec5;
        min-width: 90px; flex-shrink: 0;
      }
      .ngc-row-body { flex: 1; display: flex; align-items: center; gap: 8px; }

      /* Seed */
      .ngc-seed-input {
        background: rgba(15,25,50,0.7);
        border: 1px solid rgba(66,165,245,0.2);
        border-radius: 8px; color: #d0d8e8;
        padding: 8px 12px; font-size: 13px;
        width: 130px; font-family: inherit;
        font-variant-numeric: tabular-nums;
      }
      .ngc-seed-input:focus { outline: none; border-color: rgba(66,165,245,0.5); }
      .ngc-dice-btn {
        background: rgba(15,25,50,0.7);
        border: 1px solid rgba(66,165,245,0.2);
        border-radius: 8px; color: #b0bec5;
        width: 36px; height: 36px; cursor: pointer;
        font-size: 18px; display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .ngc-dice-btn:hover {
        background: rgba(25,45,85,0.8);
        border-color: rgba(66,165,245,0.5); color: #e4eaf4;
      }

      /* Slider */
      .ngc-slider { -webkit-appearance: none; appearance: none;
        width: 100%; height: 4px; border-radius: 2px;
        background: rgba(255,255,255,0.08); outline: none; cursor: pointer;
      }
      .ngc-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 16px; height: 16px; border-radius: 50%;
        background: #42a5f5; cursor: pointer;
        border: 2px solid rgba(12,16,32,0.9);
      }
      .ngc-slider::-moz-range-thumb {
        width: 16px; height: 16px; border-radius: 50%;
        background: #42a5f5; cursor: pointer;
        border: 2px solid rgba(12,16,32,0.9);
      }
      .ngc-slider-val {
        font-size: 12px; color: rgba(144,202,249,0.7);
        min-width: 52px; text-align: center;
      }

      /* Button group */
      .ngc-btn-group { display: flex; gap: 0; }
      .ngc-btn-group button {
        background: rgba(15,25,50,0.7);
        border: 1px solid rgba(66,165,245,0.15);
        color: #8899b0; padding: 7px 16px;
        font-size: 12px; font-weight: 500; cursor: pointer;
        transition: all 0.12s; font-family: inherit;
      }
      .ngc-btn-group button:first-child { border-radius: 8px 0 0 8px; }
      .ngc-btn-group button:last-child { border-radius: 0 8px 8px 0; }
      .ngc-btn-group button:not(:first-child) { border-left: none; }
      .ngc-btn-group button:hover { background: rgba(25,45,85,0.7); color: #c0d0e8; }
      .ngc-btn-group button.active {
        background: rgba(66,165,245,0.2);
        border-color: rgba(66,165,245,0.4);
        color: #e4eaf4;
      }

      /* Toggle */
      .ngc-toggle {
        position: relative; width: 40px; height: 22px;
        background: rgba(255,255,255,0.1); border-radius: 11px;
        cursor: pointer; transition: background 0.2s; flex-shrink: 0;
      }
      .ngc-toggle.on { background: rgba(66,165,245,0.4); }
      .ngc-toggle::after {
        content: ''; position: absolute;
        top: 3px; left: 3px; width: 16px; height: 16px;
        border-radius: 50%; background: #8899b0; transition: all 0.2s;
      }
      .ngc-toggle.on::after { left: 21px; background: #42a5f5; }

      .ngc-freq-row {
        display: flex; align-items: center; gap: 8px;
        margin-top: 2px; padding-left: 102px;
        transition: opacity 0.2s, max-height 0.2s;
      }
      .ngc-freq-row.hidden { opacity: 0; max-height: 0; overflow: hidden; margin: 0; padding: 0; }

      /* Right: preview */
      .ngc-preview {
        display: flex; flex-direction: column; align-items: center; gap: 10px;
      }
      .ngc-preview-canvas {
        border-radius: 10px;
        border: 1px solid rgba(100,180,255,0.12);
        image-rendering: pixelated;
      }
      .ngc-seed-label {
        font-size: 12px; color: rgba(144,202,249,0.45);
        font-variant-numeric: tabular-nums;
      }

      /* Footer buttons */
      .ngc-actions {
        display: flex; gap: 12px; margin-top: 36px; position: relative;
      }
      .ngc-btn {
        background: rgba(15, 25, 50, 0.7);
        border: 1px solid rgba(66, 165, 245, 0.2);
        border-radius: 12px; color: #c0d0e8;
        padding: 14px 36px; font-size: 15px; font-weight: 500;
        cursor: pointer; transition: all 0.25s ease;
        text-align: center; position: relative;
        backdrop-filter: blur(8px); font-family: inherit;
      }
      .ngc-btn:hover {
        background: rgba(25, 45, 85, 0.8);
        border-color: rgba(66, 165, 245, 0.5); color: #e4eaf4;
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 20px rgba(66, 165, 245, 0.1);
      }
      .ngc-btn:active { transform: translateY(0); }
      .ngc-btn--primary {
        background: rgba(66,165,245,0.2);
        border-color: rgba(66,165,245,0.4);
        color: #e4eaf4; min-width: 160px;
      }
      .ngc-btn--primary:hover {
        background: rgba(66,165,245,0.35);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 24px rgba(66, 165, 245, 0.15);
      }
    </style>
    <div class="ngc-page-title">New Game</div>
    <div class="ngc-content">
      <div class="ngc-settings">
        <!-- Seed -->
        <div class="ngc-row">
          <div class="ngc-label">Seed</div>
          <div class="ngc-row-body">
            <input type="number" class="ngc-seed-input" id="ngc-seed" min="1" max="2147483646">
            <button class="ngc-dice-btn" id="ngc-dice" title="Randomize">&#x1F3B2;</button>
          </div>
        </div>
        <!-- Water -->
        <div class="ngc-row">
          <div class="ngc-label">Water</div>
          <div class="ngc-row-body">
            <input type="range" class="ngc-slider" id="ngc-water" min="0" max="3" step="1" value="1">
            <span class="ngc-slider-val" id="ngc-water-val">Medium</span>
          </div>
        </div>
        <!-- Forest -->
        <div class="ngc-row">
          <div class="ngc-label">Forest</div>
          <div class="ngc-row-body">
            <input type="range" class="ngc-slider" id="ngc-forest" min="0" max="2" step="1" value="1">
            <span class="ngc-slider-val" id="ngc-forest-val">Normal</span>
          </div>
        </div>
        <!-- Starting Funds -->
        <div class="ngc-row">
          <div class="ngc-label">Funds</div>
          <div class="ngc-row-body">
            <div class="ngc-btn-group" id="ngc-funds">
              <button data-val="easy">Easy $75K</button>
              <button data-val="normal" class="active">Normal $50K</button>
              <button data-val="hard">Hard $25K</button>
            </div>
          </div>
        </div>
        <!-- Disasters -->
        <div class="ngc-row">
          <div class="ngc-label">Disasters</div>
          <div class="ngc-row-body">
            <div class="ngc-toggle on" id="ngc-disaster-toggle"></div>
            <span style="font-size:12px;color:#8899b0" id="ngc-disaster-status">On</span>
          </div>
        </div>
        <div class="ngc-freq-row" id="ngc-freq-row">
          <span style="font-size:12px;color:#8899b0">Frequency</span>
          <input type="range" class="ngc-slider" id="ngc-freq" min="0" max="2" step="1" value="1" style="width:100px">
          <span class="ngc-slider-val" id="ngc-freq-val">Medium</span>
        </div>
      </div>
      <div class="ngc-preview">
        <canvas class="ngc-preview-canvas" id="ngc-preview" width="300" height="300"></canvas>
        <div class="ngc-seed-label" id="ngc-seed-display"></div>
      </div>
    </div>
    <div class="ngc-actions">
      <button class="ngc-btn" id="ngc-back">Back</button>
      <button class="ngc-btn ngc-btn--primary" id="ngc-start">Start Game</button>
    </div>
  `;

  // --- DOM references ---
  const seedInput = el.querySelector('#ngc-seed') as HTMLInputElement;
  const diceBtn = el.querySelector('#ngc-dice') as HTMLButtonElement;
  const waterSlider = el.querySelector('#ngc-water') as HTMLInputElement;
  const waterVal = el.querySelector('#ngc-water-val') as HTMLSpanElement;
  const forestSlider = el.querySelector('#ngc-forest') as HTMLInputElement;
  const forestVal = el.querySelector('#ngc-forest-val') as HTMLSpanElement;
  const fundsGroup = el.querySelector('#ngc-funds') as HTMLDivElement;
  const disasterToggle = el.querySelector('#ngc-disaster-toggle') as HTMLDivElement;
  const disasterStatus = el.querySelector('#ngc-disaster-status') as HTMLSpanElement;
  const freqRow = el.querySelector('#ngc-freq-row') as HTMLDivElement;
  const freqSlider = el.querySelector('#ngc-freq') as HTMLInputElement;
  const freqVal = el.querySelector('#ngc-freq-val') as HTMLSpanElement;
  const canvas = el.querySelector('#ngc-preview') as HTMLCanvasElement;
  const seedDisplay = el.querySelector('#ngc-seed-display') as HTMLDivElement;

  // --- Label maps ---
  const WATER_LABELS = ['Low', 'Medium', 'High', 'Very High'] as const;
  const WATER_VALUES = ['low', 'medium', 'high', 'very_high'] as const;
  const FOREST_LABELS = ['Sparse', 'Normal', 'Dense'] as const;
  const FOREST_VALUES = ['sparse', 'normal', 'dense'] as const;
  const FREQ_LABELS = ['Low', 'Medium', 'High'] as const;
  const FREQ_VALUES = ['low', 'medium', 'high'] as const;

  /**
   * Read a slider position out of one of the tables above.
   *
   * The sliders carry min/max attributes, so in practice `i` is in range — but
   * an out-of-range or NaN index silently wrote `undefined` into the config,
   * and a config with `waterAmount: undefined` reaches the terrain generator
   * rather than being rejected.
   */
  function pick<T extends readonly string[]>(table: T, i: number): T[number] {
    const clamped = Number.isFinite(i) ? Math.min(table.length - 1, Math.max(0, i)) : 0;
    return table[clamped] as T[number];
  }

  // --- Helpers ---
  function updatePreview() {
    seedDisplay.textContent = `Seed: ${config.seed}`;
    renderMapPreview(canvas, config);
  }

  function rollSeed(): number {
    return Math.floor(Math.random() * 2147483646) + 1;
  }

  // --- Initial state ---
  seedInput.value = String(config.seed);
  updatePreview();

  // --- Event handlers ---
  seedInput.addEventListener('change', () => {
    const v = parseInt(seedInput.value, 10);
    if (v > 0 && v < 2147483647) {
      config.seed = v;
      updatePreview();
    }
  });

  diceBtn.addEventListener('click', () => {
    config.seed = rollSeed();
    seedInput.value = String(config.seed);
    updatePreview();
  });

  waterSlider.addEventListener('input', () => {
    const i = parseInt(waterSlider.value, 10);
    waterVal.textContent = pick(WATER_LABELS, i);
    config.waterAmount = pick(WATER_VALUES, i);
    updatePreview();
  });

  forestSlider.addEventListener('input', () => {
    const i = parseInt(forestSlider.value, 10);
    forestVal.textContent = pick(FOREST_LABELS, i);
    config.forestDensity = pick(FOREST_VALUES, i);
    updatePreview();
  });

  fundsGroup.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const val = btn.dataset.val as MapConfig['startingFunds'];
    config.startingFunds = val;
    fundsGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  disasterToggle.addEventListener('click', () => {
    config.disastersEnabled = !config.disastersEnabled;
    disasterToggle.classList.toggle('on', config.disastersEnabled);
    disasterStatus.textContent = config.disastersEnabled ? 'On' : 'Off';
    freqRow.classList.toggle('hidden', !config.disastersEnabled);
  });

  freqSlider.addEventListener('input', () => {
    const i = parseInt(freqSlider.value, 10);
    freqVal.textContent = pick(FREQ_LABELS, i);
    config.disasterFrequency = pick(FREQ_VALUES, i);
  });

  el.querySelector('#ngc-back')!.addEventListener('click', onBack);
  el.querySelector('#ngc-start')!.addEventListener('click', () => onStart(config));

  return el;
}
