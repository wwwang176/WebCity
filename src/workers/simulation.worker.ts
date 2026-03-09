/**
 * Simulation Worker — runs SimulationLoop in a separate thread.
 *
 * Communication protocol:
 * Main → Worker:
 *   { type: 'INIT', state: serialized GameState }
 *   { type: 'TICK' }
 *   { type: 'PAUSE' }
 *   { type: 'RESUME' }
 *   { type: 'SET_SPEED', speed: number }
 *
 * Worker → Main:
 *   { type: 'TICK_COMPLETE', tick: number, data: SimulationSnapshot }
 *   { type: 'READY' }
 */

export interface SimWorkerMessage {
  type: 'INIT' | 'TICK' | 'PAUSE' | 'RESUME' | 'SET_SPEED';
  state?: string; // serialized state for INIT
  speed?: number;
}

export interface SimWorkerResponse {
  type: 'READY' | 'TICK_COMPLETE' | 'ERROR';
  tick?: number;
  data?: SimulationSnapshot;
  error?: string;
}

export interface SimulationSnapshot {
  tick: number;
  population: number;
  funds: number;
  income: number;
  expenses: number;
  happiness: number;
  rciDemand: { residential: number; commercial: number; industrial: number };
  vehicleCount: number;
}

let running = false;
let tickInterval = 250; // ms between ticks
let intervalId: ReturnType<typeof setInterval> | null = null;
let currentTick = 0;

// In a full implementation, this would import SimulationLoop and GameState.
// For now, this worker handles message protocol and tick scheduling.

self.onmessage = (e: MessageEvent<SimWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'INIT': {
      currentTick = 0;
      running = false;
      (self as unknown as Worker).postMessage({ type: 'READY' } satisfies SimWorkerResponse);
      break;
    }

    case 'TICK': {
      // Single tick execution
      currentTick++;
      const snapshot: SimulationSnapshot = {
        tick: currentTick,
        population: 0,
        funds: 0,
        income: 0,
        expenses: 0,
        happiness: 0,
        rciDemand: { residential: 50, commercial: 50, industrial: 50 },
        vehicleCount: 0,
      };
      (self as unknown as Worker).postMessage({
        type: 'TICK_COMPLETE',
        tick: currentTick,
        data: snapshot,
      } satisfies SimWorkerResponse);
      break;
    }

    case 'PAUSE': {
      running = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      break;
    }

    case 'RESUME': {
      running = true;
      if (intervalId === null) {
        intervalId = setInterval(() => {
          if (!running) return;
          currentTick++;
          (self as unknown as Worker).postMessage({
            type: 'TICK_COMPLETE',
            tick: currentTick,
            data: {
              tick: currentTick,
              population: 0,
              funds: 0,
              income: 0,
              expenses: 0,
              happiness: 0,
              rciDemand: { residential: 50, commercial: 50, industrial: 50 },
              vehicleCount: 0,
            },
          } satisfies SimWorkerResponse);
        }, tickInterval);
      }
      break;
    }

    case 'SET_SPEED': {
      if (msg.speed && msg.speed > 0) {
        tickInterval = Math.max(50, 250 / msg.speed);
        // Restart interval if running
        if (running && intervalId !== null) {
          clearInterval(intervalId);
          intervalId = setInterval(() => {
            if (!running) return;
            currentTick++;
            (self as unknown as Worker).postMessage({
              type: 'TICK_COMPLETE',
              tick: currentTick,
              data: {
                tick: currentTick,
                population: 0,
                funds: 0,
                income: 0,
                expenses: 0,
                happiness: 0,
                rciDemand: { residential: 50, commercial: 50, industrial: 50 },
                vehicleCount: 0,
              },
            } satisfies SimWorkerResponse);
          }, tickInterval);
        }
      }
      break;
    }
  }
};
