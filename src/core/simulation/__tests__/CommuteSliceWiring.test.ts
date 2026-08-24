import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { PolicyType } from '../../district/types';
import type { CommuteStats } from '../../citizen/CommuteStats';

/**
 * Commute statistics are computed **round-robin**: one slice per tick, a full cycle every
 * `N` ticks, with each citizen's value stored. The statistics aggregate the stored values of
 * **everyone**, not a sample.
 *
 * ### Why not sampling
 *
 * 1. `chargedDriversByDistrict` directly determines congestion-charge **revenue**. Sampling
 *    would estimate the city's income from a sample, making the player's money jitter with
 *    who was drawn.
 * 2. Drawing a fixed k citizens is a **systematic bias**, not random error: if the drawn
 *    citizens all happen to work nearby, that building shows the wrong number permanently and
 *    never self-corrects.
 *
 * Round-robin has neither problem: everyone is computed eventually, and the statistics cover
 * the whole population.
 */

interface Internals {
  advanceCommuteSlice(): void;
  getCommuteStatsVersion(): number;
  refreshCommuteStats(): void;
  rebuildAllCommuteRecords(): void;
  commuteRecords: Map<number, unknown>;
  getCommuteStats(): CommuteStats;
}

const N = SIMULATION.MEDIUM_TICK_INTERVAL;

/**
 * Homes and workplaces are spread along the road so commute times form a distribution rather
 * than all being identical.
 *
 * **A charged cordon is required.** Without one, `chargedDriversByDistrict` is an empty Map
 * on both sides and the "sliced equals full" assertion compares nothing — and that entry is
 * exactly what determines congestion-charge revenue.
 */
function city(citizens: number): GameState {
  const state = createGameState(40, 40);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  const homes = ['2,2', '10,2', '20,2', '30,2'];
  const works = ['5,2', '15,2', '25,2', '35,2'];
  for (const h of homes) state.grid.setCell(+h.split(',')[0]!, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
  for (const w of works) state.grid.setCell(+w.split(',')[0]!, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: homes[i % homes.length]!, workplaceId: works[(i * 3) % works.length]!,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 2);

  // The cordon covers the workplaces in the right half, so only some commuters pay. If all or
  // none paid, hardcoding districtId to a constant would also pass.
  const d = state.districts.createDistrict('Downtown');
  for (let x = 22; x < 40; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
  }
  state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
  return state;
}

/** Runs a few ticks so the road and accessibility graphs are built, then drives the part
 *  under test directly. */
function primed(citizens: number) {
  const state = city(citizens);
  const loop = new SimulationLoop(state);
  for (let i = 0; i < 3; i++) loop.tick();
  return { state, loop, inner: loop as unknown as Internals };
}

/** Only the comparable fields: `worst` is an array of objects, and field-by-field comparison
 *  gives a readable message. */
function comparable(s: CommuteStats) {
  return {
    sampled: s.sampled, average: s.average, median: s.median,
    overThreshold: s.overThreshold, buckets: s.buckets, byMode: s.byMode,
    byHome: [...s.byHome].sort(), charged: [...s.chargedDriversByDistrict].sort(),
  };
}

describe('通勤統計的輪流計算', () => {
  it('should produce the same stats as computing everyone at once', () => {
    // The criterion for the whole design. After one cycle the statistics must match a
    // full-city computation field by field — identical, not close. Sampling cannot do that;
    // round-robin can.
    const { loop, inner } = primed(400);

    inner.rebuildAllCommuteRecords();
    inner.refreshCommuteStats();
    const atOnce = comparable(loop.getCommuteStats());

    inner.commuteRecords.clear();
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();
    inner.refreshCommuteStats();
    const sliced = comparable(loop.getCommuteStats());

    expect(atOnce.sampled, '這座城市沒有人算得出通勤 —— 測試什麼都沒比')
      .toBeGreaterThan(0);
    // An empty Map equalling an empty Map compares nothing. The revenue entry has to carry
    // real numbers for the comparison to mean anything.
    const chargedTotal = atOnce.charged.reduce((a, [, n]) => a + n, 0);
    expect(chargedTotal, 'fixture 沒有人付過路費 —— 收入那一項等於沒測')
      .toBeGreaterThan(0);
    expect(chargedTotal, '全部人都付過路費 —— 把 districtId 寫死成常數也會過')
      .toBeLessThan(atOnce.sampled);
    expect(sliced).toEqual(atOnce);
  });

  it('should recompute every citizen exactly once per cycle', () => {
    // A sentinel: before each tick every record is replaced with the same marker object, and
    // whatever is **no longer the marker** afterwards was recomputed this tick.
    //
    // Counting newly added keys instead cannot catch a wrong slice count: with a 6-tick cycle
    // each citizen is recomputed 10 times over 60 ticks while their key is only added once,
    // and the test stays green.
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const SENTINEL = { time: -1, mode: 'SENTINEL', chargedDistrictId: null };
    const recomputed = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      for (const id of [...inner.commuteRecords.keys()]) {
        inner.commuteRecords.set(id, SENTINEL);
      }
      inner.advanceCommuteSlice();
      for (const [id, rec] of inner.commuteRecords) {
        if (rec !== SENTINEL) recomputed.set(id, (recomputed.get(id) ?? 0) + 1);
      }
    }

    const ids = state.citizens.getCitizens().map(c => c.id);
    expect(recomputed.size, `${ids.length} 位市民裡只有 ${recomputed.size} 位被重算過`)
      .toBe(ids.length);
    for (const [id, times] of recomputed) {
      expect(times, `市民 ${id} 一輪（${N} 個 tick）之內被重算了 ${times} 次`).toBe(1);
    }
  });

  it('should advance a slice every tick, not once per cycle', () => {
    // Advancing one slice every 60 ticks would make a cycle 3,600 ticks, or 150 game days.
    const { loop, inner } = primed(400);
    inner.commuteRecords.clear();

    loop.tick();
    const afterOne = inner.commuteRecords.size;

    expect(afterOne, '一個 tick 之後一位市民都沒被算到 —— 沒有接到迴圈上')
      .toBeGreaterThan(0);
    expect(afterOne, '一個 tick 就把全城算完了 —— 沒有分片')
      .toBeLessThan(400);
  });

  it('should have a record for everyone right after a full rebuild', () => {
    // Cold start: with records for only 1/60 of citizens after a load, congestion-charge
    // revenue would be understated by more than fiftyfold.
    const { state, inner } = primed(400);
    inner.commuteRecords.clear();
    inner.rebuildAllCommuteRecords();

    const withCommute = state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
    expect(withCommute.length).toBeGreaterThan(0);
    for (const c of withCommute) {
      expect(inner.commuteRecords.has(c.id), `市民 ${c.id} 在全量重建之後還是沒有記錄`)
        .toBe(true);
    }
  });

  it('should give everyone a record on the very first tick', () => {
    // The cold start goes through the real tick path rather than the test calling the full
    // rebuild directly. This pins against the first tick computing only 1/60 of citizens,
    // which understates congestion-charge revenue by more than fiftyfold.
    const state = city(400);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Internals;

    loop.tick();

    const withCommute = state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
    expect(withCommute.length).toBeGreaterThan(0);
    expect(inner.commuteRecords.size, '第一個 tick 之後不是每個人都有記錄')
      .toBe(withCommute.length);
  });

  it('should drop the record of anyone who stopped commuting', () => {
    // A citizen who lost their job and keeps an old record counts as still commuting, which
    // makes the overlay, the panel and congestion-charge revenue all wrong with nothing to
    // correct them.
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const victim = state.citizens.getCitizens()[0]!;
    expect(inner.commuteRecords.has(victim.id)).toBe(true);
    victim.workplaceId = null;

    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    expect(inner.commuteRecords.has(victim.id), '沒工作的人還留著通勤記錄')
      .toBe(false);
  });

  it('should clear out records of the departed without touching the living', () => {
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const all = state.citizens.getCitizens();
    const gone = new Set(all.slice(0, 350).map(c => c.id));
    const staying = all.slice(350).map(c => c.id);
    state.citizens.removeCitizens(gone);

    // The prune runs at the start of a cycle, so the guarantee is "within a cycle", not
    // "immediately".
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    for (const id of gone) {
      expect(inner.commuteRecords.has(id), `遷出的市民 ${id} 的記錄沒清掉`).toBe(false);
    }
    for (const id of staying) {
      expect(inner.commuteRecords.has(id), `還在城裡的市民 ${id} 記錄被清掉了`).toBe(true);
    }
  });

  it('should get the charged drivers all the way into the published stats', () => {
    // **Having a record is not the same as the statistics showing it**: aggregation runs on
    // its own cadence. The other tests call `refreshCommuteStats()` directly and bypass the
    // schedule; this one goes through real ticks and checks the published result end to end:
    // estimate, record, aggregate, `getCommuteStats()`.
    //
    // It watches the charged-driver count rather than the commuter count, because that is
    // what determines congestion-charge **revenue**, and a break anywhere in the chain means
    // no money collected.
    const state = city(400);
    const loop = new SimulationLoop(state);

    loop.tick();

    const published = loop.getCommuteStats();
    const charged = [...published.chargedDriversByDistrict.values()]
      .reduce((a, b) => a + b, 0);
    expect(charged, '付過路費的人數沒有進到發布出去的統計 —— 壅塞費收不到錢')
      .toBeGreaterThan(0);
    expect(charged, '全城都在付 —— 收費區沒有真的在篩人').toBeLessThan(published.sampled);
  });

  it('should publish on its own schedule, not every tick', () => {
    // Aggregation publishes every 60 ticks. Publishing every tick would cost 24ms x 60 at
    // 100,000 citizens; **never** publishing again would leave citizens' values updating
    // while the player still sees the opening snapshot.
    //
    // Keyed on the version rather than the statistics' contents: this fixture has no power,
    // water or services, so buildings are abandoned within 60 ticks and the contents fall to
    // zero while the version is unaffected.
    const state = city(400);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Internals;

    // The schedule is tick 1 (the opening full pass) and then `(tick - 3) % 60 === 0`, i.e.
    // ticks 3, 63, 123 and so on; counting starts after tick 3.
    while (state.clock.tick < 3) loop.tick();
    const afterFirst = inner.getCommuteStatsVersion();

    while (state.clock.tick < N + 2) loop.tick();
    expect(inner.getCommuteStatsVersion(),
      `第 4 到第 ${N + 2} 個 tick 之間又發布了 —— 加總不該每個 tick 跑`)
      .toBe(afterFirst);

    while (state.clock.tick < N + 3) loop.tick();
    expect(inner.getCommuteStatsVersion(),
      `第 ${N + 3} 個 tick 該發布卻沒有 —— 統計會永遠停在開局那一份`)
      .toBe(afterFirst + 1);
  });

  it('should pick up citizens who moved in, within two cycles', () => {
    // The buckets are rebuilt at the start of every cycle. Bucketing once would mean citizens
    // who move in are **never** computed, freezing that building's overlay colour at the old
    // residents' numbers with nothing to correct it.
    //
    // Two cycles rather than one: a citizen arriving mid-cycle only enters a bucket at the
    // next cycle's start, and then still waits for their slice. The unsliced version took one
    // cycle (a full-city recompute every 60 ticks).
    //
    // **The same two-cycle lag applies to every change**, not just new arrivals — moves, job
    // changes and toggling ordinances alike: the record waits for its slice (up to one cycle)
    // and aggregation runs on its own cadence (up to another). See `advanceCommuteSlice()`.
    const { state, inner } = primed(400);
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    for (let i = 0; i < 50; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: '10,2', workplaceId: '25,2' });
    }
    const arrivals = state.citizens.getCitizens().filter(c => !before.has(c.id));
    expect(arrivals.length).toBe(50);

    for (let i = 0; i < N * 2; i++) inner.advanceCommuteSlice();

    for (const c of arrivals) {
      expect(inner.commuteRecords.has(c.id), `新搬進來的市民 ${c.id} 過了兩輪還是沒被算到`)
        .toBe(true);
    }
  });

  it('should clear every record within one cycle of the city emptying', () => {
    // After the city empties (everything demolished, or another save loaded), the previous
    // city's records must not keep occupying memory.
    //
    // The guarantee is "**within a cycle**", not "immediately": the buckets are only rebuilt
    // at the start of a cycle and still hold departed citizens until then. The save-loading
    // path is unaffected — `rebuildAllCommuteRecords()` clears on the spot.
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();
    expect(inner.commuteRecords.size).toBeGreaterThan(0);

    state.citizens.removeCitizens(new Set(state.citizens.getCitizens().map(c => c.id)));
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    expect(inner.commuteRecords.size, '空了一整輪還留著上一座城市的通勤記錄').toBe(0);
  });

  it('should not let citizens who left the city keep counting', () => {
    // The records are a cache; aggregation walks **the list of the living**, so the dead and
    // departed get no vote.
    const { state, loop, inner } = primed(400);
    inner.rebuildAllCommuteRecords();
    inner.refreshCommuteStats();
    const before = loop.getCommuteStats().sampled;

    const gone = state.citizens.getCitizens().slice(0, 100).map(c => c.id);
    state.citizens.removeCitizens(new Set(gone));
    inner.refreshCommuteStats();

    expect(loop.getCommuteStats().sampled, '遷出的人還在統計裡')
      .toBe(before - gone.length);
  });
});
