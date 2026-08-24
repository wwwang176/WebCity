import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { citizenSliceOf } from '../CitizenSlicing';
import { DEFAULT_RELOCATION_CONFIG } from '../../citizen/Relocation';

/**
 * Housing relocation runs one batch per slow slot, 10 batches per cycle, instead of every
 * citizen once every 60 ticks.
 *
 * `10 * SLOW_TICK_INTERVAL = 60`, so the interval between a citizen's turns is unchanged;
 * what changes is one 195ms pass becoming ten 20ms ones (BUG-331).
 *
 * These pin the **wiring**: the batches really do rotate, each handles only part of the
 * population, and the whole thing completes within a single tick with no cross-tick snapshot
 * to maintain.
 */

/** Alternating housing levels so a citizen with education NONE has a clearly better option to
 *  move to. */
function unhappyCity(citizens: number): GameState {
  const state = createGameState(40, 40);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  // High-density housing with alternating levels: 4 = Small Apartment (level 1, 80
  // residents), 6 = High Rise (level 3, 320). Capacity has to be sufficient — if everything
  // is full, every candidate is rejected by `occ >= capacity`, nobody moves, and the test
  // checks nothing.
  for (let x = 2; x < 20; x++) {
    state.grid.setCell(x, 2, {
      zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: x % 2 === 0 ? 4 : 6,
    });
  }
  state.grid.setCell(25, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: `${2 + (i % 18)},2`, workplaceId: '25,2', happiness: 10,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

const CYCLE = SIMULATION.SLOW_TICK_INTERVAL * SIMULATION.HOUSING_RELOCATION_SLICES;

/**
 * Whether relocation actually ran on this tick.
 *
 * `lastHousingRelocation` **survives until the next run**, and relocation runs only every 6
 * ticks, so reading it every tick counts the same result six times.
 */
function ranThisTick(state: GameState, loop: SimulationLoop): boolean {
  return loop.lastHousingRelocation.tick === state.clock.tick;
}

/**
 * The city's homes and workplaces, topped up each tick to isolate unrelated decay
 * (abandonment, fire).
 *
 * **Only the missing ones are replaced.** Rewriting a cell unconditionally reads as "the
 * building here was replaced" and evicts its residents, turning every homeId in the city to
 * null and leaving that tick with no unhappy citizens at all.
 */
function placeBuildings(state: GameState): void {
  const want = (x: number) => x === 25
    ? { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 }
    : { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: x % 2 === 0 ? 4 : 6 };
  for (const x of [...Array.from({ length: 18 }, (_, i) => i + 2), 25]) {
    const cell = state.grid.getCell(x, 2);
    const w = want(x);
    if (cell && cell.buildingId === w.buildingId && cell.reserved === 0) continue;
    state.grid.setCell(x, 2, { ...w, reserved: 0 });
  }
}

/**
 * Advances one tick, first restoring the city to a state with unhappy citizens and housing
 * to move into.
 *
 * Both are needed: producing unhappiness through high taxes also triggers building
 * abandonment, and prolonged unhappiness does the same. Measured, housing candidates reached
 * zero by tick 58 and the last batch never ran. That is **another** subsystem's behaviour,
 * not what these tests pin.
 */
function tickUnhappy(state: GameState, loop: SimulationLoop): void {
  placeBuildings(state);
  for (const c of state.citizens.getCitizens()) {
    c.happiness = 10;
    // Emigration also keys off happiness. Left on, the city loses half its population within a
    // cycle, and since the quota is recomputed from the current headcount each time, the sum
    // matches no fixed number and the test becomes flaky.
    c.emigrationTolerance = 0;
  }
  loop.tick();
}

describe('換房子的接線', () => {
  it('should run one slice per slow cycle and walk through all of them', () => {
    // Without the batch index wired up (always running batch 0, say), the other nine tenths
    // of citizens are never considered.
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const seen = new Set<number>();

    let ran = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (!ranThisTick(state, loop)) continue;
      ran++;
      seen.add(loop.lastHousingRelocation.slice);
    }
    expect(ran, `一圈跑了 ${ran} 次，應該是 ${SIMULATION.HOUSING_RELOCATION_SLICES} 次`)
      .toBe(SIMULATION.HOUSING_RELOCATION_SLICES);
    expect(seen.size, `輪了一圈只走到 ${seen.size} 批`)
      .toBe(SIMULATION.HOUSING_RELOCATION_SLICES);
  });

  it('should consider only about one slice worth of citizens each time', () => {
    // This is the saving itself. Running everyone at once would make this number the whole
    // population.
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);

    let maxConsidered = 0;
    let ran = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (!ranThisTick(state, loop)) continue;
      ran++;
      maxConsidered = Math.max(maxConsidered, loop.lastHousingRelocation.considered);
    }
    expect(ran, '一圈裡一次都沒跑過').toBeGreaterThan(0);
    expect(maxConsidered, '一次都沒看到任何人').toBeGreaterThan(0);
    const pop = state.citizens.getPopulation();
    expect(maxConsidered, `一次就看了 ${maxConsidered} 位，全城才 ${pop} 位`)
      .toBeLessThan(pop / (SIMULATION.HOUSING_RELOCATION_SLICES / 2));
  });

  it('should come round to the same citizen every MEDIUM_TICK_INTERVAL ticks', () => {
    // Comparing the product of two constants is a tautology; what matters is that the
    // schedule really brings the same citizen round every 60 ticks.
    expect(SIMULATION.HOUSING_RELOCATION_SLICES * SIMULATION.SLOW_TICK_INTERVAL)
      .toBe(SIMULATION.MEDIUM_TICK_INTERVAL);

    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const victim = state.citizens.getCitizens()[0]!.id;
    const mine = citizenSliceOf(victim, SIMULATION.HOUSING_RELOCATION_SLICES);

    const hitTicks: number[] = [];
    for (let t = 0; t < CYCLE * 2 + SIMULATION.SLOW_TICK_INTERVAL; t++) {
      tickUnhappy(state, loop);
      if (ranThisTick(state, loop) && loop.lastHousingRelocation.slice === mine) {
        hitTicks.push(state.clock.tick);
      }
    }
    expect(hitTicks.length, `這位市民在兩圈裡輪到 ${hitTicks.length} 次`)
      .toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hitTicks.length; i++) {
      expect(hitTicks[i]! - hitTicks[i - 1]!, '兩次輪到之間的間隔不是 MEDIUM_TICK_INTERVAL')
        .toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
    }
  });

  it('should still move somebody', () => {
    // If batching leaves nobody able to move, the whole change has simply turned the feature
    // off.
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const homesBefore = new Map(state.citizens.getCitizens().map(c => [c.id, c.homeId]));

    let moved = 0;
    let quotaSum = 0;
    for (let t = 0; t < CYCLE; t++) {
      tickUnhappy(state, loop);
      if (!ranThisTick(state, loop)) continue;
      moved += loop.lastHousingRelocation.relocated;
      quotaSum += loop.lastHousingRelocation.quota;
    }
    expect(moved, '輪完一圈一個人都沒搬').toBeGreaterThan(0);
    // The ten batches' quotas sum to the 5% an unsliced run would move. Taking 5% per batch
    // blows this number up.
    expect(moved, `搬了 ${moved} 位，一圈的配額總共才 ${quotaSum} 位`)
      .toBeLessThanOrEqual(quotaSum);

    const changed = state.citizens.getCitizens()
      .filter(c => homesBefore.has(c.id) && homesBefore.get(c.id) !== c.homeId).length;
    expect(changed, '回報有人搬家，實際上住址沒變').toBeGreaterThan(0);
  });

  it('should not hold any relocation state between ticks', () => {
    // The whole thing completes within a single tick, so there is no cross-tick snapshot to
    // maintain and that entire class of staleness cannot occur (BUG-331). Any leftover field
    // means the design has regressed.
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL * 3; t++) tickUnhappy(state, loop);

    const inner = loop as unknown as Record<string, unknown>;
    for (const leftover of ['housingRelocationSlicer', 'housingRelocationBudget']) {
      expect(inner[leftover], `${leftover} 還在 —— 又有跨 tick 的狀態了`).toBeUndefined();
    }
  });
});

describe('一圈的配額', () => {
  it('should keep a whole cycle inside the city-wide 5% cap', () => {
    // **This is the easiest part of batching to get wrong.** Taking 5% per batch makes
    // `Math.max(1, Math.floor(n * 0.05))` round every small batch up to 1: 100 unhappy
    // citizens split into ten batches move 10 per cycle, against 5 for an unsliced run.
    //
    // Only a small city exposes it: at 900 citizens the wrong formula gives 40 against 45
    // (11% off), at 100 it gives 10 against 5 (double).
    //
    // This drives **`runRelocation` directly** rather than running full ticks. Full ticks
    // collapse this city within a cycle: happiness 10 abandons buildings, replacing them
    // evicts residents, and by tick 58 the whole city is homeless — with the quota recomputed
    // from the current headcount each time, the sum matches no fixed number. The schedule
    // itself (every 6 ticks, same citizen every 60) is pinned by the tests above.
    //
    // Everyone starts in a level 3 building (which education NONE dislikes) with a row of
    // empty level 1 buildings beside them, so every citizen genuinely wants to move and the
    // quota is the only limit. Spread out, most would not move anyway and "moved <= quota"
    // would bite on nothing.
    const state = unhappyCity(100);
    for (const [i, c] of state.citizens.getCitizens().entries()) {
      c.homeId = `${3 + 2 * (i % 9)},2`;   // odd cells are buildingId 6, i.e. level 3
    }
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as { runRelocation(): void };
    const slices = SIMULATION.HOUSING_RELOCATION_SLICES;

    let quotaSum = 0, moved = 0;
    const cityCounts: number[] = [];
    for (let s = 0; s < slices; s++) {
      state.clock.tick = 4 + s * SIMULATION.SLOW_TICK_INTERVAL;   // jump straight to batch s
      for (const c of state.citizens.getCitizens()) c.happiness = 10;
      inner.runRelocation();
      expect(loop.lastHousingRelocation.slice, `第 ${s} 批算出來的批號不對`).toBe(s);
      quotaSum += loop.lastHousingRelocation.quota;
      moved += loop.lastHousingRelocation.relocated;
      cityCounts.push(loop.lastHousingRelocation.cityUnhappy);
    }

    // The city never ticks, so the headcount must not move at all.
    expect(new Set(cityCounts).size, `不開心的人數在一圈裡變了:${cityCounts.join(',')}`).toBe(1);

    const expected = Math.max(1,
      Math.floor(cityCounts[0]! * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
    expect(quotaSum,
      `一圈的配額總和 ${quotaSum}，全城 ${cityCounts[0]} 位不開心的 5% 是 ${expected}`)
      .toBe(expected);
    expect(moved, `搬了 ${moved} 位，配額總共 ${quotaSum} 位`).toBeLessThanOrEqual(quotaSum);
  });
});
