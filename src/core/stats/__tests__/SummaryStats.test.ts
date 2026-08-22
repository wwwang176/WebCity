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
    // `totalJobs − employed`,不是 `totalJobs − population`。舊的定義會在成熟城市
    // 印出「0 職缺、無法遷入」,而模擬那邊回報幾百個職缺並照樣讓人搬進來（BUG-166）。
    //
    // 這裡刻意讓人口 ≠ 就業人數:四個座位的商店、兩個居民，其中一個有工作。
    // 用人口當被減數會算出 2,用就業人數才是對的 3。
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
    // 人比房子多的時候空房是 0,不是 −37。
    const state = createGameState(8, 8);
    const s = buildSummaryStats(state);

    expect(s.vacantHomes).toBeGreaterThanOrEqual(0);
    expect(s.jobOpenings).toBeGreaterThanOrEqual(0);
  });

  it('should give an empty city a neutral happiness instead of zero', () => {
    // 沒有居民的城市不是「大家都很不開心」。給 0 的話吸引力會被平白扣掉 35 分。
    const s = buildSummaryStats(createGameState(4, 4));

    expect(s.avgHappiness).toBe(70);
  });

  it('should require appeal, a spare home and an open job all at once', () => {
    // 三個條件缺一不可 —— 只看分數會說「很吸引人」，然後沒有半個人搬進來。
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
    // 「不吸引人」本身沒有可以動作的資訊。要知道是稅太高還是污染太重。
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
   * 一座有人的城。
   *
   * 人口是參數:基礎犯罪率是 `人口 × 0.02`,要測「條例扣了 13 點」就得先有
   * 超過 13 點可以扣,不然結果會被 0 的下限吃掉,測到的是夾值不是加法。
   */
  function city(population = 30) {
    const state = createGameState(16, 16);
    for (let i = 0; i < population; i++) {
      state.citizens.restoreCitizen({ age: 100 });
    }
    return state;
  }

  it('should come down when the player builds police stations', () => {
    // 這就是使用者問的那件事:面板寫著「犯罪 −15」,蓋了警局卻一動也不動 ——
    // 因為那條式子是 `min(50, 人口 × 0.02)`,正好是**一座警局都沒有**的基礎值。
    const before = buildSummaryStats(city()).crimeRate;

    const withPolice = city();
    withPolice.police.addStation(4, 4);
    withPolice.police.addStation(8, 8);

    expect(buildSummaryStats(withPolice).crimeRate, '蓋了警局犯罪率沒動').toBeLessThan(before);
  });

  it('should raise the appeal score by exactly what the crime drop is worth', () => {
    // 犯罪少 1 點,吸引力多 CRIME_WEIGHT 分。兩邊要對得起來,不然玩家會看到
    // 「犯罪降了但分數沒動」。
    const plain = buildSummaryStats(city());
    const policed = city();
    policed.police.addStation(4, 4);
    const after = buildSummaryStats(policed);

    expect(after.attractiveness - plain.attractiveness)
      .toBeCloseTo((plain.crimeRate - after.crimeRate) * ATTRACTIVENESS.CRIME_WEIGHT, 6);
  });

  it('should count the city ordinances the simulation counts', () => {
    // 監視器網路第 2 級是 crime −13。少了這一項,面板寫著 Crime −13 而
    // 居民一點感覺也沒有。人口開到 800 是為了讓基礎犯罪率（16）大於 13 ——
    // 小城市會被 0 的下限吃掉,那樣測到的是夾值不是加法。
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
    // 小城市套上 −13,加完是負的。負的犯罪率在下游會變成加分。
    const tiny = city(30);
    tiny.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);

    expect(buildSummaryStats(tiny).crimeRate).toBe(0);
  });

  it('should never let crime turn into a bonus', () => {
    // 負的犯罪率在下游會變成加分。
    expect(buildSummaryStats(city()).crimeRate).toBeGreaterThanOrEqual(0);
  });
});


describe('廢墟不是房子', () => {
  /** 一棟 High Rise（320 人）。 */
  const HIGH_RISE = 6;

  function withRuin(reserved: number) {
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE });
    state.grid.setCell(4, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: HIGH_RISE, reserved });
    return buildSummaryStats(state);
  }

  it('should not count a burned tower as housing anyone', () => {
    // 燒掉的大樓住不了人。算進去的話「空房 6889」裡有一部分是永遠住不進去的,
    // 而遷入的閘門就是看空房。
    expect(withRuin(BURNED).totalHomes, '燒毀的樓還在提供床位').toBe(320);
  });

  it('should not count an abandoned tower either', () => {
    expect(withRuin(ABANDONED).totalHomes).toBe(320);
  });

  it('should keep the ruin out of the zone table as well', () => {
    // 表格說「97 棟」而其中 9 棟是焦黑的，那張表就不是在描述這座城市有什麼。
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
    // 分區表那一欄是「容量」= 住戶 + 員工，給人看的一個數字。職缺不能從它加總 ——
    // 一棟住宅如果坐落在工業區的格子上（改劃分區時就會這樣），它的 4 個住戶會被
    // 當成 4 個工作機會，而模擬那邊問的是 `bt.workers`，答案是 0。
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });

    const s = buildSummaryStats(state);

    expect(s.zones.find(z => z.zone === 'industrial')!.capacity, '容量欄是住戶+員工').toBe(4);
    expect(s.totalJobs, '把住戶算成了職缺').toBe(0);
    expect(s.totalJobs).toBe(countWorkplaceJobs(state.grid));
  });

  it('should agree with the counters the simulation uses', () => {
    // 這一條才是重點:兩邊分家的話，玩家看到的空房與職缺就不是遷入用的那一組。
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
    // 工業區的汙染是設計上就該有的。把它算進「居民感受到的汙染」,一座正常運作的
    // 工業城會被扣到搬不進人 —— 而模擬那邊根本沒有這樣扣。
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
    // `avgResidentialMetric` 只看 `isActiveZoneCell`。面板要跟著。
    const state = createGameState(16, 16);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 10 });
    state.grid.setCell(3, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 90, reserved: BURNED });

    expect(buildSummaryStats(state).avgPollution).toBe(10);
  });
});

describe('幸福度不要先四捨五入', () => {
  it('should hand the raw average to the appeal formula', () => {
    // 模擬餵給 `calculateAttractiveness` 的是原始值。先 round 再算，兩邊的吸引力
    // 會差到 0.25 分 —— 而門檻 40 是一條硬線。
    const state = createGameState(16, 16);
    for (let i = 0; i < 3; i++) state.citizens.restoreCitizen({ age: 100 });
    const cs = state.citizens.getCitizens();
    cs[0]!.happiness = 50; cs[1]!.happiness = 51; cs[2]!.happiness = 51;

    const s = buildSummaryStats(state);

    expect(s.avgHappiness, '被四捨五入掉了').toBeCloseTo(152 / 3, 6);
    expect(Number.isInteger(s.avgHappiness)).toBe(false);
  });

  it('should take the empty-city default from the simulation constants', () => {
    // 兩邊各寫一個 70 的話，調了一邊另一邊不會跟上。
    expect(buildSummaryStats(createGameState(8, 8)).avgHappiness)
      .toBe(SIMULATION.DEFAULT_HAPPINESS);
  });
});
