import { createSignal, batch } from 'solid-js';
import type { Game, ToolType, SelectedBuilding, PlacementMode } from '../../Game';
import { ViewMode } from '../../core/ViewMode';
import {
  emptyChartHistory, appendChartDay, type ChartHistory,
} from '../../core/economy/ChartSeries';
import { Season } from '../../core/climate/Climate';
import { OverlayType } from '../../renderer/OverlayRenderer';
import { calculateBalance } from '../../core/economy/Budget';
import type { DistrictPaintMode } from '../../core/district/DistrictPaint';

// --- High-frequency signals (updated every updateUI call) ---
const [date, setDate] = createSignal('Day 1');
const [funds, setFunds] = createSignal(50000);
const [population, setPopulation] = createSignal(0);
const [balance, setBalance] = createSignal(0);
const [happiness, setHappiness] = createSignal(0);
const [currentTool, setCurrentTool] = createSignal<ToolType>('select');
const [previewCost, setPreviewCost] = createSignal<number | null>(null);
const [paused, setPaused] = createSignal(false);
const [speed, setSpeed] = createSignal(1);
const [selectedBuilding, setSelectedBuilding] = createSignal<SelectedBuilding | null>(null);
const [notification, setNotification] = createSignal<string | null>(null);
const [currentOverlay, setCurrentOverlay] = createSignal<string>(OverlayType.NONE);
const [currentRotation, setCurrentRotation] = createSignal(0);
const [rciDemand, setRciDemand] = createSignal({ residential: 0, commercial: 0, industrial: 0 });
const [viewMode, setViewMode] = createSignal<ViewMode>(ViewMode.NORMAL);
const [powerSupply, setPowerSupply] = createSignal(0);
const [powerDemand, setPowerDemand] = createSignal(0);
const [placementMode, setPlacementMode] = createSignal<PlacementMode>('ground');
const [elevationLevel, setElevationLevel] = createSignal(1);
const [selectedTransferRoute, setSelectedTransferRoute] = createSignal<string | null>(null);
const [selectedCitizenId, setSelectedCitizenId] = createSignal<number | null>(null);
const [districtPaintMode, setDistrictPaintMode] = createSignal<DistrictPaintMode>('add');
const [activeDistrictId, setActiveDistrictId] = createSignal<string | null>(null);

// --- Throttled tick signal for modal live-refresh (fixed ~6 updates/sec regardless of FPS) ---
const [tick, setTick] = createSignal(0);
let lastTickTime = 0;
const TICK_INTERVAL_MS = 160; // ~6 updates/sec
/** 同一天之內，最後那一筆最多多久更新一次。 */
let lastChartSampleTime = 0;

// --- Chart history ---
//
// 一天一筆，不是一幀一筆。原本是每次 UI 更新就 append，於是六十個點一秒就跑完，
// 而那個速度只反映了 FPS 跟遊戲速度，不是玩家看得懂的時間。
const [chartHistory, setChartHistory] = createSignal<ChartHistory>(emptyChartHistory());
/** 上一次記錄的是哪一天。同一天之內只覆蓋最後一筆。 */
let lastChartDay = -1;

// --- Export read-only signals for components ---
export const gameSignals = {
  date, funds, population, balance, happiness,
  currentTool, previewCost, paused, speed,
  selectedBuilding, notification, currentOverlay,
  currentRotation, rciDemand, chartHistory,
  viewMode, tick, powerSupply, powerDemand, placementMode, elevationLevel, selectedTransferRoute,
  selectedCitizenId, setSelectedCitizenId,
  districtPaintMode, activeDistrictId,
};

// --- Game instance reference ---
let gameRef: Game | null = null;
let lastSelKey: string | null = null;

export function getGame(): Game {
  if (!gameRef) throw new Error('Game not initialized');
  return gameRef;
}

// --- Initialize: wire Game's updateUI callback into Solid signals ---
export function initGameStore(game: Game): void {
  gameRef = game;

  // 圖表歷史是模組層級的，而載入存檔與開新遊戲**不會重新載入頁面** —— `main.ts`
  // 直接 `new Game` 再呼叫這裡。不清掉的話新城市會繼承上一座城市的人口與資金曲線，
  // 而且 `lastChartDay` 停在舊的天數:新局從第 0 天開始，那一筆會接在第 47 天後面，
  // 時間軸就不再是遞增的（提示會說最新的那一根是「Day 0」）。
  setChartHistory(emptyChartHistory());
  lastChartDay = -1;

  game.setOnUIUpdate(() => {
    const state = game.getState();
    const clock = state.clock;
    const citizens = state.citizens;
    const pop = citizens.getPopulation();
    const avgHappy = pop > 0
      ? Math.round(citizens.getAverageHappiness())
      : 0;
    // Must use the same formula tickBudget applies to funds. `income - expenses`
    // omits loan interest, so after borrowing the top bar could show a green
    // positive balance while the treasury drained every tick (BUG-078).
    const bal = Math.floor(calculateBalance(state.budget));
    const overlay = (game as any).overlayRenderer?.getOverlay?.() ?? OverlayType.NONE;

    batch(() => {
      const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
      const seasonIdx = [Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER].indexOf(clock.getSeason());
      setDate(`${SEASON_LABELS[seasonIdx]} · Week ${clock.getWeek() + 1}`);
      setFunds(Math.floor(state.budget.funds));
      setPopulation(pop);
      setBalance(bal);
      setHappiness(avgHappy);
      setCurrentTool(game.getToolType());
      setPreviewCost(game.previewCost);
      setPaused(game.paused);
      setSpeed(game.speed);
      // Only update selectedBuilding signal when identity changes (not every frame)
      const selKey = game.getSelectedBuildingKey();
      if (selKey !== lastSelKey) {
        lastSelKey = selKey;
        setSelectedBuilding(game.getSelectedBuilding());
        setSelectedCitizenId(null); // clear citizen when building changes
      }
      setNotification(game.getNotification());
      setCurrentOverlay(overlay);
      setCurrentRotation(game.currentRotation);
      setViewMode(game.viewMode);
      setPowerSupply(state.power.getSupply());
      setPowerDemand(Math.round(state.power.getDemand()));
      setPlacementMode(game.getPlacementMode());
      setDistrictPaintMode(game.districtPaintMode);
      setActiveDistrictId(game.activeDistrictId);
      setElevationLevel(game.getElevationLevel());
      setSelectedTransferRoute(game.getSelectedTransferRoute());
      if (state.rciDemand) {
        setRciDemand({
          residential: state.rciDemand.residential,
          commercial: state.rciDemand.commercial,
          industrial: state.rciDemand.industrial,
        });
      }

      // 圖表:一天一筆。同一天之內只更新最後那一筆，所以進行中的那一天也是活的。
      const day = clock.getDay();
      const sample = {
        pop,
        happiness: avgHappy > 0 ? avgHappy : 50,
        funds: state.budget.funds,
        income: state.budget.income,
        expenses: state.budget.expenses,
      };
      if (day !== lastChartDay) {
        lastChartDay = day;
        setChartHistory(h => appendChartDay(h, day, sample));
      } else {
        // 同一天內每秒最多改六次。每一幀都重建一次三百多天的陣列是白花的。
        const now = performance.now();
        if (now - lastChartSampleTime >= TICK_INTERVAL_MS) {
          lastChartSampleTime = now;
          setChartHistory(h => appendChartDay(h, day, sample));
        }
      }

      // Throttled tick for modal live-refresh (time-based, FPS-independent)
      const now = performance.now();
      if (now - lastTickTime >= TICK_INTERVAL_MS) {
        lastTickTime = now;
        setTick(t => t + 1);
      }
    });
  });
}
