import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';

/**
 * Commute routes are not serialized and must be recomputed after a load. The per-tick budget
 * is 32 queued requests and 2 local computations, but exhausting a budget yields `continue`
 * rather than `break`, so **the whole list is still walked**.
 *
 * Measured on a 12,351-citizen save: `advanceCommuteFill` took 46-66% of `update()` for the
 * first 11 seconds after entering the game and dropped to 2% at second 12 (BUG-329). The
 * time went into the ten thousand "examined, nothing to do" iterations, not the 2 routes.
 *
 * The loop also restarted from the head of the list each tick, so citizens further down
 * waited for everyone before them to settle. A resuming cursor fixes both.
 */

function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      if (i % 3 !== 0 && j % 3 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 3 === 0) flags |= RoadDirection.NORTH;
      if (j < 23 && i % 3 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 3 === 0) flags |= RoadDirection.WEST;
      if (i < 23 && j % 3 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  const homes: string[] = [];
  const works: string[] = [];
  for (let i = 1; i < 24; i += 3) {
    for (let j = 1; j < 24; j += 3) {
      if (j <= 10) {
        state.grid.setCell(i, j, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
        homes.push(`${i},${j}`);
      } else {
        state.grid.setCell(i, j, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
        works.push(`${i},${j}`);
      }
    }
  }
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % homes.length]!;
    c.workplaceId = works[n % works.length]!;
  }
  return state;
}

type Inner = {
  advanceCommuteFill(): void;
  commuteFillCursor: number;
  commuteFillScanned: number;
};

function makeLoop(state: GameState): { loop: SimulationLoop; inner: Inner } {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return { loop, inner: loop as unknown as Inner };
}

const N = SIMULATION.COMMUTE_FILL_SCAN_PER_TICK;

describe('補通勤路線的游標', () => {
  it('should look at no more citizens than its scan budget', () => {
    // The point of the whole thing. Walking everyone gives an identical answer while burning
    // ten thousand extra "examined, nothing to do" iterations per tick, which is what the
    // player feels in the first ten seconds after entering the game.
    const state = makeCity(N * 3);
    const { inner } = makeLoop(state);
    expect(state.citizens.getPopulation(), '前置條件:人數要多於掃描預算')
      .toBeGreaterThan(N);

    inner.advanceCommuteFill();
    expect(inner.commuteFillScanned, '一個 tick 就把整份名單掃完了').toBe(N);
  });

  it('should carry on from where it stopped', () => {
    // Scanning from the head each tick makes citizens further down wait for everyone before
    // them to settle.
    const { inner } = makeLoop(makeCity(N * 3));
    inner.advanceCommuteFill();
    const after1 = inner.commuteFillCursor;
    inner.advanceCommuteFill();
    expect(after1, '第一個 tick 之後游標沒有前進').toBe(N);
    expect(inner.commuteFillCursor, '第二個 tick 又從頭開始掃').toBe(N * 2);
  });

  it('should wrap around to the start', () => {
    // Wrapping is what makes it round-robin. Stopping at the end never reaches citizens who
    // arrive later.
    const { inner } = makeLoop(makeCity(N + 5));
    inner.advanceCommuteFill();
    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '掃到名單尾端沒有繞回開頭').toBeLessThan(N);
  });

  it('should still reach everyone, including the ones at the far end', () => {
    // Saving time must not cost correctness: after enough laps, everyone has been examined.
    const count = N * 2 + 7;
    const { inner } = makeLoop(makeCity(count));
    const seen = new Set<number>();
    const start = inner.commuteFillCursor;
    for (let t = 0; t < 6; t++) {
      const from = inner.commuteFillCursor;
      inner.advanceCommuteFill();
      for (let k = 0; k < inner.commuteFillScanned; k++) seen.add((from + k) % count);
    }
    expect(seen.size, '轉了六圈還有人沒被看過').toBe(count);
    expect(start).toBe(0);
  });

  it('should step past a citizen it has nothing to do for', () => {
    // The cursor advances past a citizen with no job too. Stuck on them, everyone behind never
    // gets a turn — invisible in a fixture where every citizen has a home and a job.
    const state = makeCity(N + 20);
    const { inner } = makeLoop(state);
    const first = state.citizens.getCitizens()[0]!;
    first.workplaceId = null;

    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '沒事可做的那一位把游標黏住了').toBe(N);
  });

  it('should not read past the end when citizens died since last tick', () => {
    // The cursor records a list position and the list can shrink. Stopping at index 1024 and
    // returning to a list of 30 reads undefined and throws on `c.homeId`.
    const state = makeCity(N * 2);
    const { inner } = makeLoop(state);
    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '前置條件:游標要停在後面').toBe(N);

    const ids = state.citizens.getCitizens().map(c => c.id).slice(30);
    state.citizens.removeCitizens(new Set(ids));
    expect(state.citizens.getPopulation(), '前置條件:人數要少於游標').toBeLessThan(N);

    expect(() => inner.advanceCommuteFill(), '名單縮短之後讀到名單外').not.toThrow();
    expect(inner.commuteFillCursor).toBeLessThan(state.citizens.getPopulation());
  });

  it('should cope with a list shorter than the budget', () => {
    const { inner } = makeLoop(makeCity(3));
    inner.advanceCommuteFill();
    expect(inner.commuteFillScanned, '看的人比名單還多').toBeLessThanOrEqual(3);
    inner.advanceCommuteFill();   // must not throw, and must not park past the end
    expect(inner.commuteFillCursor).toBeLessThan(3);
  });
});
