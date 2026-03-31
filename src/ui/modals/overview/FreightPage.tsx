import { createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { ZoneType } from '../../../core/grid/types';
import { TRADE } from '../../../core/traffic/FreightSystem';
import { HIGHWAY_EXTERNAL } from '../../../core/traffic/HighwayConnection';
import { UI_COLORS } from '../../constants';

function supplyColor(ratio: number): string {
  if (ratio > 1.5 || ratio < 0.5) return UI_COLORS.STATUS_BAD;
  if (ratio > 1.2 || ratio < 0.8) return UI_COLORS.STATUS_WARN;
  return UI_COLORS.STATUS_GOOD;
}

export function FreightPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    const state = getGame().getState();

    const freight = state.freight;
    const demand = freight.getLastDemand();
    const trade = freight.getLastTrade();
    const effectiveProd = demand.production - trade.exported + trade.imported;
    const supplyRatio = demand.consumption > 0 ? effectiveProd / demand.consumption : 1;

    // Counts
    const suppliedCount = freight.getSuppliedCount();
    const localCount = freight.getLocalSuppliedCount();
    const importedCount = freight.getImportedCount();

    // Commercial building count from grid
    let totalCommercial = 0;
    state.grid.forEachCell((cell) => {
      if (cell.buildingId > 0 && (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH)) {
        totalCommercial++;
      }
    });
    const unsuppliedCount = totalCommercial - suppliedCount;

    // Trade facilities
    const rail = state.rail;
    const extStations = rail.getExternalStationCount();
    const railThroughput = rail.hasExternalConnection ? extStations * TRADE.RAIL_THROUGHPUT_PER_STATION : 0;

    const airports = state.airport.getAirports();
    let airportThroughput = 0;
    const airportDetails: { size: string; cargo: number; operational: boolean }[] = [];
    for (const ap of airports) {
      const operational = state.airport.isAirportOperational(ap.id);
      const effectiveCargo = operational ? ap.cargoPerTick : 0;
      airportThroughput += effectiveCargo;
      airportDetails.push({ size: ap.size, cargo: effectiveCargo, operational });
    }

    const hc = state.highwayConnection;
    const highwayThroughput = hc.hasExternalConnection ? hc.getThroughput() : 0;
    const highwayConnections = hc.getEdgeHighwayCellCount();

    const totalThroughput = railThroughput + airportThroughput + highwayThroughput;

    return {
      supplyRatio,
      production: demand.production,
      consumption: demand.consumption,
      shortage: demand.shortage,
      suppliedCount, localCount, importedCount, unsuppliedCount, totalCommercial,
      imported: trade.imported,
      exported: trade.exported,
      totalThroughput,
      railThroughput, extStations, totalStations: rail.getStations().length,
      hasRailConnection: rail.hasExternalConnection,
      highwayThroughput, highwayConnections,
      hasHighwayConnection: hc.hasExternalConnection,
      airportThroughput, airportDetails,
      surplusRatio: freight.getSurplusRatio(),
      isExporting: freight.getIsExporting(),
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  return (
    <>
      {/* Supply Overview */}
      <div class="section-title">Supply Overview</div>
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899b0;margin-bottom:4px">
          <span>Supply Rate</span>
          <span style={{ color: supplyColor(data().supplyRatio) }}>
            {(data().supplyRatio * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, data().supplyRatio * 100)}%`, height: '100%', 'border-radius': '3px',
            background: supplyColor(data().supplyRatio),
            transition: 'width 0.3s',
          }} />
        </div>
      </div>

      <div class="summary-grid" style="margin-bottom:12px">
        <div class="summary-card"><div class="sc-value" style={`color:${UI_COLORS.STATUS_WARN}`}>{data().production}</div><div class="sc-label">Production/tick</div></div>
        <div class="summary-card"><div class="sc-value" style={`color:${UI_COLORS.ACCENT}`}>{data().consumption}</div><div class="sc-label">Consumption/tick</div></div>
      </div>

      {/* Commercial Supply Status */}
      <div class="section-title">Commercial Supply</div>
      <table class="data-table" style="margin-bottom:12px">
        <thead><tr><th>Status</th><th style="text-align:right">Shops</th></tr></thead>
        <tbody>
          <tr><td class="td-label" style={`color:${UI_COLORS.STATUS_GOOD}`}>Local Supply</td><td class="td-value" style="text-align:right">{data().localCount}</td></tr>
          <tr><td class="td-label" style={`color:${UI_COLORS.STATUS_WARN}`}>Imported</td><td class="td-value" style="text-align:right">{data().importedCount}</td></tr>
          <tr><td class="td-label" style={`color:${UI_COLORS.STATUS_BAD}`}>Unsupplied</td><td class="td-value" style="text-align:right">{data().unsuppliedCount}</td></tr>
          <tr style="border-top:1px solid rgba(100,120,150,0.3)">
            <td class="td-label" style="font-weight:600">Total</td>
            <td class="td-value" style="text-align:right;font-weight:600">{data().totalCommercial}</td>
          </tr>
        </tbody>
      </table>

      {/* Trade */}
      <div class="section-title">Trade</div>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <div style="flex:1;padding:8px 12px;border-radius:6px;background:rgba(255,167,38,0.1)">
          <div style="font-size:10px;color:#8899b0;margin-bottom:2px">Import</div>
          <div style={`font-size:16px;font-weight:600;color:${UI_COLORS.STATUS_WARN}`}>{data().imported}<span style="font-size:11px;font-weight:400">/tick</span></div>
        </div>
        <div style="flex:1;padding:8px 12px;border-radius:6px;background:rgba(102,187,106,0.1)">
          <div style="font-size:10px;color:#8899b0;margin-bottom:2px">Export</div>
          <div style={`font-size:16px;font-weight:600;color:${UI_COLORS.STATUS_GOOD}`}>{data().exported}<span style="font-size:11px;font-weight:400">/tick</span></div>
        </div>
      </div>

      {/* Trade Facilities */}
      <div class="section-title">Trade Facilities</div>
      <table class="data-table" style="margin-bottom:8px">
        <thead><tr><th>Facility</th><th style="text-align:right">Throughput</th></tr></thead>
        <tbody>
          <tr>
            <td class="td-label">
              Rail ({data().extStations}/{data().totalStations} stations)
              {!data().hasRailConnection && <span style={`color:${UI_COLORS.STATUS_BAD};font-size:10px`}> (no edge connection)</span>}
            </td>
            <td class="td-value" style="text-align:right">{data().railThroughput}/tick</td>
          </tr>
          <tr>
            <td class="td-label">
              Highway ({data().highwayConnections} connections)
              {!data().hasHighwayConnection && <span style={`color:${UI_COLORS.STATUS_BAD};font-size:10px`}> (no edge connection)</span>}
            </td>
            <td class="td-value" style="text-align:right">{data().highwayThroughput}/tick</td>
          </tr>
          {data().airportDetails.length > 0
            ? data().airportDetails.map((ap, i) => (
                <tr>
                  <td class="td-label">
                    Airport ({ap.size})
                    {!ap.operational && <span style={`color:${UI_COLORS.STATUS_BAD};font-size:10px`}> (no power/water)</span>}
                  </td>
                  <td class="td-value" style={`text-align:right${!ap.operational ? `;color:${UI_COLORS.STATUS_BAD}` : ''}`}>{ap.cargo}/tick</td>
                </tr>
              ))
            : <tr><td class="td-label" style="color:#616161">No airport</td><td class="td-value" style="text-align:right">0</td></tr>
          }
          <tr style="border-top:1px solid rgba(100,120,150,0.3)">
            <td class="td-label" style="font-weight:600">Total Capacity</td>
            <td class="td-value" style="text-align:right;font-weight:600">{data().totalThroughput}/tick</td>
          </tr>
        </tbody>
      </table>

      {/* Income Impact */}
      <div class="section-title">Income Impact</div>
      <div style="font-size:11px;color:#8899b0">
        <div style="margin-bottom:4px">Local supply: income <span style={`color:${UI_COLORS.STATUS_GOOD}`}>×1.0</span></div>
        <div style="margin-bottom:4px">Imported goods: income <span style={`color:${UI_COLORS.STATUS_WARN}`}>×{TRADE.IMPORT_INCOME_MULTIPLIER}</span></div>
        <div style="margin-bottom:4px">Exported goods: income <span style={`color:${UI_COLORS.STATUS_WARN}`}>×{TRADE.EXPORT_INCOME_MULTIPLIER}</span></div>
        <div>Unsupplied: income <span style={`color:${UI_COLORS.STATUS_BAD}`}>×0.5</span> + abandonment stress</div>
      </div>
    </>
  );
}
