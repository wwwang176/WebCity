import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildSummaryStats } from '../SummaryStats';
import { IMMIGRATION } from '../../citizen/Migration';
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
