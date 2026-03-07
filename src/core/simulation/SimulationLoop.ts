import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';

export class SimulationLoop {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  tick(): void {
    if (!this.state.clock.advance()) return;

    // 1. Economy / Budget
    this.state.budget = tickBudget(this.state.budget);

    // 2. Services (power/water coverage)
    this.state.power.calculateCoverage(this.state.grid);
    this.state.water.calculateCoverage(this.state.grid);

    // 3. Citizens aging
    this.state.citizens.ageTick();

    // 4. Traffic
    this.state.traffic.tick();
  }

  getState(): GameState {
    return this.state;
  }
}
