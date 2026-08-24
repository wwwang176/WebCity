import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildFreightStats } from '../FreightStats';
import { TRADE } from '../../traffic/FreightSystem';
import { ZoneType } from '../../grid/types';

/**
 * Freight supply chain.
 *
 * ## Why this is a module of its own
 *
 * Computed inside `FreightPage.tsx`'s `createMemo`, these numbers reach only the player's
 * screen, and a second copy on the API side is BUG-342: one figure recorded in two places,
 * drifting apart in silence. The panel and the API both call this instead.
 *
 * ## Effective supply is not production
 *
 * `production` is what local factories make, but what shops can actually get is
 * **production - exported + imported**. Leave the trade terms out and a city sustained by
 * imports reads as out of stock while the player's screen says 75%.
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
    // Goods that leave as exports are no longer available to local shops.
    const state = createGameState(8, 8);
    state.freight.getLastDemand().production = 100;
    state.freight.getLastDemand().consumption = 100;
    state.freight.getLastTrade().exported = 40;

    expect(buildFreightStats(state).effectiveProduction, '出口沒扣掉').toBe(60);
  });

  it('should call it fully supplied when nobody is consuming anything', () => {
    // Division by zero. An empty city's supply ratio is 1, not NaN, which the panel would
    // print as "NaN%".
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
    // Zoned commercial land with nothing built is not a shop; counting it drags the supply
    // ratio down for no visible reason.
    const state = createGameState(8, 8);
    state.grid.setCell(1, 1, { zoneType: ZoneType.COMMERCIAL_LOW });

    expect(buildFreightStats(state).totalCommercial).toBe(0);
  });

  it('should rate rail by the stations that reach the edge, not by every station', () => {
    // A station in the middle of the city with no path to the edge ships nothing out.
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
    // An airport without power or water is still listed (the player has to see it is down)
    // but its throughput is 0.
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
    // The converse has to hold too, or "throughput is always 0" would pass the case above.
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
    // The panel's footer states import x0.7 and export x0.5. A caller needs both numbers to
    // work out whether another rail line is worth building.
    const s = buildFreightStats(createGameState(8, 8));

    expect(s.importIncomeMultiplier).toBe(TRADE.IMPORT_INCOME_MULTIPLIER);
    expect(s.exportIncomeMultiplier).toBe(TRADE.EXPORT_INCOME_MULTIPLIER);
  });
});
