import type { GameState } from './GameState';
import type { GameSpeed } from './GameClock';

export interface DebugSnapshot {
  tick: number;
  funds: number;
  income: number;
  expenses: number;
  population: number;
  vehicleCount: number;
  buildingCount: number;
  infraCount: number;
  roadCount: number;
  rciDemand: { r: number; c: number; i: number };
  powerSupply: number;
  waterSupply: number;
  avgHappiness: number;
  avgLandValue: number;
  avgPollution: number;
  taxRate: number;
  speed: number;
}

export interface ModifiableParam {
  name: string;
  type: 'number';
  value: number;
  min?: number;
  max?: number;
}

export class DebugTools {
  constructor(private state: GameState) {}

  getSnapshot(): DebugSnapshot {
    const { grid, citizens, traffic, power, water, budget, taxRates, rciDemand, clock } = this.state;

    let buildingCount = 0;
    let infraCount = 0;
    let roadCount = 0;
    let totalLandValue = 0;
    let totalPollution = 0;
    let cellCount = 0;

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        cellCount++;
        if (cell.buildingId > 0 && cell.buildingId < 243) buildingCount++;
        if (cell.buildingId >= 243) infraCount++;
        if (cell.roadType > 0) roadCount++;
        totalLandValue += cell.landValue;
        totalPollution += cell.pollution;
      }
    }

    const pop = citizens.citizens.length;
    const avgHappiness = pop > 0
      ? Math.round(citizens.citizens.reduce((sum, c) => sum + (c.happiness ?? 0), 0) / pop)
      : 0;

    const powerSupply = power.getPlants().reduce((sum, p) => sum + p.output, 0);
    const waterSupply = water.getPlants().reduce((sum, p) => sum + p.output, 0);

    return {
      tick: clock.tick,
      funds: budget.funds,
      income: budget.income,
      expenses: budget.expenses,
      population: pop,
      vehicleCount: traffic.vehicles.length,
      buildingCount,
      infraCount,
      roadCount,
      rciDemand: { r: rciDemand.residential, c: rciDemand.commercial, i: rciDemand.industrial },
      powerSupply,
      waterSupply,
      avgHappiness,
      avgLandValue: cellCount > 0 ? Math.round(totalLandValue / cellCount) : 0,
      avgPollution: cellCount > 0 ? Math.round(totalPollution / cellCount) : 0,
      taxRate: taxRates.residential,
      speed: clock.speed,
    };
  }

  setFunds(value: number): void {
    this.state.budget.funds = value;
  }

  setSpeed(value: number): void {
    this.state.clock.setSpeed(Math.max(1, Math.min(3, value)) as GameSpeed);
  }

  getModifiableParams(): ModifiableParam[] {
    const { budget, taxRates, clock } = this.state;
    return [
      { name: 'funds', type: 'number', value: budget.funds, min: 0, max: 99999999 },
      { name: 'speed', type: 'number', value: clock.speed, min: 1, max: 3 },
      { name: 'taxRate', type: 'number', value: taxRates.residential, min: 0, max: 30 },
    ];
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'funds':
        this.state.budget.funds = value;
        break;
      case 'speed':
        this.setSpeed(value);
        break;
      case 'taxRate':
        this.state.taxRates.residential = value;
        this.state.taxRates.commercial = value;
        this.state.taxRates.industrial = value;
        this.state.taxRates.office = value;
        break;
    }
  }
}
