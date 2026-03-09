import { describe, it, expect } from 'vitest';
import type { SimWorkerMessage, SimWorkerResponse, SimulationSnapshot } from '../simulation.worker';
import type { PathWorkerMessage, PathWorkerResponse } from '../pathfinding.worker';

describe('Simulation Worker Protocol', () => {
  it('should define INIT message type', () => {
    const msg: SimWorkerMessage = { type: 'INIT' };
    expect(msg.type).toBe('INIT');
  });

  it('should define TICK message type', () => {
    const msg: SimWorkerMessage = { type: 'TICK' };
    expect(msg.type).toBe('TICK');
  });

  it('should define PAUSE/RESUME message types', () => {
    const pause: SimWorkerMessage = { type: 'PAUSE' };
    const resume: SimWorkerMessage = { type: 'RESUME' };
    expect(pause.type).toBe('PAUSE');
    expect(resume.type).toBe('RESUME');
  });

  it('should define SET_SPEED message type', () => {
    const msg: SimWorkerMessage = { type: 'SET_SPEED', speed: 3 };
    expect(msg.speed).toBe(3);
  });

  it('should define TICK_COMPLETE response with snapshot', () => {
    const snapshot: SimulationSnapshot = {
      tick: 10,
      population: 500,
      funds: 30000,
      income: 200,
      expenses: 150,
      happiness: 70,
      rciDemand: { residential: 60, commercial: 40, industrial: 50 },
      vehicleCount: 25,
    };
    const resp: SimWorkerResponse = { type: 'TICK_COMPLETE', tick: 10, data: snapshot };
    expect(resp.type).toBe('TICK_COMPLETE');
    expect(resp.data!.population).toBe(500);
    expect(resp.data!.vehicleCount).toBe(25);
  });
});

describe('Pathfinding Worker Protocol', () => {
  it('should send FIND_PATH request with from/to coordinates', () => {
    const msg: PathWorkerMessage = {
      type: 'FIND_PATH',
      id: 1,
      from: { x: 5, y: 10 },
      to: { x: 20, y: 10 },
    };
    expect(msg.id).toBe(1);
    expect(msg.from!.x).toBe(5);
    expect(msg.to!.y).toBe(10);
  });

  it('should handle multiple concurrent path requests with unique ids', () => {
    const requests: PathWorkerMessage[] = [];
    for (let i = 0; i < 10; i++) {
      requests.push({
        type: 'FIND_PATH',
        id: i,
        from: { x: 0, y: 0 },
        to: { x: i + 1, y: 0 },
      });
    }
    expect(requests).toHaveLength(10);
    const ids = new Set(requests.map(r => r.id));
    expect(ids.size).toBe(10); // all unique
  });

  it('should define SET_GRID message for SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(100 * 100 * 12);
    const msg: PathWorkerMessage = {
      type: 'SET_GRID',
      width: 100,
      height: 100,
      gridData: sab,
    };
    expect(msg.width).toBe(100);
    expect(msg.gridData!.byteLength).toBe(120000);
  });

  it('should define PATH_RESULT response', () => {
    const resp: PathWorkerResponse = {
      type: 'PATH_RESULT',
      id: 5,
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    };
    expect(resp.path).toHaveLength(3);
    expect(resp.id).toBe(5);
  });

  it('should handle null path for unreachable destination', () => {
    const resp: PathWorkerResponse = {
      type: 'PATH_RESULT',
      id: 99,
      path: null,
    };
    expect(resp.path).toBeNull();
  });
});
