/**
 * 展示區的控制面板。刻意用原生 DOM 而不是 Solid：展示區不該把遊戲的 UI
 * 相依帶進來，它要能在遊戲壞掉的時候仍然打得開。
 */
import { densityFor, type ViewMode } from './views';
import { VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { ZONE_TYPES, LEVELS, type Density }
  from '../renderer/geometry/buildings/registry';
import { civicOptions } from './civic';
import type { InfraType } from '../core/building/InfraConfig';

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
  /**
   * 住戶／使用率 0..1 —— 夜裡有多少比例的窗戶與招牌會亮。
   *
   * 遊戲裡這個值來自 `SimulationLoop` 的實際住戶數；展示區沒有模擬，所以
   * 由這根滑桿頂替。0 就是空屋（燒毀與廢棄的建築也是這個值）。
   */
  occupancy: number;
  wireframe: boolean;
  /** 街廓邊長。量效能基準時調大。 */
  blockSize: number;
  /**
   * 三個附掛層各自的開關。
   *
   * 分開而不是一個「地面物件」總開關：三層的放置限制完全不同（貼片可以鋪到
   * 格子邊界、矮物件不能越過行人包絡線、懸挑要高過人頭），驗收時要能單獨
   * 看出每一層的貢獻，否則「哪一層的東西跑錯位置」只能用猜的。
   */
  showDecals: boolean;
  showLowProps: boolean;
  showOverhead: boolean;
  /**
   * 單體模式要看哪一個變體；null = 照雜湊。
   *
   * 逐一檢查八個變體是驗收的主要動作（「兩兩不得長一樣」），靠重擲種子撞出
   * 全部八個太慢。
   */
  variantOverride: number | null;
  /**
   * `civic` 模式要看哪一種公共建築。
   *
   * `null` 表示還沒有任何一種改造完成 —— 選單會是空的，而畫面是空地。
   * 那是正確的狀態，不是壞掉（見 `civicOptions`）。
   */
  civicType: InfraType | null;
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
   * 只在分區建築的模式下有意義的控制項。`civic` 模式下整組藏起來。
   *
   * 收在這裡而不是各自記一個變數：漏掉一個的話它會孤零零地留在面板上，
   * 而使用者會花時間找「為什麼把等級調到 3 警局沒有變高」。
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
    civicLabel.style.display = civic ? '' : 'none';
    civicSel.style.display = civic ? '' : 'none';
  };
  modeSel.onchange = () => {
    state.mode = modeSel.value as ViewMode;
    syncModeVisibility();
    onChange();
  };

  const civicLabel = document.createElement('label');
  civicLabel.textContent = '公共建築';
  const civicSel = document.createElement('select');
  const options = civicOptions();
  if (options.length === 0) {
    const o = document.createElement('option');
    o.textContent = '（還沒有改造完成的種類）';
    civicSel.appendChild(o);
    civicSel.disabled = true;
  }
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.type;
    o.textContent = opt.label;
    civicSel.appendChild(o);
  }
  state.civicType = options[0]?.type ?? null;
  civicSel.onchange = () => {
    state.civicType = civicSel.value as InfraType;
    onChange();
  };
  host.appendChild(civicLabel);
  host.appendChild(civicSel);

  const zoneSel = document.createElement('select');
  for (const z of ZONE_TYPES) {
    const o = document.createElement('option');
    o.value = String(z);
    o.textContent = ZONE_NAMES[z] ?? String(z);
    zoneSel.appendChild(o);
  }
  zoneSel.value = String(state.zoneType);
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

  /**
   * 這個分區沒有的密度要換掉。
   *
   * **必須在重繪之前跑。** 以前它是掛在 `zoneSel` 上的第二個 change 監聽器，
   * 而第一個（`onchange` 屬性）已經先呼叫過 `onChange()` —— 所以切到住宅高
   * 的那一次是用上一個分區的密度重繪的，而 `getMassingVariants(2, 'LOW', …)`
   * 回傳空陣列，畫面上什麼都沒有（BUG-227）。
   *
   * 階段 2C-1 之前 `getVariants` 根本不看密度，所以這個順序錯誤看不出來。
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

  // 住戶比例。夜景要調的就是它 —— 白天完全看不出差別，所以標籤寫清楚。
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

  // **必須在所有 row() 之後。** 它讀的是 `zoneOnly`，而那份清單是 row()
  // 一路累積起來的 —— 提前呼叫只會藏到當下已經建好的那幾個。
  syncModeVisibility();
}
