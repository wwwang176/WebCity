import { For, Show } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { getTransitSystems } from '../../../core/transport/TransportRegistry';
import { TransportType } from '../../../core/transport/types';

const TYPE_LABELS: Record<string, string> = {
  [TransportType.BUS]: 'Bus',
  [TransportType.METRO]: 'Metro',
  [TransportType.RAIL]: 'Rail',
  [TransportType.FERRY]: 'Ferry',
};
const TYPE_COLORS: Record<string, string> = {
  [TransportType.BUS]: '#ff9800',
  [TransportType.METRO]: '#00bcd4',
  [TransportType.RAIL]: '#795548',
  [TransportType.FERRY]: '#0288d1',
};
const TYPE_ICONS: Record<string, string> = {
  [TransportType.BUS]: '\uD83D\uDE8C',
  [TransportType.METRO]: '\uD83D\uDE87',
  [TransportType.RAIL]: '\uD83D\uDE82',
  [TransportType.FERRY]: '\u26F4',
};

export function TrafficPage() {
  const stats = () => {
    gameSignals.tick();
    return getGame().getTrafficStats();
  };

  const transitData = () => {
    gameSignals.tick();
    const state = getGame().getState();
    const systems = getTransitSystems(state as any);
    let totalCost = 0;

    const rows = systems.map(({ type, system }) => {
      const routes = system.getRoutes();
      const vehicles = system.getVehicles();
      const cost = system.getOperatingCost();
      totalCost += cost;
      return {
        type,
        label: TYPE_LABELS[type] ?? type,
        color: TYPE_COLORS[type] ?? '#888',
        icon: TYPE_ICONS[type] ?? '',
        routes: routes.length,
        vehicles: vehicles.length,
        cost,
      };
    });

    // Airport
    const airports = state.airport.getAirports();
    const airportCost = state.airport.getOperatingCost();
    totalCost += airportCost;

    return { rows, totalCost, airportCount: airports.length, airportCost };
  };

  return (
    <>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="sc-value stat-accent">{stats().vehicleCount}</div>
          <div class="sc-label">Active Vehicles</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">{stats().avgPathLength}</div>
          <div class="sc-label">Avg Path Length</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">{stats().totalRoads}</div>
          <div class="sc-label">Road Tiles</div>
        </div>
        <div class="summary-card">
          <div class="sc-value">{stats().topCongested.length > 0 ? Math.round(stats().topCongested[0]!.density) : 0}</div>
          <div class="sc-label">Peak Density</div>
        </div>
      </div>

      <div class="section-title">Top Congested Segments</div>
      <Show when={stats().topCongested.length > 0} fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No congestion data</div>}>
        <table class="data-table">
          <thead><tr><th>Location</th><th>Flow</th><th>Congestion</th></tr></thead>
          <tbody>
            <For each={stats().topCongested}>
              {(seg) => {
                const maxDensity = () => stats().topCongested[0]?.density ?? 1;
                const pct = () => Math.round((seg.density / maxDensity()) * 100);
                const color = () => pct() > 75 ? '#ef5350' : pct() > 40 ? '#ffa726' : '#66bb6a';
                return (
                  <tr>
                    <td class="td-label">({seg.segment})</td>
                    <td class="td-value">{Math.round(seg.density)}</td>
                    <td>
                      <div class="cong-bar-bg">
                        <div class="cong-bar-fill" style={{ width: `${pct()}%`, background: color() }} />
                      </div>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>

      <div class="section-title">Public Transit</div>
      <Show when={transitData().rows.some(r => r.routes > 0)} fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No transit routes yet</div>}>
        <table class="data-table">
          <thead><tr><th>System</th><th style="text-align:right">Routes</th><th style="text-align:right">Vehicles</th><th style="text-align:right">Cost/tick</th></tr></thead>
          <tbody>
            <For each={transitData().rows}>
              {(row) => (
                <tr>
                  <td class="td-label" style="display:flex;align-items:center;gap:4px">
                    <span>{row.icon}</span>
                    <span style={{ color: row.color }}>{row.label}</span>
                  </td>
                  <td class="td-value" style="text-align:right">{row.routes}</td>
                  <td class="td-value" style="text-align:right">{row.vehicles}</td>
                  <td class="td-expense" style="text-align:right">${row.cost}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <Show when={transitData().airportCount > 0}>
        <div style="font-size:12px;color:#8899b0;margin-top:8px">
          Airports: <span style="color:#d0d8e8;font-weight:500">{transitData().airportCount}</span>
          <span style="margin-left:12px">Cost: <span class="td-expense">${transitData().airportCost}/tick</span></span>
        </div>
      </Show>

      <div style={{
        'margin-top': '12px', padding: '8px 12px', 'border-radius': '6px',
        'font-size': '12px', background: 'rgba(40,55,90,0.3)', color: '#b0c4de',
      }}>
        Total transit cost: <span style="color:#ef9a9a;font-weight:600">${transitData().totalCost}/tick</span>
      </div>
    </>
  );
}
