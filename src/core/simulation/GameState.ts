import { Grid } from '../grid/Grid';
import { RoadNetwork } from '../road/RoadNetwork';
import { CitizenManager } from '../citizen/CitizenManager';
import { TrafficSimulation } from '../traffic/TrafficSimulation';
import { PowerGrid } from '../service/PowerGrid';
import { WaterNetwork } from '../service/WaterNetwork';
import { GameClock } from './GameClock';
import { type BudgetState } from '../economy/Budget';
import { type TaxRates, DEFAULT_TAX_RATES } from '../economy/Tax';

export interface GameState {
  grid: Grid;
  roadNetwork: RoadNetwork;
  citizens: CitizenManager;
  traffic: TrafficSimulation;
  power: PowerGrid;
  water: WaterNetwork;
  clock: GameClock;
  budget: BudgetState;
  taxRates: TaxRates;
}

export function createGameState(width = 200, height = 200): GameState {
  return {
    grid: new Grid(width, height),
    roadNetwork: new RoadNetwork(),
    citizens: new CitizenManager(),
    traffic: new TrafficSimulation(),
    power: new PowerGrid(),
    water: new WaterNetwork(),
    clock: new GameClock(),
    budget: {
      funds: 50000,
      income: 0,
      expenses: 0,
      loans: 0,
      loanInterestRate: 0.05,
    },
    taxRates: { ...DEFAULT_TAX_RATES },
  };
}
