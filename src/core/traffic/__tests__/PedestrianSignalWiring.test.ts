import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { PedestrianState } from '../PedestrianAgent';

/**
 * PedestrianManager was constructed in createGameState with a THROWAWAY
 * SidewalkGraph and no lights at all, and no setter existed — so
 * canPassCrosswalk's `if (!this.trafficLights) return true` made
 * PedestrianState.WAITING_SIGNAL unreachable in the shipped game. Every
 * pedestrian crossed on red, in every phase. Exactly the defect BUG-105 fixed
 * for level crossings, one layer over (BUG-113).
 *
 * The reason it survived so long — and the reason the commit that claimed to
 * fix it shipped without the fix — is that every existing test injects the
 * lights through the CONSTRUCTOR, which is the path production never used:
 * `new PedestrianManager(graph, blockedLight)` passes with the defect fully
 * present. These build the manager the way the game does, through
 * createGameState, and then watch a pedestrian meet a red light.
 */
function signalisedCity() {
  const state = createGameState(20, 20);
  const rb = new RoadBuilder(state.grid);
  // A crossroads at (10,10).
  rb.buildRoad({ x: 4, y: 10 }, { x: 16, y: 10 }, RoadType.TWO_LANE, 1e6);
  rb.buildRoad({ x: 10, y: 4 }, { x: 10, y: 16 }, RoadType.TWO_LANE, 1e6);
  // Buildings at each end: spawnPedestrian routes entrance-to-entrance, so
  // without them there is no path and the agent is never created.
  state.grid.setCell(5, 9, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(15, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

  const roadCellKeys: string[] = [];
  const buildingCellKeys: string[] = [];
  state.grid.forEachCell((cell, x, y) => {
    if (cell.roadType !== RoadType.NONE) roadCellKeys.push(`${x},${y}`);
    else if (cell.buildingId !== 0) buildingCellKeys.push(`${x},${y}`);
  });
  state.sidewalkGraph.buildFromGrid({
    getCell: (gx: number, gy: number) => {
      const c = state.grid.getCell(gx, gy);
      if (!c) return null;
      return { roadType: c.roadType, roadFlags: c.roadFlags, railType: c.railType, buildingId: c.buildingId };
    },
  }, roadCellKeys, buildingCellKeys);
  state.trafficLights.addLight(10, 10);
  return state;
}

/** The crosswalk edges around the signalised intersection, in graph order. */
function crosswalksAt(state: ReturnType<typeof signalisedCity>, cellKey: string) {
  return state.sidewalkGraph.getAllEdges()
    .filter(e => e.type === 'crosswalk' && e.intersectionCellKey === cellKey);
}

describe('pedestrians obey traffic lights in a real game state', () => {
  it('should wire the state trafficLights into the pedestrian manager', () => {
    // Structural, but the cheapest possible statement of what went wrong: the
    // manager must hold the state's OWN lights, not null and not a copy.
    const state = signalisedCity();
    const pm = state.pedestrianManager as unknown as { trafficLights: unknown };
    expect(pm.trafficLights).toBe(state.trafficLights);
  });

  it('should wire the state sidewalkGraph, not a throwaway one', () => {
    const state = signalisedCity();
    const pm = state.pedestrianManager as unknown as { sidewalkGraph: unknown };
    expect(pm.sidewalkGraph).toBe(state.sidewalkGraph);
  });

  it('should build crosswalks that name their intersection', () => {
    // If this is empty the behavioural cases below would pass vacuously.
    const state = signalisedCity();
    expect(crosswalksAt(state, '10,10').length).toBeGreaterThan(0);
  });

  it('should hold a pedestrian at a red crosswalk', () => {
    const state = signalisedCity();
    const light = state.trafficLights.getLight(10, 10)!;

    // For each crosswalk, work out which phase stops it and check both.
    const crosswalk = crosswalksAt(state, '10,10')[0]!;
    const fromPos = crosswalk.from.cellKey.split(',').map(Number);
    const approachIsNS = (10 - fromPos[1]!) !== 0;
    const safePhase = approachIsNS ? 1 : 0;

    const priv = state.pedestrianManager as unknown as {
      canPassCrosswalk(e: typeof crosswalk): boolean;
    };

    light.clearing = false;
    light.phase = safePhase;
    expect(priv.canPassCrosswalk(crosswalk)).toBe(true);

    light.phase = safePhase === 0 ? 1 : 0;
    expect(priv.canPassCrosswalk(crosswalk)).toBe(false);
  });

  it('should hold everyone during the all-red clearance', () => {
    const state = signalisedCity();
    const light = state.trafficLights.getLight(10, 10)!;
    light.clearing = true;

    const priv = state.pedestrianManager as unknown as {
      canPassCrosswalk(e: unknown): boolean;
    };
    for (const cw of crosswalksAt(state, '10,10')) {
      expect(priv.canPassCrosswalk(cw)).toBe(false);
    }
  });

  it('should let everyone through at an unsignalised crossroads', () => {
    // Negative control: the gate must come from the light, not from being a
    // crosswalk. Without this, "pedestrians stop" would be satisfiable by
    // blocking every crossing in the city.
    const state = signalisedCity();
    state.trafficLights.removeLight(10, 10);

    const priv = state.pedestrianManager as unknown as {
      canPassCrosswalk(e: unknown): boolean;
    };
    for (const cw of crosswalksAt(state, '10,10')) {
      expect(priv.canPassCrosswalk(cw)).toBe(true);
    }
  });

  it('should reach WAITING_SIGNAL when an agent walks into a red light', () => {
    // The end-to-end statement: a state the game itself could produce, an
    // agent moving through it, and the state machine entering the branch that
    // was unreachable.
    const state = signalisedCity();
    const light = state.trafficLights.getLight(10, 10)!;
    light.clearing = false;

    let sawWaiting = false;
    for (const phase of [0, 1]) {
      light.phase = phase;
      for (let attempt = 0; attempt < 40 && !sawWaiting; attempt++) {
        const id = state.pedestrianManager.spawnPedestrian(5, 9, 15, 9, -1, 4);
        if (id === null) break;
        for (let i = 0; i < 200; i++) {
          state.pedestrianManager.tick(0.5);
          if (state.pedestrianManager.agents.some(a => a.state === PedestrianState.WAITING_SIGNAL)) {
            sawWaiting = true;
            break;
          }
        }
      }
    }

    expect(sawWaiting).toBe(true);
  });
});
