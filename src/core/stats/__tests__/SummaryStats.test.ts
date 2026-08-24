import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildSummaryStats } from '../SummaryStats';
import { IMMIGRATION, ATTRACTIVENESS } from '../../citizen/Migration';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';
import { BURNED, ABANDONED } from '../../building/InfraPlacement';
import { countResidentialCapacity, countWorkplaceJobs } from '../../building/BuildingQueries';
import { getAvgResidentialPollution } from '../../environment/CityMetrics';
import { SIMULATION } from '../../simulation/SimulationConstants';

describe('城市總覽', () => {
  it('should count job openings the way the simulation does', () => {
    // `totalJobs - employed`, not `totalJobs - population`. The latter prints "0 openings,
    // cannot migrate" in a mature city while the simulation reports hundreds of openings and
    // keeps letting people in (BUG-166).
    //
    // Population is deliberately not equal to employment here: a four-seat shop, two residents,
    // one of them employed. Subtracting population gives 2; subtracting employment gives the
    // correct 3.
    const state = createGameState(8, 8);
    state.grid.setCell(2, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    const worker = state.citizens.restoreCitizen({ age: 100 });
    worker.workplaceId = '2,2';
    state.citizens.restoreCitizen({ age: 100 });

    const s = buildSummaryStats(state);

    expect(s.totalJobs, '商店的座位數').toBe(4);
    expect(s.population).toBe(2);
    expect(s.employed).toBe(1);
    expect(s.jobOpenings, '職缺用人口當被減數了').toBe(3);
  });

  it('should never report negative vacancy or negative openings', () => {
    // With more people than homes, free homes is 0, not -37.
    const state = createGameState(8, 8);
    const s = buildSummaryStats(state);

    expect(s.vacantHomes).toBeGreaterThanOrEqual(0);
    expect(s.jobOpenings).toBeGreaterThanOrEqual(0);
  });

  it('should give an empty city a neutral happiness instead of zero', () => {
    // A city with no residents is not "everyone is miserable"; a 0 would cost appeal 35 points
    // for nothing.
    const s = buildSummaryStats(createGameState(4, 4));

    expect(s.avgHappiness).toBe(70);
  });

  it('should require appeal, a spare home and an open job all at once', () => {
    // All three conditions are required; the score alone reads "appealing" while nobody moves
    // in.
    const s = buildSummaryStats(createGameState(4, 4));

    expect(s.canMigrate).toBe(
      s.attractiveness > s.attractivenessThreshold && s.vacantHomes > 0 && s.jobOpenings > 0,
    );
  });

  it('should take the migration threshold from the simulation, not a literal', () => {
    expect(buildSummaryStats(createGameState(4, 4)).attractivenessThreshold)
      .toBe(IMMIGRATION.ATTRACTIVENESS_THRESHOLD);
  });

  it('should name the single thing hurting appeal the most', () => {
    // "Unappealing" on its own carries no action; the caller needs to know whether it is tax
    // or pollution.
    const state = createGameState(8, 8);
    state.taxRates.residential = 20;
    const s = buildSummaryStats(state);

    expect(s.drags[0], '沒有排序').toBe(s.worstDrag ?? s.drags[0]);
    for (let i = 1; i < s.drags.length; i++) {
      expect(s.drags[i - 1]!.penalty, '扣分沒有由大到小').toBeGreaterThanOrEqual(s.drags[i]!.penalty);
    }
  });

  it('should leave the worst drag empty when the city is appealing enough', () => {
    const state = createGameState(8, 8);
    const s = buildSummaryStats(state);

    if (s.attractiveness > s.attractivenessThreshold) expect(s.worstDrag).toBeNull();
    else expect(s.worstDrag).not.toBeNull();
  });

  it('should count a zone once per building, and its capacity by what it holds', () => {
    const state = createGameState(8, 8);
    state.grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const zone = buildSummaryStats(state).zones.find(z => z.zone === 'residential_low')!;

    expect(zone.count).toBe(1);
  });

  it('should not count zoned-but-empty land as a building', () => {
    const state = createGameState(8, 8);
    state.grid.setCell(1, 1, { zoneType: ZoneType.INDUSTRIAL });

    expect(buildSummaryStats(state).zones.find(z => z.zone === 'industrial')!.count).toBe(0);
  });
});


describe('犯罪那一項要跟模擬說同一句話', () => {
  /**
   * A city with people in it.
   *
   * Population is a parameter because the base crime rate is `population * 0.02`: checking
   * that an ordinance takes 13 points off needs more than 13 points to take, or the 0 floor
   * absorbs the result and the case measures clamping rather than arithmetic.
   */
  function city(population = 30) {
    const state = createGameState(16, 16);
    for (let i = 0; i < population; i++) {
      state.citizens.restoreCitizen({ age: 100 });
    }
    return state;
  }

  it('should come down when the player builds police stations', () => {
    // Building a police station has to move the panel's crime figure. A local
    // `min(50, population * 0.02)` is exactly what the rate is with **no police station at
    // all**, so the panel would never move.
    const before = buildSummaryStats(city()).crimeRate;

    const withPolice = city();
    withPolice.police.addStation(4, 4);
    withPolice.police.addStation(8, 8);

    expect(buildSummaryStats(withPolice).crimeRate, '蓋了警局犯罪率沒動').toBeLessThan(before);
  });

  it('should raise the appeal score by exactly what the crime drop is worth', () => {
    // One point less crime is CRIME_WEIGHT points more appeal. The two have to line up, or the
    // player watches crime fall while the score stays put.
    const plain = buildSummaryStats(city());
    const policed = city();
    policed.police.addStation(4, 4);
    const after = buildSummaryStats(policed);

    expect(after.attractiveness - plain.attractiveness)
      .toBeCloseTo((plain.crimeRate - after.crimeRate) * ATTRACTIVENESS.CRIME_WEIGHT, 6);
  });

  it('should count the city ordinances the simulation counts', () => {
    // Surveillance network level 2 is crime -13. Without it the panel reads Crime -13 while
    // residents feel nothing. Population is 800 so that the base crime rate (16) exceeds 13; in
    // a small city the 0 floor absorbs it and the case measures clamping, not arithmetic.
    const plain = city(800);
    plain.police.addStation(4, 4);
    const before = buildSummaryStats(plain).crimeRate;

    const watched = city(800);
    watched.police.addStation(4, 4);
    watched.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);

    expect(watched.ordinances.getCrimeBonus(), '這條條例沒有生效,測不到東西').toBe(-13);
    expect(before, '基礎犯罪率不夠高,這條會測成夾值').toBeGreaterThan(13);
    expect(buildSummaryStats(watched).crimeRate, '條例沒被算進去').toBeCloseTo(before - 13, 6);
  });

  it('should clamp instead of turning a heavy ordinance into a bonus', () => {
    // In a small city, -13 takes the total below zero, and a negative crime rate becomes a
    // bonus downstream.
    const tiny = city(30);
    tiny.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);

    expect(buildSummaryStats(tiny).crimeRate).toBe(0);
  });

  it('should never let crime turn into a bonus', () => {
    // A negative crime rate becomes a bonus downstream.
    expect(buildSummaryStats(city()).crimeRate).toBeGreaterThanOrEqual(0);
  });
});


describe('廢墟不是房子', () => {
  /** One High Rise (320 residents). */
  const HIGH_RISE = 6;

  function withRuin(reserved: number) {
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE });
    state.grid.setCell(4, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE, reserved });
    return buildSummaryStats(state);
  }

  it('should not count a burned tower as housing anyone', () => {
    // A burned tower houses nobody. Counted, a figure like "6889 free" includes homes nobody
    // can ever move into, and free homes is the migration gate.
    expect(withRuin(BURNED).totalHomes, '燒毀的樓還在提供床位').toBe(320);
  });

  it('should not count an abandoned tower either', () => {
    expect(withRuin(ABANDONED).totalHomes).toBe(320);
  });

  it('should keep the ruin out of the zone table as well', () => {
    // A table reading "97 buildings" where 9 of them are charred is not describing what the
    // city has.
    const zone = withRuin(BURNED).zones.find(z => z.zone === 'residential_high')!;

    expect(zone.count, '廢墟還算在建築數裡').toBe(1);
    expect(zone.capacity).toBe(320);
  });

  it('should not count a burned factory as a job', () => {
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 19, reserved: BURNED });

    expect(buildSummaryStats(state).totalJobs).toBe(0);
  });

  it('should count jobs by what the building employs, not by its capacity column', () => {
    // The zone table's column is "capacity" = residents + workers, a display figure. Job
    // openings cannot be summed from it: a house standing on an industrial cell (which happens
    // when zoning is changed) contributes its 4 residents as 4 jobs, while the simulation asks
    // `bt.workers` and gets 0.
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });

    const s = buildSummaryStats(state);

    expect(s.zones.find(z => z.zone === 'industrial')!.capacity, '容量欄是住戶+員工').toBe(4);
    expect(s.totalJobs, '把住戶算成了職缺').toBe(0);
    expect(s.totalJobs).toBe(countWorkplaceJobs(state.grid));
  });

  it('should agree with the counters the simulation uses', () => {
    // If the two diverge, the free homes and job openings the player sees are not the ones the
    // migration gate uses.
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE });
    state.grid.setCell(4, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE, reserved: BURNED });
    state.grid.setCell(6, 6, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 12 });

    const s = buildSummaryStats(state);

    expect(s.totalHomes).toBe(countResidentialCapacity(state.grid));
    expect(s.totalJobs).toBe(countWorkplaceJobs(state.grid));
  });
});

describe('汙染要跟模擬問同一個問題', () => {
  it('should measure the air where people live, not the whole map', () => {
    // Industrial pollution is intentional. Folded into "pollution residents feel", a working
    // industrial city is penalised until nobody moves in, which the simulation never does.
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 10 });
    state.grid.setCell(8, 8, { zoneType: ZoneType.INDUSTRIAL, buildingId: 19, pollution: 90 });

    expect(buildSummaryStats(state).avgPollution, '遠處工廠的煙算到居民頭上了').toBe(10);
  });

  it('should use the very function the simulation uses', () => {
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 24 });
    state.grid.setCell(3, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 8 });

    expect(buildSummaryStats(state).avgPollution)
      .toBeCloseTo(getAvgResidentialPollution(state.grid), 6);
  });

  it('should ignore a burned house when averaging', () => {
    // `avgResidentialMetric` looks only at `isActiveZoneCell`, and the panel follows it.
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 10 });
    state.grid.setCell(3, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 90, reserved: BURNED });

    expect(buildSummaryStats(state).avgPollution).toBe(10);
  });
});

describe('幸福度不要先四捨五入', () => {
  it('should hand the raw average to the appeal formula', () => {
    // The simulation feeds `calculateAttractiveness` the raw value. Rounding first moves appeal
    // by as much as 0.25 points, and the threshold of 40 is a hard line.
    const state = createGameState(16, 16);
    for (let i = 0; i < 3; i++) state.citizens.restoreCitizen({ age: 100 });
    const cs = state.citizens.getCitizens();
    cs[0]!.happiness = 50; cs[1]!.happiness = 51; cs[2]!.happiness = 51;

    const s = buildSummaryStats(state);

    expect(s.avgHappiness, '被四捨五入掉了').toBeCloseTo(152 / 3, 6);
    expect(Number.isInteger(s.avgHappiness)).toBe(false);
  });

  it('should take the empty-city default from the simulation constants', () => {
    // With a literal 70 written on both sides, tuning one leaves the other behind.
    expect(buildSummaryStats(createGameState(8, 8)).avgHappiness)
      .toBe(SIMULATION.DEFAULT_HAPPINESS);
  });
});
