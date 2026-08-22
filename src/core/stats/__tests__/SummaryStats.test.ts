import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildSummaryStats } from '../SummaryStats';
import { IMMIGRATION, ATTRACTIVENESS } from '../../citizen/Migration';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

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
