/**
 * 展示區的控制面板。刻意用原生 DOM 而不是 Solid：展示區不該把遊戲的 UI
 * 相依帶進來，它要能在遊戲壞掉的時候仍然打得開。
 */
import { densityFor, type ViewMode } from './views';
import { VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { ZONE_TYPES, LEVELS, type Density }
  from '../renderer/geometry/buildings/registry';

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
  /** 陰影：接收面沿法線推出去的距離（世界單位）。 */
  shadowNormalBias: number;
  /** 陰影：深度空間的偏移。負值。 */
  shadowBias: number;
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
}

const ZONE_NAMES: Record<number, string> = {
  1: '住宅低密度', 2: '住宅高密度', 3: '商業低密度',
  4: '商業高密度', 5: '工業', 6: '辦公',
};

const MODE_NAMES: Record<ViewMode, string> = {
  single: '單體', block: '街廓', matrix: '矩陣',
};

/**
 * 兩根 bias 滑桿的刻度。
 *
 * 滑桿只吃整數，而這兩個值一個是 1e-3、一個是 1e-5 的量級 —— 所以用「格數
 * × 單位」而不是直接餵浮點數，否則 step 會被瀏覽器的浮點誤差咬到。
 * `shadowBias` 是負的，單位就取負值。
 */
const SHADOW_KNOBS = [
  { key: 'shadowNormalBias' as const, label: '陰影 normalBias', unit: 0.001, steps: 30 },
  { key: 'shadowBias' as const, label: '陰影 bias', unit: -0.00002, steps: 30 },
];

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

  // 陰影的兩個 bias。這兩個值只能用眼睛決定：調小陰影會貼回物體底部，
  // 調大則地面不會長出自我遮蔽的條紋（acne），而兩者的交界點沒有公式 ——
  // 它取決於陰影貼圖一個 texel 有多大，而那又隨縮放變。放在這裡是因為
  // 展示區可以一邊拖一邊看（BUG-234）。
  for (const knob of SHADOW_KNOBS) {
    const label = document.createElement('label');
    const text = () => `${knob.label} ${state[knob.key].toExponential(1)}`;
    label.textContent = text();
    host.appendChild(label);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(knob.steps);
    input.step = '1';
    input.value = String(Math.round(state[knob.key] / knob.unit));
    input.oninput = () => {
      state[knob.key] = Number(input.value) * knob.unit;
      label.textContent = text();
      onChange();
    };
    host.appendChild(input);
  }

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
}
