/**
 * 展示區的控制面板。刻意用原生 DOM 而不是 Solid：展示區不該把遊戲的 UI
 * 相依帶進來，它要能在遊戲壞掉的時候仍然打得開。
 */
import type { ViewMode } from './views';
import {
  ZONE_TYPES, LEVELS, TARGET_HEIGHTS_M, heightKey, type Density,
} from '../renderer/geometry/buildings/registry';

/** 0..1 的一天位置轉成 24 小時字面，滑桿才知道自己拖到幾點。 */
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
  /** 手動指定的一天位置 0..1；null 表示自動循環。 */
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

  // 只有辦公區兩種密度都有建築；其他分區選了也沒有對應的高度表。
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

  const syncDensity = () => {
    if (!TARGET_HEIGHTS_M[heightKey(state.zoneType, state.density)]) {
      state.density = TARGET_HEIGHTS_M[heightKey(state.zoneType, 'LOW')] ? 'LOW' : 'HIGH';
      densitySel.value = state.density;
    }
  };
  zoneSel.addEventListener('change', syncDensity);
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

  const stats = document.createElement('div');
  stats.id = 'stats';
  host.appendChild(stats);
}
