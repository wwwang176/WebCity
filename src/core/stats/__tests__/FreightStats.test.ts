import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildFreightStats } from '../FreightStats';
import { TRADE } from '../../traffic/FreightSystem';
import { ZoneType } from '../../grid/types';

/**
 * 貨運供應鏈。
 *
 * ## 為什麼這一份要抽出來
 *
 * 這些數字原本算在 `FreightPage.tsx` 的 `createMemo` 裡 —— 只有玩家的螢幕看得到。
 * 抄一份到 API 那邊就是 BUG-342 那個錯:同一個數字兩個地方各記一份，然後靜靜地分家。
 * 所以面板跟 API 都呼叫這一支。
 *
 * ## 有效供給不是產量
 *
 * `production` 是本地工廠做出來的量,但商店真正拿得到的是
 * **產量 − 出口 + 進口**。少算進出口的話,一座靠進口撐著的城市會顯示成缺貨,
 * 而玩家螢幕上明明寫著 75%。
 */

function commercialAt(state: ReturnType<typeof createGameState>, x: number, y: number) {
  state.grid.setCell(x, y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 1 });
}

describe('貨運供應鏈', () => {
  it('should count the goods shops can actually get, not just what factories made', () => {
    const state = createGameState(8, 8);
    state.freight.getLastDemand().production = 285;
    state.freight.getLastDemand().consumption = 688;
    state.freight.getLastTrade().imported = 230;
    state.freight.getLastTrade().exported = 0;

    const s = buildFreightStats(state);

    expect(s.effectiveProduction, '沒把進口算進來').toBe(515);
    expect(s.supplyRatio).toBeCloseTo(515 / 688, 6);
  });

  it('should subtract what the city exported', () => {
    // 出口出去的貨本地商店就吃不到了。
    const state = createGameState(8, 8);
    state.freight.getLastDemand().production = 100;
    state.freight.getLastDemand().consumption = 100;
    state.freight.getLastTrade().exported = 40;

    expect(buildFreightStats(state).effectiveProduction, '出口沒扣掉').toBe(60);
  });

  it('should call it fully supplied when nobody is consuming anything', () => {
    // 除以零。空城的供應率是 1,不是 NaN —— 面板會把 NaN 印成「NaN%」。
    const state = createGameState(8, 8);
    state.freight.getLastDemand().consumption = 0;

    expect(buildFreightStats(state).supplyRatio).toBe(1);
  });

  it('should work out how many shops are left with nothing', () => {
    const state = createGameState(8, 8);
    commercialAt(state, 1, 1);
    commercialAt(state, 2, 1);
    commercialAt(state, 3, 1);

    const s = buildFreightStats(state);

    expect(s.totalCommercial, '沒數到店家').toBe(3);
    expect(s.unsuppliedCount, '沒供貨的店家數 = 總數 − 有供貨的').toBe(3 - s.suppliedCount);
  });

  it('should not count zoned-but-empty land as a shop', () => {
    // 劃了商業區還沒長出建築的地不算店家。算進去的話供貨率會被莫名其妙地拉低。
    const state = createGameState(8, 8);
    state.grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW });

    expect(buildFreightStats(state).totalCommercial).toBe(0);
  });

  it('should rate rail by the stations that reach the edge, not by every station', () => {
    // 蓋在城市中間、接不到邊界的車站運不出去。
    const state = createGameState(8, 8);
    state.rail.addStop(3, 3);
    state.rail.addStop(4, 4);
    state.rail.updateExternalConnection(8, 8);

    const stats = buildFreightStats(state);

    expect(stats.totalStations, '車站沒被算到').toBe(2);
    expect(stats.externalStations, '沒有一座接得到邊界').toBe(0);
    expect(stats.railThroughput, '接不到邊界的車站還在算吞吐').toBe(0);
  });

  it('should rate an edge station at the full per-station throughput', () => {
    const state = createGameState(8, 8);
    state.rail.addStop(0, 3);
    state.rail.updateExternalConnection(8, 8);

    const stats = buildFreightStats(state);

    expect(stats.hasRailConnection).toBe(true);
    expect(stats.externalStations).toBe(1);
    expect(stats.railThroughput).toBe(TRADE.RAIL_THROUGHPUT_PER_STATION);
  });

  it('should give a dead airport no throughput', () => {
    // 沒水沒電的機場照樣列出來（玩家要看得到它壞了）,但吞吐是 0。
    const state = createGameState(8, 8);
    state.airport.build(2, 2, 'SMALL', 1_000_000);
    state.airport.updateOperationalStatus(() => false, () => false);

    const stats = buildFreightStats(state);

    expect(stats.airports, '壞掉的機場從清單裡消失了').toHaveLength(1);
    expect(stats.airports[0]!.operational).toBe(false);
    expect(stats.airports[0]!.cargo, '壞掉的機場還在算吞吐').toBe(0);
    expect(stats.airportThroughput).toBe(0);
  });

  it('should count a working airport', () => {
    // 反過來也要成立 —— 不然「吞吐永遠是 0」也會讓上面那條通過。
    const state = createGameState(8, 8);
    state.airport.build(2, 2, 'SMALL', 1_000_000);
    state.airport.updateOperationalStatus(() => true, () => true);

    const stats = buildFreightStats(state);

    expect(stats.airports[0]!.operational).toBe(true);
    expect(stats.airportThroughput).toBeGreaterThan(0);
  });

  it('should add up every way goods can get in and out', () => {
    const state = createGameState(8, 8);
    const s = buildFreightStats(state);

    expect(s.totalThroughput).toBe(s.railThroughput + s.airportThroughput + s.highwayThroughput);
  });

  it('should carry the multipliers the panel prints as Income Impact', () => {
    // 面板底下那一段寫著進口 ×0.7、出口 ×0.5。呼叫端要能算出「多蓋一條鐵路值不值」
    // 就需要這兩個數。
    const s = buildFreightStats(createGameState(8, 8));

    expect(s.importIncomeMultiplier).toBe(TRADE.IMPORT_INCOME_MULTIPLIER);
    expect(s.exportIncomeMultiplier).toBe(TRADE.EXPORT_INCOME_MULTIPLIER);
  });
});
