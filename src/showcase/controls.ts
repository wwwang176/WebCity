/**
 * 展示區的控制面板。刻意用原生 DOM 而不是 Solid：展示區不該把遊戲的 UI
 * 相依帶進來，它要能在遊戲壞掉的時候仍然打得開。
 */
import type { ViewMode } from './views';
import { ZONE_TYPES, LEVELS } from '../renderer/geometry/buildings/registry';

export interface ControlState {
  mode: ViewMode;
  zoneType: number;
  level: number;
  seedByte: number;
  /** 手動覆寫的時間；null 表示跟著實時流動。 */
  timeOverride: number | null;
  wireframe: boolean;
  /** 街廓邊長。量效能基準時調大。 */
  blockSize: number;
}

const ZONE_NAMES: Record<number, string> = {
  1: '住宅低密度', 2: '住宅高密度', 3: '商業低密度',
  4: '商業高密度', 5: '工業', 6: '辦公',
};

const MODE_NAMES: Record<ViewMode, string> = {
  single: '單體', block: '街廓', matrix: '矩陣',
};

export function mountControls(
  host: HTMLElement, state: ControlState, onChange: () => void,
): void {
  host.innerHTML = '';

  const row = (label: string, el: HTMLElement) => {
    const l = document.createElement('label');
    l.textContent = label;
    host.appendChild(l);
    host.appendChild(el);
  };

  const modeSel = document.createElement('select');
  for (const m of ['single', 'block', 'matrix'] as ViewMode[]) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = MODE_NAMES[m];
    modeSel.appendChild(o);
  }
  modeSel.value = state.mode;
  modeSel.onchange = () => { state.mode = modeSel.value as ViewMode; onChange(); };
  row('檢視模式', modeSel);

  const zoneSel = document.createElement('select');
  for (const z of ZONE_TYPES) {
    const o = document.createElement('option');
    o.value = String(z);
    o.textContent = ZONE_NAMES[z] ?? String(z);
    zoneSel.appendChild(o);
  }
  zoneSel.value = String(state.zoneType);
  zoneSel.onchange = () => { state.zoneType = Number(zoneSel.value); onChange(); };
  row('分區', zoneSel);

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

  const time = document.createElement('input');
  time.type = 'range';
  time.min = '0';
  time.max = '600';
  time.step = '1';
  time.value = '0';
  time.oninput = () => { state.timeOverride = Number(time.value); };
  row('時間（拖動即接管日夜）', time);

  const live = document.createElement('button');
  live.textContent = '回到實時';
  live.onclick = () => { state.timeOverride = null; };
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

  const stats = document.createElement('div');
  stats.id = 'stats';
  host.appendChild(stats);
}
