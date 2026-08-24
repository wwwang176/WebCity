/**
 * The showcase's control panel. Deliberately plain DOM rather than Solid: the showcase must not pull
 * in the game's UI dependencies, so that it still opens when the game is broken.
 */
import { densityFor, type ViewMode } from './views';
import { VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { ZONE_TYPES, LEVELS, type Density }
  from '../renderer/geometry/buildings/registry';

/** Turns a 0..1 position in the day into a 24-hour label, so the slider can say what time it is on. */
function clockText(t: number): string {
  const minutes = Math.round(t * 24 * 60);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface ControlState {
  mode: ViewMode;
  zoneType: number;
  density: Density;
  level: number;
  seedByte: number;
  /** A manually set position in the day, 0..1; null means the automatic cycle. */
  timeOverride: number | null;
  /**
   * Occupancy, 0..1: the share of windows and signs lit at night.
   *
   * In game the value comes from `SimulationLoop`'s actual occupancy; the showcase has no simulation
   * and this slider stands in for it. 0 is an empty building, the value burned and abandoned
   * buildings also carry.
   */
  occupancy: number;
  wireframe: boolean;
  /** The block's edge length. Raised when measuring performance. */
  blockSize: number;
  /**
   * One switch per attachment layer.
   *
   * Separate rather than a single "ground objects" switch: the three have entirely different
   * placement limits — decals may reach the cell boundary, ground props may not cross the pedestrian
   * envelope, overhangs have to clear head height — and reviewing means seeing each layer's
   * contribution on its own, or which layer's object is misplaced is guesswork.
   */
  showDecals: boolean;
  showLowProps: boolean;
  showOverhead: boolean;
  /**
   * Which variant the single-building mode shows; null follows the hash.
   *
   * Stepping through all eight variants is the main reviewing action, since no two may look alike,
   * and rerolling the seed until all eight turn up is too slow.
   */
  variantOverride: number | null;
}

const ZONE_NAMES: Record<number, string> = {
  1: '住宅低密度', 2: '住宅高密度', 3: '商業低密度',
  4: '商業高密度', 5: '工業', 6: '辦公',
};

const MODE_NAMES: Record<ViewMode, string> = {
  single: '單體', block: '街廓', matrix: '矩陣', civic: '公共建築',
};

export function mountControls(
  host: HTMLElement, state: ControlState, onChange: () => void,
): void {
  host.innerHTML = '';

  /**
   * The controls that mean something only in the zoned-building modes, hidden as a group in `civic`
   * mode.
   *
   * Collected here rather than tracked one variable each: a missed one is left alone on the panel,
   * and the user spends time working out why raising the level to 3 does not make the police station
   * taller.
   */
  const zoneOnly: HTMLElement[] = [];

  const row = (label: string, el: HTMLElement, zoneSpecific = true) => {
    const l = document.createElement('label');
    l.textContent = label;
    host.appendChild(l);
    host.appendChild(el);
    if (zoneSpecific) zoneOnly.push(l, el);
  };

  const modeSel = document.createElement('select');
  for (const m of ['single', 'block', 'matrix', 'civic'] as ViewMode[]) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = MODE_NAMES[m];
    modeSel.appendChild(o);
  }
  modeSel.value = state.mode;
  row('檢視模式', modeSel, false);

  const syncModeVisibility = () => {
    const civic = state.mode === 'civic';
    for (const el of zoneOnly) el.style.display = civic ? 'none' : '';
  };
  modeSel.onchange = () => {
    state.mode = modeSel.value as ViewMode;
    syncModeVisibility();
    onChange();
  };

  const zoneSel = document.createElement('select');
  for (const z of ZONE_TYPES) {
    const o = document.createElement('option');
    o.value = String(z);
    o.textContent = ZONE_NAMES[z] ?? String(z);
    zoneSel.appendChild(o);
  }
  zoneSel.value = String(state.zoneType);
  row('分區', zoneSel);

  // Only offices have buildings at both densities; the other zones have no height table for the
  // second one.
  const densitySel = document.createElement('select');
  for (const d of ['LOW', 'HIGH'] as Density[]) {
    const o = document.createElement('option');
    o.value = d;
    o.textContent = d === 'LOW' ? '低密度' : '高密度';
    densitySel.appendChild(o);
  }
  densitySel.value = state.density;
  densitySel.onchange = () => { state.density = densitySel.value as Density; onChange(); };
  row('密度（僅辦公區兩者皆有）', densitySel);

  /**
   * Replaces a density the selected zone does not have.
   *
   * **It has to run before the redraw.** As a second change listener on `zoneSel` it ran after the
   * first, the `onchange` property, had already called `onChange()`: switching to high residential
   * redrew with the previous zone's density, and `getMassingVariants(2, 'LOW', ...)` returns an empty
   * array, leaving the view blank (BUG-227).
   */
  const syncDensity = () => {
    state.density = densityFor(state.zoneType, state.density);
    densitySel.value = state.density;
  };
  zoneSel.onchange = () => {
    state.zoneType = Number(zoneSel.value);
    syncDensity();
    onChange();
  };
  syncDensity();

  const levelSel = document.createElement('select');
  for (const lv of LEVELS) {
    const o = document.createElement('option');
    o.value = String(lv);
    o.textContent = `${lv} 級`;
    levelSel.appendChild(o);
  }
  levelSel.value = String(state.level);
  levelSel.onchange = () => { state.level = Number(levelSel.value); onChange(); };
  row('等級', levelSel);

  const variantSel = document.createElement('select');
  const variantOptions: Array<number | null> = [null];
  for (let v = 0; v < VARIANT_COUNT; v++) variantOptions.push(v);
  for (const v of variantOptions) {
    const o = document.createElement('option');
    o.value = v === null ? 'auto' : String(v);
    o.textContent = v === null ? '自動（依座標）' : `變體 ${v}`;
    variantSel.appendChild(o);
  }
  variantSel.value = state.variantOverride === null ? 'auto' : String(state.variantOverride);
  variantSel.onchange = () => {
    state.variantOverride = variantSel.value === 'auto' ? null : Number(variantSel.value);
    onChange();
  };
  row('變體（單體模式）', variantSel);

  const sizeSel = document.createElement('select');
  for (const n of [8, 16, 24, 40]) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n} × ${n} = ${n * n} 棟`;
    sizeSel.appendChild(o);
  }
  sizeSel.value = String(state.blockSize);
  sizeSel.onchange = () => { state.blockSize = Number(sizeSel.value); onChange(); };
  row('街廓大小（量效能用）', sizeSel);

  const timeLabel = document.createElement('label');
  timeLabel.textContent = '時刻（拖動即接管日夜）';
  host.appendChild(timeLabel);

  const time = document.createElement('input');
  time.type = 'range';
  time.min = '0';
  time.max = '1';
  time.step = '0.005';
  time.value = '0.3';
  time.oninput = () => {
    state.timeOverride = Number(time.value);
    timeLabel.textContent = `時刻 ${clockText(state.timeOverride)}`;
  };
  host.appendChild(time);

  // Occupancy, the control for night scenes. It makes no visible difference by day, so the label
  // says so.
  const occLabel = document.createElement('label');
  const occText = () => `住戶比例 ${Math.round(state.occupancy * 100)}%（夜間亮燈）`;
  occLabel.textContent = occText();
  host.appendChild(occLabel);

  const occ = document.createElement('input');
  occ.type = 'range';
  occ.min = '0';
  occ.max = '1';
  occ.step = '0.05';
  occ.value = String(state.occupancy);
  occ.oninput = () => {
    state.occupancy = Number(occ.value);
    occLabel.textContent = occText();
    onChange();
  };
  host.appendChild(occ);

  const live = document.createElement('button');
  live.textContent = '回到自動循環';
  live.onclick = () => {
    state.timeOverride = null;
    timeLabel.textContent = '時刻（自動循環中）';
  };
  host.appendChild(live);

  const reroll = document.createElement('button');
  reroll.textContent = '重新擲種子';
  reroll.onclick = () => {
    state.seedByte = (state.seedByte + 1) & 0xff;
    onChange();
  };
  host.appendChild(reroll);

  const wire = document.createElement('button');
  wire.textContent = '線框';
  wire.onclick = () => { state.wireframe = !state.wireframe; onChange(); };
  host.appendChild(wire);

  const toggles: Array<[string, 'showDecals' | 'showLowProps' | 'showOverhead']> = [
    ['貼片（鋪面）', 'showDecals'],
    ['矮物件（庭院）', 'showLowProps'],
    ['懸挑（雨遮）', 'showOverhead'],
  ];
  for (const [label, key] of toggles) {
    const btn = document.createElement('button');
    const text = () => `${label}：${state[key] ? '開' : '關'}`;
    btn.textContent = text();
    btn.onclick = () => {
      state[key] = !state[key];
      btn.textContent = text();
      onChange();
    };
    host.appendChild(btn);
  }

  const stats = document.createElement('div');
  stats.id = 'stats';
  host.appendChild(stats);

  // **It has to come after every row().** It reads `zoneOnly`, which row() accumulates, so calling
  // it earlier hides only the controls built so far.
  syncModeVisibility();
}
