import { createSignal, batch } from 'solid-js';
import type { Game, ToolType, SelectedBuilding } from '../../Game';
import { ViewMode } from '../../core/ViewMode';

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
const [currentOverlay, setCurrentOverlay] = createSignal('none');
const [currentRotation, setCurrentRotation] = createSignal(0);
const [rciDemand, setRciDemand] = createSignal({ residential: 0, commercial: 0, industrial: 0 });
const [viewMode, setViewMode] = createSignal<ViewMode>(ViewMode.NORMAL);
const [powerSupply, setPowerSupply] = createSignal(0);
const [powerDemand, setPowerDemand] = createSignal(0);

// --- Throttled tick signal for modal live-refresh (fixed ~6 updates/sec regardless of FPS) ---
const [tick, setTick] = createSignal(0);
let lastTickTime = 0;
const TICK_INTERVAL_MS = 160; // ~6 updates/sec

// --- Chart history (accumulated over time) ---
const CHART_MAX = 60;
const ECON_MAX = 60;
const [chartHistory, setChartHistory] = createSignal<{ pop: number[]; happiness: number[] }>({ pop: [], happiness: [] });
const [econHistory, setEconHistory] = createSignal<{ funds: number[]; income: number[]; expenses: number[] }>({ funds: [], income: [], expenses: [] });

// --- Export read-only signals for components ---
export const gameSignals = {
  date, funds, population, balance, happiness,
  currentTool, previewCost, paused, speed,
  selectedBuilding, notification, currentOverlay,
  currentRotation, rciDemand, chartHistory, econHistory,
  viewMode, tick, powerSupply, powerDemand,
};

// --- Game instance reference ---
let gameRef: Game | null = null;

export function getGame(): Game {
  if (!gameRef) throw new Error('Game not initialized');
  return gameRef;
}

// --- Initialize: wire Game's updateUI callback into Solid signals ---
export function initGameStore(game: Game): void {
  gameRef = game;

  game.setOnUIUpdate(() => {
    const state = game.getState();
    const clock = state.clock;
    const citizens = state.citizens;
    const pop = citizens.getPopulation();
    const avgHappy = pop > 0
      ? Math.round(citizens.getAverageHappiness())
      : 0;
    const bal = Math.floor(state.budget.income - state.budget.expenses);
    const overlay = (game as any).overlayRenderer?.getOverlay?.() ?? 'none';

    batch(() => {
      const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
      const seasonIdx = ['spring', 'summer', 'autumn', 'winter'].indexOf(clock.getSeason());
      setDate(`${SEASON_LABELS[seasonIdx]} · Week ${clock.getWeek() + 1}`);
      setFunds(Math.floor(state.budget.funds));
      setPopulation(pop);
      setBalance(bal);
      setHappiness(avgHappy);
      setCurrentTool(game.getToolType());
      setPreviewCost(game.previewCost);
      setPaused(game.paused);
      setSpeed(game.speed);
      setSelectedBuilding(game.getSelectedBuilding());
      setNotification(game.getNotification());
      setCurrentOverlay(overlay);
      setCurrentRotation(game.currentRotation);
      setViewMode(game.viewMode);
      setPowerSupply(state.power.getSupply());
      setPowerDemand(Math.round(state.power.getDemand()));
      if (state.rciDemand) {
        setRciDemand({
          residential: state.rciDemand.residential,
          commercial: state.rciDemand.commercial,
          industrial: state.rciDemand.industrial,
        });
      }

      // Accumulate chart history
      const prevChart = chartHistory();
      const newPop = [...prevChart.pop, pop];
      const newHappiness = [...prevChart.happiness, avgHappy > 0 ? avgHappy : 50];
      if (newPop.length > CHART_MAX) { newPop.shift(); newHappiness.shift(); }
      setChartHistory({ pop: newPop, happiness: newHappiness });

      const prevEcon = econHistory();
      const newFunds = [...prevEcon.funds, state.budget.funds];
      const newIncome = [...prevEcon.income, state.budget.income];
      const newExpenses = [...prevEcon.expenses, state.budget.expenses];
      if (newFunds.length > ECON_MAX) { newFunds.shift(); newIncome.shift(); newExpenses.shift(); }
      setEconHistory({ funds: newFunds, income: newIncome, expenses: newExpenses });

      // Throttled tick for modal live-refresh (time-based, FPS-independent)
      const now = performance.now();
      if (now - lastTickTime >= TICK_INTERVAL_MS) {
        lastTickTime = now;
        setTick(t => t + 1);
      }
    });
  });
}
