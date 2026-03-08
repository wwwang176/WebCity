import { createGameState, type GameState } from '../simulation/GameState';
import { type CellData, DEFAULT_CELL } from '../grid/types';
import { type GameSpeed } from '../simulation/GameClock';
import { type PowerPlant } from '../service/PowerGrid';
import { type WaterPlant } from '../service/WaterNetwork';
import { type Citizen } from '../citizen/types';

interface SerializedCell {
  x: number;
  y: number;
  data: Partial<CellData>;
}

interface SerializedState {
  version: 1;
  grid: {
    width: number;
    height: number;
    cells: SerializedCell[];
  };
  clock: {
    tick: number;
    speed: GameSpeed;
    paused: boolean;
  };
  budget: {
    funds: number;
    income: number;
    expenses: number;
    loans: number;
    loanInterestRate: number;
  };
  taxRates: {
    residential: number;
    commercial: number;
    industrial: number;
    office: number;
  };
  powerPlants?: PowerPlant[];
  waterPlants?: WaterPlant[];
  citizens?: Citizen[];
}

function isCellDefault(cell: CellData): boolean {
  return (
    cell.terrainType === DEFAULT_CELL.terrainType &&
    cell.zoneType === DEFAULT_CELL.zoneType &&
    cell.buildingId === DEFAULT_CELL.buildingId &&
    cell.roadFlags === DEFAULT_CELL.roadFlags &&
    cell.roadType === DEFAULT_CELL.roadType &&
    cell.trafficDensity === DEFAULT_CELL.trafficDensity &&
    cell.landValue === DEFAULT_CELL.landValue &&
    cell.pollution === DEFAULT_CELL.pollution &&
    cell.noiseLevel === DEFAULT_CELL.noiseLevel &&
    cell.serviceCoverage === DEFAULT_CELL.serviceCoverage &&
    cell.elevation === DEFAULT_CELL.elevation
  );
}

export function serializeGameState(state: GameState): string {
  const cells: SerializedCell[] = [];

  for (let y = 0; y < state.grid.height; y++) {
    for (let x = 0; x < state.grid.width; x++) {
      const cell = state.grid.getCell(x, y);
      if (cell && !isCellDefault(cell)) {
        const data: Partial<CellData> = {};
        if (cell.terrainType !== DEFAULT_CELL.terrainType) data.terrainType = cell.terrainType;
        if (cell.zoneType !== DEFAULT_CELL.zoneType) data.zoneType = cell.zoneType;
        if (cell.buildingId !== DEFAULT_CELL.buildingId) data.buildingId = cell.buildingId;
        if (cell.roadFlags !== DEFAULT_CELL.roadFlags) data.roadFlags = cell.roadFlags;
        if (cell.roadType !== DEFAULT_CELL.roadType) data.roadType = cell.roadType;
        if (cell.trafficDensity !== DEFAULT_CELL.trafficDensity) data.trafficDensity = cell.trafficDensity;
        if (cell.landValue !== DEFAULT_CELL.landValue) data.landValue = cell.landValue;
        if (cell.pollution !== DEFAULT_CELL.pollution) data.pollution = cell.pollution;
        if (cell.noiseLevel !== DEFAULT_CELL.noiseLevel) data.noiseLevel = cell.noiseLevel;
        if (cell.serviceCoverage !== DEFAULT_CELL.serviceCoverage) data.serviceCoverage = cell.serviceCoverage;
        if (cell.elevation !== DEFAULT_CELL.elevation) data.elevation = cell.elevation;
        cells.push({ x, y, data });
      }
    }
  }

  const serialized: SerializedState = {
    version: 1,
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      cells,
    },
    clock: {
      tick: state.clock.tick,
      speed: state.clock.speed,
      paused: state.clock.paused,
    },
    budget: {
      funds: state.budget.funds,
      income: state.budget.income,
      expenses: state.budget.expenses,
      loans: state.budget.loans,
      loanInterestRate: state.budget.loanInterestRate,
    },
    taxRates: {
      residential: state.taxRates.residential,
      commercial: state.taxRates.commercial,
      industrial: state.taxRates.industrial,
      office: state.taxRates.office,
    },
    powerPlants: [...state.power.getPlants()],
    waterPlants: [...state.water.getPlants()],
    citizens: state.citizens.citizens.map(c => ({ ...c })),
  };

  return JSON.stringify(serialized);
}

export function deserializeGameState(json: string): GameState {
  const saved: SerializedState = JSON.parse(json) as SerializedState;

  const state = createGameState(saved.grid.width, saved.grid.height);

  // Restore grid cells
  for (const entry of saved.grid.cells) {
    state.grid.setCell(entry.x, entry.y, entry.data);
  }

  // Restore clock
  state.clock.tick = saved.clock.tick;
  state.clock.speed = saved.clock.speed;
  state.clock.paused = saved.clock.paused;

  // Restore budget
  state.budget.funds = saved.budget.funds;
  state.budget.income = saved.budget.income;
  state.budget.expenses = saved.budget.expenses;
  state.budget.loans = saved.budget.loans;
  state.budget.loanInterestRate = saved.budget.loanInterestRate;

  // Restore tax rates
  state.taxRates.residential = saved.taxRates.residential;
  state.taxRates.commercial = saved.taxRates.commercial;
  state.taxRates.industrial = saved.taxRates.industrial;
  state.taxRates.office = saved.taxRates.office;

  // Restore power/water plants
  if (saved.powerPlants) {
    for (const p of saved.powerPlants) state.power.addPlant(p);
  }
  if (saved.waterPlants) {
    for (const p of saved.waterPlants) state.water.addPlant(p);
  }

  // Restore citizens
  if (saved.citizens) {
    for (const c of saved.citizens) state.citizens.createCitizen(c);
  }

  return state;
}
