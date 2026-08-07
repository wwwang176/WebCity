import { createSignal, createEffect, Show, For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { RailServiceType } from '../../core/transport/RailSystem';
import type { TransportStop } from '../../core/transport/types';
import { PALETTE, toCSS } from '../../ColorPalette';

export function TransitModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);
  const [routeBuilder, setRouteBuilder] = createSignal<{ type: string; selectedIds: number[] } | null>(null);

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const transitData = () => {
    version();
    gameSignals.tick(); // reactive: throttled live-refresh
    const state = getGame().getState();
    return {
      busStops: state.bus.getStops(),
      busRoutes: state.bus.getRoutes(),
      busCost: state.bus.getOperatingCost(),
      metroStations: state.metro.getStations(),
      metroLines: state.metro.getLines(),
      metroCost: state.metro.getOperatingCost(),
      railStations: state.rail.getStations(),
      railLines: state.rail.getLines(),
      railCost: state.rail.getOperatingCost(),
      railSystem: state.rail,
      ferryDocks: state.ferry.getDocks(),
      ferryRoutes: state.ferry.getRoutes(),
      ferryCost: state.ferry.getOperatingCost(),
      airports: state.airport.getAirports(),
      airportCost: state.airport.getOperatingCost(),
    };
  };

  const hasAny = () => {
    const d = transitData();
    return d.busStops.length > 0 || d.metroStations.length > 0
      || d.railStations.length > 0 || d.ferryDocks.length > 0
      || d.airports.length > 0;
  };

  const createRouteAll = (type: string) => {
    const state = getGame().getState();
    if (type === 'bus') {
      const stops = [...state.bus.getStops()];
      if (stops.length >= 2) {
        if (!getGame().createBusRoute(stops, 1)) {
          getGame().showNotification('No road path between bus stops!');
          return;
        }
      }
    } else if (type === 'metro') {
      const stations = [...state.metro.getStations()];
      if (stations.length >= 2) state.metro.createLine(stations, 1);
    } else if (type === 'rail') {
      const stations = [...state.rail.getStations()];
      if (stations.length >= 2) state.rail.createLine(stations, RailServiceType.PASSENGER, 1);
    } else if (type === 'ferry') {
      const docks = [...state.ferry.getDocks()];
      if (docks.length >= 2) {
        if (!state.ferry.validateRouteConnectivity(docks)) {
          getGame().showNotification('No navigable water route between docks!');
          return;
        }
        state.ferry.createRoute(docks, 1);
      }
    }
    getGame().markTransitNetworkDirty();
    setVersion(v => v + 1);
  };

  const getStopsForType = (type: string): readonly TransportStop[] => {
    const state = getGame().getState();
    if (type === 'bus') return state.bus.getStops();
    if (type === 'metro') return state.metro.getStations();
    if (type === 'rail') return state.rail.getStations();
    if (type === 'ferry') return state.ferry.getDocks();
    return [];
  };

  const startRouteBuilder = (type: string) => {
    setRouteBuilder({ type, selectedIds: [] });
  };

  const toggleStopInBuilder = (stopId: number) => {
    const rb = routeBuilder();
    if (!rb) return;
    const ids = rb.selectedIds.includes(stopId)
      ? rb.selectedIds.filter(id => id !== stopId)
      : [...rb.selectedIds, stopId];
    setRouteBuilder({ ...rb, selectedIds: ids });
  };

  const confirmRouteBuilder = () => {
    const rb = routeBuilder();
    if (!rb || rb.selectedIds.length < 2) return;
    const state = getGame().getState();
    const allStops = getStopsForType(rb.type);
    const selected = rb.selectedIds.map(id => allStops.find(s => s.id === id)!).filter(Boolean);
    if (selected.length < 2) return;

    if (rb.type === 'bus') {
      if (!getGame().createBusRoute([...selected], 1)) {
        getGame().showNotification('No road path between bus stops!');
        return;
      }
    } else if (rb.type === 'metro') state.metro.createLine([...selected], 1);
    else if (rb.type === 'rail') state.rail.createLine([...selected], RailServiceType.PASSENGER, 1);
    else if (rb.type === 'ferry') {
      if (!state.ferry.validateRouteConnectivity([...selected])) {
        getGame().showNotification('No navigable water route between selected docks!');
        return;
      }
      state.ferry.createRoute([...selected], 1);
    }

    setRouteBuilder(null);
    getGame().markTransitNetworkDirty();
    setVersion(v => v + 1);
  };

  const addVehicle = (type: string, routeId: number) => {
    const state = getGame().getState();
    if (type === 'bus') getGame().addBusVehicle(routeId);
    else if (type === 'metro') state.metro.addVehicleToRoute(routeId);
    else if (type === 'rail') state.rail.addVehicleToRoute(routeId);
    else if (type === 'ferry') state.ferry.addVehicleToRoute(routeId);
    getGame().markTransitNetworkDirty();
    setVersion(v => v + 1);
  };

  const removeVehicle = (type: string, routeId: number) => {
    const state = getGame().getState();
    if (type === 'bus') getGame().removeBusVehicle(routeId);
    else if (type === 'metro') state.metro.removeVehicleFromRoute(routeId);
    else if (type === 'rail') state.rail.removeVehicleFromRoute(routeId);
    else if (type === 'ferry') state.ferry.removeVehicleFromRoute(routeId);
    getGame().markTransitNetworkDirty();
    setVersion(v => v + 1);
  };

  const deleteRoute = (type: string, routeId: number) => {
    const state = getGame().getState();
    if (type === 'bus') getGame().deleteBusRoute(routeId);
    else if (type === 'metro') state.metro.deleteLine(routeId);
    else if (type === 'rail') state.rail.deleteLine(routeId);
    else if (type === 'ferry') state.ferry.deleteRoute(routeId);
    getGame().markTransitNetworkDirty();
    setVersion(v => v + 1);
  };

  const sectionStyle = "background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px";
  const btnStyle = (color: string) => `margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid ${color};background:${color}22;color:${color};cursor:pointer`;
  const stopToggleStyle = (selected: boolean) => `font-size:10px;padding:2px 6px;margin:1px;border-radius:3px;border:1px solid ${selected ? '#4caf50' : '#555'};background:${selected ? '#4caf5033' : 'transparent'};color:${selected ? '#81c784' : '#888'};cursor:pointer`;

  const RouteBuilderPanel = (p: { type: string; color: string }) => {
    return (
      <Show when={routeBuilder()?.type === p.type}>
        {() => {
          const rb = () => routeBuilder()!;
          const stops = () => getStopsForType(p.type);
          return (
            <div style="margin-top:6px;padding:6px;background:#0d1520;border-radius:4px;border:1px solid #333">
              <div style="font-size:11px;color:#ccc;margin-bottom:4px">Select stops (in order):</div>
              <div style="display:flex;flex-wrap:wrap;gap:2px">
                <For each={[...stops()]}>
                  {(stop) => (
                    <button
                      style={stopToggleStyle(rb().selectedIds.includes(stop.id))}
                      onClick={() => toggleStopInBuilder(stop.id)}
                    >
                      #{stop.id} ({stop.x},{stop.y})
                    </button>
                  )}
                </For>
              </div>
              <div style="margin-top:4px;display:flex;gap:4px">
                <button
                  onClick={confirmRouteBuilder}
                  style={btnStyle(rb().selectedIds.length >= 2 ? p.color : '#555')}
                  disabled={rb().selectedIds.length < 2}
                >
                  Create ({rb().selectedIds.length} stops)
                </button>
                <button onClick={() => setRouteBuilder(null)} style={btnStyle('#666')}>Cancel</button>
              </div>
            </div>
          );
        }}
      </Show>
    );
  };

  return (
    <Modal id="transit-modal" title={'\u{1F68C} Transit Routes'} open={props.open} onClose={props.onClose} style={{ 'min-width': '400px', 'max-width': '480px' }}>
      <Show when={hasAny()} fallback={
        <div style="color:#888;text-align:center;padding:12px">No transit stops placed yet.<br />Place stops using the Transit tools, then create routes here.</div>
      }>
        {/* Bus */}
        <Show when={transitData().busStops.length > 0}>
          <div style={sectionStyle}>
            <div style="color:${toCSS(PALETTE.TRANSPORT.BUS)};font-weight:600;margin-bottom:4px">{'\u{1F68F}'} Bus System</div>
            <div style="font-size:12px;color:#aaa">Stops: {transitData().busStops.length} | Routes: {transitData().busRoutes.length} | Cost: ${transitData().busCost}/tick</div>
            <Show when={transitData().busStops.length >= 2}>
              <div style="display:flex;gap:4px">
                <button onClick={() => createRouteAll('bus')} style={btnStyle('${toCSS(PALETTE.TRANSPORT.BUS)}')}>+ All stops</button>
                <button onClick={() => startRouteBuilder('bus')} style={btnStyle('${toCSS(PALETTE.TRANSPORT.BUS)}')}>+ Custom</button>
              </div>
            </Show>
            <RouteBuilderPanel type="bus" color="${toCSS(PALETTE.TRANSPORT.BUS)}" />
            {transitData().busRoutes.map((r: any, i: number) => (
              <div style={`font-size:11px;color:${r.suspended ? '#f44336' : '#ccc'};margin-top:4px;display:flex;justify-content:space-between;align-items:center`}>
                <span>{r.suspended ? '\u26A0 ' : ''}Route {i + 1}: {r.stops.length} stops, {r.vehicles} vehicle(s){r.suspended ? ' (suspended)' : ''}</span>
                <span style="display:flex;gap:2px">
                  <button onClick={() => removeVehicle('bus', r.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #888;background:transparent;color:#aaa;cursor:pointer">-</button>
                  <button onClick={() => addVehicle('bus', r.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #4caf50;background:transparent;color:#4caf50;cursor:pointer">+</button>
                  <button onClick={() => deleteRoute('bus', r.id)} style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #f44336;background:transparent;color:#f44336;cursor:pointer">X</button>
                </span>
              </div>
            ))}
          </div>
        </Show>

        {/* Metro */}
        <Show when={transitData().metroStations.length > 0}>
          <div style={sectionStyle}>
            <div style="color:#00bcd4;font-weight:600;margin-bottom:4px">{'\u{1F687}'} Metro System</div>
            <div style="font-size:12px;color:#aaa">Stations: {transitData().metroStations.length} | Lines: {transitData().metroLines.length} | Cost: ${transitData().metroCost}/tick</div>
            <Show when={transitData().metroStations.length >= 2}>
              <div style="display:flex;gap:4px">
                <button onClick={() => createRouteAll('metro')} style={btnStyle('#00bcd4')}>+ All stations</button>
                <button onClick={() => startRouteBuilder('metro')} style={btnStyle('#00bcd4')}>+ Custom</button>
              </div>
            </Show>
            <RouteBuilderPanel type="metro" color="#00bcd4" />
            {transitData().metroLines.map((l: any, i: number) => (
              <div style="font-size:11px;color:#ccc;margin-top:4px;display:flex;justify-content:space-between;align-items:center">
                <span>Line {i + 1}: {l.stops.length} stations, {l.vehicles} train(s)</span>
                <span style="display:flex;gap:2px">
                  <button onClick={() => removeVehicle('metro', l.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #888;background:transparent;color:#aaa;cursor:pointer">-</button>
                  <button onClick={() => addVehicle('metro', l.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #4caf50;background:transparent;color:#4caf50;cursor:pointer">+</button>
                  <button onClick={() => deleteRoute('metro', l.id)} style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #f44336;background:transparent;color:#f44336;cursor:pointer">X</button>
                </span>
              </div>
            ))}
          </div>
        </Show>

        {/* Rail */}
        <Show when={transitData().railStations.length > 0}>
          <div style={sectionStyle}>
            <div style="color:#ff5722;font-weight:600;margin-bottom:4px">{'\u{1F689}'} Rail System</div>
            <div style="font-size:12px;color:#aaa">Stations: {transitData().railStations.length} | Lines: {transitData().railLines.length} | Cost: ${transitData().railCost}/tick</div>
            <Show when={transitData().railStations.length >= 2}>
              <div style="display:flex;gap:4px">
                <button onClick={() => createRouteAll('rail')} style={btnStyle('#ff5722')}>+ All stations</button>
                <button onClick={() => startRouteBuilder('rail')} style={btnStyle('#ff5722')}>+ Custom</button>
              </div>
            </Show>
            <RouteBuilderPanel type="rail" color="#ff5722" />
            {transitData().railLines.map((l: any, i: number) => {
              const svcType = transitData().railSystem.getLineServiceType(l.id);
              return (
                <div style="font-size:11px;color:#ccc;margin-top:4px;display:flex;justify-content:space-between;align-items:center">
                  <span>Line {i + 1}: {l.stops.length} stations, {l.vehicles} train(s) <span style="color:#888">[{svcType ?? 'PASSENGER'}]</span></span>
                  <span style="display:flex;gap:2px">
                    <button onClick={() => removeVehicle('rail', l.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #888;background:transparent;color:#aaa;cursor:pointer">-</button>
                    <button onClick={() => addVehicle('rail', l.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #4caf50;background:transparent;color:#4caf50;cursor:pointer">+</button>
                    <button onClick={() => deleteRoute('rail', l.id)} style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #f44336;background:transparent;color:#f44336;cursor:pointer">X</button>
                  </span>
                </div>
              );
            })}
          </div>
        </Show>

        {/* Ferry */}
        <Show when={transitData().ferryDocks.length > 0}>
          <div style={sectionStyle}>
            <div style="color:#00bcd4;font-weight:600;margin-bottom:4px">{'\u{26F4}'} Ferry System</div>
            <div style="font-size:12px;color:#aaa">Docks: {transitData().ferryDocks.length} | Routes: {transitData().ferryRoutes.length} | Cost: ${transitData().ferryCost}/tick</div>
            <Show when={transitData().ferryDocks.length >= 2}>
              <div style="display:flex;gap:4px">
                <button onClick={() => createRouteAll('ferry')} style={btnStyle('#00bcd4')}>+ All docks</button>
                <button onClick={() => startRouteBuilder('ferry')} style={btnStyle('#00bcd4')}>+ Custom</button>
              </div>
            </Show>
            <RouteBuilderPanel type="ferry" color="#00bcd4" />
            {transitData().ferryRoutes.map((r: any, i: number) => (
              <div style="font-size:11px;color:#ccc;margin-top:4px;display:flex;justify-content:space-between;align-items:center">
                <span>Route {i + 1}: {r.stops.length} docks, {r.vehicles} vessel(s)</span>
                <span style="display:flex;gap:2px">
                  <button onClick={() => removeVehicle('ferry', r.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #888;background:transparent;color:#aaa;cursor:pointer">-</button>
                  <button onClick={() => addVehicle('ferry', r.id)} style="font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid #4caf50;background:transparent;color:#4caf50;cursor:pointer">+</button>
                  <button onClick={() => deleteRoute('ferry', r.id)} style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #f44336;background:transparent;color:#f44336;cursor:pointer">X</button>
                </span>
              </div>
            ))}
          </div>
        </Show>

        {/* Airport */}
        <Show when={transitData().airports.length > 0}>
          <div style={sectionStyle}>
            <div style="color:#90a4ae;font-weight:600;margin-bottom:4px">{'\u{2708}'} Airport System</div>
            {transitData().airports.map((a: any, i: number) => {
              const state = getGame().getState();
              const operational = state.airport.isAirportOperational(a.id);
              return (
                <div style={`font-size:12px;color:${operational ? '#aaa' : '#f44336'};margin-bottom:4px`}>
                  Airport {i + 1} ({a.size})
                  {operational
                    ? ` — Tourists: ${a.touristsPerTick}/tick | Cargo: ${a.cargoPerTick}/tick | Noise: ${a.noisePollution}`
                    : ' — No power/water (offline)'}
                </div>
              );
            })}
            <div style="font-size:12px;color:#aaa">Cost: ${transitData().airportCost}/tick</div>
          </div>
        </Show>
      </Show>
    </Modal>
  );
}
