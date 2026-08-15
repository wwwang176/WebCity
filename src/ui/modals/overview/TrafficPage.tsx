import { createSignal, createMemo, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { getTransitSystems } from '../../../core/transport/TransportRegistry';
import { TransportType } from '../../../core/transport/types';
import { UI_COLORS } from '../../constants';
import { COMMUTE_BUCKET_EDGES } from '../../../core/citizen/CommuteStats';

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

interface RouteRow {
  id: number;
  stops: number;
  vehicles: number;
  riders: number;
  capacity: number;
  cost: number;
  suspended: boolean;
}

interface SystemRow {
  type: TransportType;
  label: string;
  color: string;
  icon: string;
  routeCount: number;
  totalVehicles: number;
  totalRiders: number;
  totalCapacity: number;
  totalCost: number;
  routeRows: RouteRow[];
}

export function TrafficPage(props: { onClose?: () => void }) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [selectedTransfer, setSelectedTransfer] = createSignal<string | null>(null);

  const toggle = (type: string) => {
    const next = new Set(expanded());
    if (next.has(type)) next.delete(type); else next.add(type);
    setExpanded(next);
  };

  const stats = createMemo(() => {
    gameSignals.tick();
    return getGame().getTrafficStats();
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const transferStats = createMemo(() => {
    gameSignals.tick();
    return getGame().getTransferStats();
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /**
   * 通勤統計。與地圖上的 Commute 圖層讀同一份 —— 兩邊各算一次的話，地圖紅通通
   * 而面板說一切良好，玩家不知道該信哪一個。
   */
  const commute = createMemo(() => {
    gameSignals.tick();
    const s = getGame().getCommuteStats();
    return {
      sampled: s.sampled, average: s.average, median: s.median,
      overThreshold: s.overThreshold, buckets: s.buckets,
      byMode: s.byMode, worst: s.worst,
      threshold: getGame().commuteThreshold,
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const bucketLabels = () => {
    const e = COMMUTE_BUCKET_EDGES;
    return [`< ${e[0]}`, ...e.slice(1).map((v, i) => `${e[i]}–${v}`), `${e[e.length - 1]}+`];
  };

  const share = (n: number) => Math.round(n / Math.max(1, commute().sampled) * 100);

  const transitData = createMemo(() => {
    gameSignals.tick();
    const state = getGame().getState();
    const systems = getTransitSystems(state as any);
    let totalCost = 0;

    const rows: SystemRow[] = systems.map(({ type, system }) => {
      const routes = system.getRoutes();
      const cost = system.getOperatingCost();
      totalCost += cost;

      let totalRiders = 0;
      for (const stop of system.getStops()) {
        totalRiders += stop.smoothedDailyRiders;
      }

      const vehicleCapacity = system.getCapacity();
      const routeRows: RouteRow[] = routes.map(route => {
        let riders = 0;
        for (const stop of route.stops) {
          riders += stop.smoothedDailyRiders;
        }
        return {
          id: route.id,
          stops: route.stops.length,
          vehicles: route.vehicles,
          riders,
          capacity: route.vehicles * vehicleCapacity,
          cost: route.operatingCost,
          suspended: !!route.suspended,
        };
      });

      return {
        type,
        label: TYPE_LABELS[type] ?? type,
        color: TYPE_COLORS[type] ?? '#888',
        icon: TYPE_ICONS[type] ?? '',
        routeCount: routes.length,
        totalVehicles: system.getVehicles().length,
        totalRiders,
        totalCapacity: routeRows.reduce((s, r) => s + r.capacity, 0),
        totalCost: cost,
        routeRows,
      };
    });

    const airports = state.airport.getAirports();
    const airportCost = state.airport.getOperatingCost();
    totalCost += airportCost;

    return { rows, totalCost, airportCount: airports.length, airportCost };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

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

      <div class="section-title">Commute Time</div>
      <Show
        when={commute().sampled > 0}
        fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No commuters yet</div>}
      >
        <div class="summary-grid">
          <div class="summary-card">
            <div class="sc-value">{commute().median.toFixed(0)}</div>
            <div class="sc-label">Median</div>
          </div>
          <div class="summary-card">
            <div class="sc-value">{commute().average.toFixed(0)}</div>
            <div class="sc-label">Average</div>
          </div>
          <div class="summary-card">
            <div
              class="sc-value"
              style={`color:${share(commute().overThreshold) > 25 ? UI_COLORS.STATUS_BAD : commute().overThreshold > 0 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD}`}
            >
              {share(commute().overThreshold)}%
            </div>
            <div class="sc-label">Over {commute().threshold}</div>
          </div>
          <div class="summary-card">
            <div class="sc-value stat-accent">{commute().sampled}</div>
            <div class="sc-label">Commuters</div>
          </div>
        </div>

        <table class="data-table">
          <thead><tr><th>Commute</th><th style="text-align:right">Citizens</th><th>Share</th></tr></thead>
          <tbody>
            <For each={commute().buckets}>
              {(count, i) => (
                <tr>
                  <td class="td-label">{bucketLabels()[i()]}</td>
                  <td class="td-value" style="text-align:right">{count}</td>
                  <td>
                    <div class="cong-bar-bg">
                      <div
                        class="cong-bar"
                        style={`width:${share(count)}%;background:${i() === commute().buckets.length - 1 ? UI_COLORS.STATUS_BAD : UI_COLORS.STATUS_GOOD}`}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <div class="section-title">How People Travel</div>
        <table class="data-table">
          <thead><tr><th>Mode</th><th style="text-align:right">Citizens</th><th style="text-align:right">Share</th></tr></thead>
          <tbody>
            <For each={Object.entries(commute().byMode).sort((a, b) => b[1] - a[1])}>
              {(entry) => (
                <tr>
                  <td class="td-label">{entry[0]}</td>
                  <td class="td-value" style="text-align:right">{entry[1]}</td>
                  <td class="td-value" style="text-align:right">{share(entry[1])}%</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <Show when={commute().worst.length > 0}>
          <div class="section-title">Worst Commutes</div>
          <table class="data-table">
            <thead><tr><th>Home</th><th style="text-align:right">Residents</th><th style="text-align:right">Commute</th></tr></thead>
            <tbody>
              <For each={commute().worst}>
                {(w) => (
                  <tr
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      const parts = w.pos.split(',');
                      getGame().focusCell(Number(parts[0]), Number(parts[1]));
                      props.onClose?.();
                    }}
                  >
                    <td class="td-label">({w.pos})</td>
                    <td class="td-value" style="text-align:right">{w.residents}</td>
                    <td
                      class="td-value"
                      style={`text-align:right;color:${w.time > commute().threshold ? UI_COLORS.STATUS_BAD : UI_COLORS.STATUS_WARN}`}
                    >
                      {w.time.toFixed(0)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>

      <div class="section-title">Top Congested Segments</div>
      <Show when={stats().topCongested.length > 0} fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No congestion data</div>}>
        <table class="data-table">
          <thead><tr><th>Location</th><th>Flow</th><th>Congestion</th></tr></thead>
          <tbody>
            <For each={stats().topCongested}>
              {(seg) => {
                const maxDensity = () => stats().topCongested[0]?.density ?? 1;
                const pct = () => Math.round((seg.density / maxDensity()) * 100);
                const color = () => pct() > 75 ? UI_COLORS.STATUS_BAD : pct() > 40 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD;
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
      <Show when={transitData().rows.some(r => r.routeCount > 0)} fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No transit routes yet</div>}>
        <table class="data-table">
          <thead><tr><th>System / Route</th><th style="text-align:right">Stops</th><th style="text-align:right">Vehicles</th><th style="text-align:right">Riders/Wk</th><th style="text-align:right">Usage</th><th style="text-align:right">Cost/tick</th></tr></thead>
          <tbody>
            <For each={transitData().rows}>
              {(row) => {
                const isOpen = () => expanded().has(row.type);
                return (
                  <>
                    <tr
                      style={{ cursor: row.routeCount > 0 ? 'pointer' : 'default' }}
                      onClick={() => { if (row.routeCount > 0) toggle(row.type); }}
                    >
                      <td class="td-label" style="display:flex;align-items:center;gap:4px">
                        <Show when={row.routeCount > 0}>
                          <span style="font-size:10px;width:12px;display:inline-block">{isOpen() ? '\u25BC' : '\u25B6'}</span>
                        </Show>
                        <span>{row.icon}</span>
                        <span style={{ color: row.color }}>{row.label}</span>
                        <span style="color:#667a90;font-size:11px;margin-left:2px">({row.routeCount})</span>
                      </td>
                      <td class="td-value" style="text-align:right">{row.routeRows.reduce((s, r) => s + r.stops, 0)}</td>
                      <td class="td-value" style="text-align:right">{row.totalVehicles}</td>
                      <td class="td-value" style="text-align:right">{Math.round(row.totalRiders * 7)}</td>
                      <td class="td-value" style={`text-align:right;color:${row.totalCapacity > 0 && row.totalRiders / row.totalCapacity > 0.8 ? UI_COLORS.STATUS_BAD : row.totalCapacity > 0 && row.totalRiders / row.totalCapacity > 0.5 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD}`}>{row.totalCapacity > 0 ? `${Math.min(100, Math.round(row.totalRiders / row.totalCapacity * 100))}%` : '—'}</td>
                      <td class="td-expense" style="text-align:right">${row.totalCost}</td>
                    </tr>
                    <Show when={isOpen()}>
                      <For each={row.routeRows}>
                        {(route) => (
                          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <td style="padding-left:32px;font-size:11px;color:#8899b0">
                              Route #{route.id}
                              {route.suspended ? <span style={`color:${UI_COLORS.STATUS_BAD};margin-left:6px`}>(suspended)</span> : ''}
                            </td>
                            <td class="td-value" style="text-align:right;font-size:11px">{route.stops}</td>
                            <td class="td-value" style="text-align:right;font-size:11px">{route.vehicles}</td>
                            <td class="td-value" style="text-align:right;font-size:11px">{Math.round(route.riders * 7)}</td>
                            <td class="td-value" style={`text-align:right;font-size:11px;color:${route.capacity > 0 && route.riders / route.capacity > 0.8 ? UI_COLORS.STATUS_BAD : route.capacity > 0 && route.riders / route.capacity > 0.5 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD}`}>{route.capacity > 0 ? `${Math.min(100, Math.round(route.riders / route.capacity * 100))}%` : '—'}</td>
                            <td class="td-expense" style="text-align:right;font-size:11px">${route.cost}</td>
                          </tr>
                        )}
                      </For>
                    </Show>
                  </>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>

      <Show when={transitData().airportCount > 0}>
        <div style="font-size:12px;color:#8899b0;margin-top:8px">
          Airports: <span style={`color:${UI_COLORS.NEUTRAL};font-weight:500`}>{transitData().airportCount}</span>
          <span style="margin-left:12px">Cost: <span class="td-expense">${transitData().airportCost}/tick</span></span>
        </div>
      </Show>

      <div style={{
        'margin-top': '12px', padding: '8px 12px', 'border-radius': '6px',
        'font-size': '12px', background: 'rgba(40,55,90,0.3)', color: '#b0c4de',
      }}>
        Total transit cost: <span style="color:#ef9a9a;font-weight:600">${transitData().totalCost}/tick</span>
      </div>

      <Show when={transferStats().multiRideRoutes > 0}>
        <div class="section-title">Multi-Modal Transfers</div>
        <div class="summary-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="summary-card">
            <div class="sc-value stat-accent">{transferStats().activeTransferPeds}</div>
            <div class="sc-label">Active Transfers</div>
          </div>
          <div class="summary-card">
            <div class="sc-value">{transferStats().multiRideRoutes}</div>
            <div class="sc-label">Transfer Routes</div>
          </div>
          <div class="summary-card">
            <div class="sc-value">{transferStats().transferEdges}</div>
            <div class="sc-label">Transfer Points</div>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>Route</th><th style="text-align:right">Rides</th><th style="text-align:right">Variants</th><th style="text-align:right">Riders/Wk</th><th style="text-align:right">Avg Time</th></tr></thead>
          <tbody>
            <For each={transferStats().routeBreakdown.filter(r => r.rides >= 2)}>
              {(row) => {
                const isSelected = () => selectedTransfer() === row.label;
                const onClick = () => {
                  const next = isSelected() ? null : row.label;
                  setSelectedTransfer(next);
                  getGame().selectTransferRoute(next);
                  if (next && props.onClose) props.onClose();
                };
                return (
                <tr
                  style={{ cursor: 'pointer', background: isSelected() ? 'rgba(66,165,245,0.15)' : undefined }}
                  onClick={onClick}
                >
                  <td class="td-label">{row.label}</td>
                  <td class="td-value" style="text-align:right">{row.rides}</td>
                  <td class="td-value" style="text-align:right">{row.count}</td>
                  <td class="td-value" style={`text-align:right;color:${row.weeklyUse > 0 ? UI_COLORS.STATUS_GOOD : '#667a90'}`}>{row.weeklyUse}</td>
                  <td class="td-value" style="text-align:right">{row.avgTime.toFixed(1)}</td>
                </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </>
  );
}
