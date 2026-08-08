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

  it('should never give a pedestrian and a car the same right of way', () => {
    // The invariant, rather than the arithmetic.
    //
    // The first version recomputed `approachIsNS` with the same expression
    // production uses and derived the expected phase from it, so inverting the
    // mapping in PedestrianManager left the test green — it agreed with
    // whatever the code did. The physical fact is that a pedestrian crosses a
    // road exactly when the traffic ON that road is stopped, and the vehicle
    // side already answers that question independently: TrafficLightSystem.
    // canPass, whose phase semantics are documented on the TrafficLight type
    // (0 = NS green). If the two ever agree, someone gets run over.
    const state = signalisedCity();
    const light = state.trafficLights.getLight(10, 10)!;
    light.clearing = false;

    const priv = state.pedestrianManager as unknown as {
      canPassCrosswalk(e: unknown): boolean;
    };

    const crosswalks = crosswalksAt(state, '10,10');
    expect(crosswalks.length).toBeGreaterThan(0);

    let sawGreen = false;
    let sawRed = false;
    for (const phase of [0, 1]) {
      light.phase = phase;
      for (const cw of crosswalks) {
        const [fx, fy] = cw.from.cellKey.split(',').map(Number);
        // A car travelling the approach this crosswalk spans.
        const carMayGo = state.trafficLights.canPass(fx!, fy!, 10, 10);
        const walkerMayGo = priv.canPassCrosswalk(cw);
        expect(walkerMayGo, `phase ${phase} at ${cw.from.cellKey}`).toBe(!carMayGo);
        if (walkerMayGo) sawGreen = true; else sawRed = true;
      }
    }
    // Both outcomes must actually occur, or the invariant is satisfied by a
    // constant.
    expect(sawGreen && sawRed, 'fixture never exercised both phases').toBe(true);
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

/**
 * The re-check at the top of the tick asks `canPassCrosswalk(currentEdge)` —
 * but a waiting agent's `edgeIndex` still points at the APPROACH edge, and it
 * is the crosswalk after it that the light governs. `canPassCrosswalk` returns
 * early at `if (!edge.intersectionCellKey) return true` for an approach edge,
 * so the branch released every waiting pedestrian, every tick, on every phase.
 *
 * It usually did not show, because the while loop below re-blocks the agent
 * when it reaches the end of the edge. It shows when the agent is still short
 * of that boundary: released to WALKING, it advances on red.
 */
describe('a waiting pedestrian re-checks the light it is waiting for', () => {
  function waitingAgent() {
    const state = signalisedCity();
    const light = state.trafficLights.getLight(10, 10)!;
    light.clearing = false;

    // Walk one in until it stops at the crosswalk.
    let found = null;
    for (const phase of [0, 1]) {
      light.phase = phase;
      for (let attempt = 0; attempt < 40 && !found; attempt++) {
        if (state.pedestrianManager.spawnPedestrian(5, 9, 15, 9, -1, 4) === null) break;
        for (let i = 0; i < 200 && !found; i++) {
          state.pedestrianManager.tick(0.5);
          found = state.pedestrianManager.agents
            .find(a => a.state === PedestrianState.WAITING_SIGNAL) ?? null;
        }
      }
    }
    expect(found, 'no agent ever reached WAITING_SIGNAL').not.toBeNull();

    // The agent found may have been stopped several ticks and phases ago, so
    // derive the phases from ITS crosswalk rather than assuming the light is
    // still showing the one that stopped it. (Reading `light.phase` here was
    // the first version of this fixture, and it produced two cases that failed
    // in exactly opposite directions.)
    const priv = state.pedestrianManager as unknown as {
      canPassCrosswalk(e: unknown): boolean;
    };
    const crosswalk = found!.edgePath[found!.edgeIndex + 1]!;
    let redPhase = -1;
    let greenPhase = -1;
    for (const phase of [0, 1]) {
      light.phase = phase;
      if (priv.canPassCrosswalk(crosswalk)) greenPhase = phase; else redPhase = phase;
    }
    expect(redPhase, 'no phase stops this crosswalk').toBeGreaterThanOrEqual(0);
    expect(greenPhase, 'no phase lets it through').toBeGreaterThanOrEqual(0);

    // Short of the boundary, which is where the advance loop cannot re-block.
    const edge = found!.edgePath[found!.edgeIndex]!;
    found!.edgeProgress = edge.length * 0.5;

    return { state, light, agent: found!, edge, redPhase, greenPhase };
  }

  it('should not advance a waiting pedestrian while the light is still red', () => {
    const { state, light, agent, redPhase } = waitingAgent();
    light.phase = redPhase;
    const before = agent.edgeProgress;

    state.pedestrianManager.tick(0.1);

    expect(agent.state, 'released while the light is still red')
      .toBe(PedestrianState.WAITING_SIGNAL);
    expect(agent.edgeProgress, 'walked forward on red').toBe(before);
  });

  it('should release it once the light changes', () => {
    // The control: without it, "never release" satisfies the case above and
    // pedestrians would stand at the kerb for ever.
    const { state, light, agent, edge, greenPhase } = waitingAgent();
    light.phase = greenPhase;

    state.pedestrianManager.tick(0.1);

    expect(agent.state).not.toBe(PedestrianState.WAITING_SIGNAL);
    expect(agent.edgeProgress).toBeGreaterThan(edge.length * 0.5);
  });
});
