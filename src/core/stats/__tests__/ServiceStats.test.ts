import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildServicesStats } from '../ServiceStats';
import { RoadType } from '../../road/types';

describe('服務統計', () => {
  it('should list every service the coverage panel scores', () => {
    // The panel's top-left average coverage is the mean of these nine. Drop one and the
    // average stops matching the screen.
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.services.map(x => x.service)).toEqual([
      'power', 'water', 'sewage', 'police', 'fire',
      'health', 'education', 'garbage', 'deathCare',
    ]);
  });

  it('should not count a dead station towards the capacity the city can use', () => {
    // An unpowered police station patrols nothing. Adding its capacity makes the panel say
    // "spare capacity" while the streets are out of control (BUG-138, BUG-100).
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities, '設施沒被列出來').toHaveLength(1);
    expect(police.facilities[0]!.operational).toBe(false);
    expect(police.capacity, '壞掉的局還在貢獻容量').toBe(0);
  });

  it('should still list the dead station so the player can see it is dead', () => {
    // Dropped from the list, the facility leaves the player watching coverage fall with no
    // visible cause. Its nominal capacity stays on the entry; it just does not count toward
    // citywide usable capacity.
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities[0]!.capacity, '帳面容量要留著').toBeGreaterThan(0);
  });

  it('should count a working station', () => {
    // The converse has to hold too, or "capacity is always 0" would pass both cases above.
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities[0]!.operational).toBe(true);
    expect(police.capacity).toBe(police.facilities[0]!.capacity);
  });

  it('should call it a shortage even when there is no capacity at all', () => {
    // `capacity > 0 && load > capacity` silences the warning during a citywide blackout,
    // exactly when it belongs. The load is assigned before the station loses power, so load
    // stays and capacity drops to zero.
    const state = createGameState(8, 8);
    // Coverage needs a road, and demand only reaches facilities that have coverage (BUG-363).
    for (let x = 0; x < 8; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);
    state.police.recalculateCoverage(state.grid);
    state.police.updateStationLoads([{ x: 3, y: 4, weight: 500 }]);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.load, '負載被清掉了，這條就測不到東西').toBeGreaterThan(0);
    expect(police.capacity).toBe(0);
    expect(police.shortage, '全城停電時警示被關掉了').toBe(true);
  });

  it('should not cry shortage when capacity covers the load', () => {
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.shortage).toBe(false);
  });

  it('should average coverage across every service, not just the ones with facilities', () => {
    // In a city with only a police station, the average still covers the eight services that
    // have no facilities.
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.avgCoverage).toBeCloseTo(
      s.services.reduce((a, b) => a + b.coverage, 0) / s.services.length, 6,
    );
  });

  it('should count how many services are under half covered', () => {
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.gaps).toBe(s.services.filter(x => x.coverage < 0.5).length);
  });

  it('should say how many students want a school, not just how many got in', () => {
    // Enrolment tops out at capacity while demand can exceed it; the gap is what tells the
    // player how many more to build.
    const state = createGameState(8, 8);
    state.education.addSchool(3, 3, 'elementary' as never);

    const edu = buildServicesStats(state).services.find(x => x.service === 'education')!;

    expect(edu.facilities[0]!.demand, '沒給需求人數').toBeTypeOf('number');
    expect(edu.facilities[0]!.subtype, '沒說是哪一種學校').toBe('elementary');
  });

  it('should carry the flows that the standing totals cannot show', () => {
    // "70% full" does not say how many weeks are left; the weekly intake does.
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.garbageProducedPerWeek).toBe(0);
    expect(s.deathsPerWeek).toBe(0);
    expect(s.activeFires).toBe(0);
  });
});
