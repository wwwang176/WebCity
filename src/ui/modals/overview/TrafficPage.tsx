import { createSignal, createMemo, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { getTransitSystems } from '../../../core/transport/TransportRegistry';
import { TransportType } from '../../../core/transport/types';
import { UI_COLORS } from '../../constants';
import { type RouteLoadStatus } from '../../../core/transport/RouteLoad';
import { buildTransitRows, type SystemStatus, type TransitSystemRow } from './transitRows';
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

/** One `transitRows` row plus the label and colour this table needs. */
type SystemRow = TransitSystemRow & { label: string; color: string; icon: string };

/** The load factor's colours. The band boundaries are not arbitrary; see `routeLoadStatus`. */
const USAGE_COLOR: Record<SystemStatus, string> = {
  // No routes at all: neither good nor bad, so a neutral colour. Green reads as the system working
  // well.
  none: UI_COLORS.NEUTRAL,
  comfortable: UI_COLORS.STATUS_GOOD,
  crowded: UI_COLORS.STATUS_WARN,
  overloaded: UI_COLORS.STATUS_BAD,
  // Hopeless shares overloaded's red: the difference is in the wording, not the colour. A second red
  // only becomes indistinguishable.
  hopeless: UI_COLORS.STATUS_BAD,
};

/** The hint shown on hover. The colour says there is a problem; this says what happened. */
const USAGE_HINT: Record<SystemStatus, string> = {
  none: 'No routes on this system yet.',
  comfortable: 'Everyone gets a seat on the next vehicle.',
  crowded: 'Some riders are left behind and wait for the vehicle after.',
  overloaded: 'The wait for a free seat now exceeds the wait for the vehicle itself.',
  hopeless: 'Riders watch two full vehicles go past before boarding. Add vehicles.',
};

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
   * The commute statistics, read from the same source as the map's Commute overlay: computed
   * separately, the map turns red while the panel reports everything fine and the player has no way to
   * tell which to believe.
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

    // Every number comes from `transitRows`: computed again in the panel, the units came out wrong
    // (BUG-342).
    const built = buildTransitRows(
      systems.map(({ type, system }) => ({
        type,
        routes: system.getRoutes(),
        stops: system.getStops(),
        seatsPerVehicle: system.getCapacity(),
        speed: system.getSpeed(),
        vehicleCount: system.getVehicles().length,
        operatingCost: system.getOperatingCost(),
        segmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
      })),
    );
    for (const row of built) totalCost += row.totalCost;

    const rows: SystemRow[] = built.map(row => ({
      ...row,
      label: TYPE_LABELS[row.type] ?? row.type,
      color: TYPE_COLORS[row.type] ?? '#888',
      icon: TYPE_ICONS[row.type] ?? '',
    }));

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
        {/* Counts only the cars residents drive. Through traffic, freight and service vehicles have
            nothing to do with mode choice, and counted in they hold the figure up even once a policy
            has moved people onto buses. */}
        <div class="summary-card" title="Residents currently driving to or from work. Through traffic, freight and service vehicles are not counted.">
          <div class="sc-value stat-accent">{stats().commuteVehicleCount}</div>
          <div class="sc-label">Commuters Driving</div>
        </div>
        <div class="summary-card" title="Average distance of the trips residents are driving to or from work.">
          <div class="sc-value">{stats().commuteAvgPathLength}</div>
          <div class="sc-label">Avg Commute Distance</div>
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
                      <td class="td-value" style="text-align:right">{row.totalStops}</td>
                      <td class="td-value" style="text-align:right">{row.totalVehicles}</td>
                      <td class="td-value" style="text-align:right">{Math.round(row.totalRiders * 7)}</td>
                      {/* The collapsed and expanded rows share one set of thresholds and neither clamps
                          at 100%. With its own 0.5 / 0.8 bands and a `Math.min(100, ...)` on top, a
                          route genuinely turning people away looked merely somewhat full when
                          collapsed. */}
                      <td
                        class="td-value"
                        style={`text-align:right;color:${USAGE_COLOR[row.status]}`}
                        title={USAGE_HINT[row.status]}
                      >{row.usage}</td>
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
                            {/* Not clamped at 100%: a route at 105% and one at 400% have to look
                                different, as that is the only basis for deciding how many vehicles to
                                add. The colours follow the simulation's three bands — yellow is waits
                                growing longer, red is people genuinely unable to board, the route
                                having dropped out of their options. */}
                            <td
                              class="td-value"
                              style={`text-align:right;font-size:11px;color:${USAGE_COLOR[route.status]}`}
                              title={USAGE_HINT[route.status]}
                            >{route.usage}</td>
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
