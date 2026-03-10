import { createSignal, createEffect, Show } from 'solid-js';
import { getGame } from '../store/gameStore';
import { Modal } from './Modal';

export function TransitModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const transitData = () => {
    version();
    const state = getGame().getState();
    return {
      busStops: state.bus.getStops(),
      busRoutes: state.bus.getRoutes(),
      busCost: state.bus.getOperatingCost(),
      metroStations: state.metro.getStations(),
      metroLines: state.metro.getLines(),
      metroCost: state.metro.getOperatingCost(),
      tramStops: state.tram.getStops(),
      tramRoutes: state.tram.getRoutes(),
      tramCost: state.tram.getOperatingCost(),
    };
  };

  const hasAny = () => {
    const d = transitData();
    return d.busStops.length > 0 || d.metroStations.length > 0 || d.tramStops.length > 0;
  };

  const createRoute = (type: string) => {
    const state = getGame().getState();
    if (type === 'bus') {
      const stops = [...state.bus.getStops()];
      if (stops.length >= 2) state.bus.createRoute(stops, 1);
    } else if (type === 'metro') {
      const stations = [...state.metro.getStations()];
      if (stations.length >= 2) state.metro.createLine(stations, 1);
    } else if (type === 'tram') {
      const stops = [...state.tram.getStops()];
      if (stops.length >= 2) state.tram.createRoute(stops, 1);
    }
    setVersion(v => v + 1);
  };

  return (
    <Modal id="transit-modal" title={'\u{1F68C} Transit Routes'} open={props.open} onClose={props.onClose} style={{ 'min-width': '400px', 'max-width': '480px' }}>
      <Show when={hasAny()} fallback={
        <div style="color:#888;text-align:center;padding:12px">No transit stops placed yet.<br />Place stops using the Transit tools, then create routes here.</div>
      }>
        <Show when={transitData().busStops.length > 0}>
          <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
            <div style="color:#ff9800;font-weight:600;margin-bottom:4px">{'\u{1F68F}'} Bus System</div>
            <div style="font-size:12px;color:#aaa">Stops: {transitData().busStops.length} | Routes: {transitData().busRoutes.length} | Cost: ${transitData().busCost}/tick</div>
            <Show when={transitData().busStops.length >= 2 && transitData().busRoutes.length === 0}>
              <button onClick={() => createRoute('bus')} style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #ff9800;background:#ff980022;color:#ff9800;cursor:pointer">+ Create Route (all stops)</button>
            </Show>
            {transitData().busRoutes.map((r: any, i: number) => (
              <div style="font-size:11px;color:#ccc;margin-top:4px">Route {i + 1}: {r.stops.length} stops, {r.vehicles} vehicle(s)</div>
            ))}
          </div>
        </Show>

        <Show when={transitData().metroStations.length > 0}>
          <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
            <div style="color:#00bcd4;font-weight:600;margin-bottom:4px">{'\u{1F687}'} Metro System</div>
            <div style="font-size:12px;color:#aaa">Stations: {transitData().metroStations.length} | Lines: {transitData().metroLines.length} | Cost: ${transitData().metroCost}/tick</div>
            <Show when={transitData().metroStations.length >= 2 && transitData().metroLines.length === 0}>
              <button onClick={() => createRoute('metro')} style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #00bcd4;background:#00bcd422;color:#00bcd4;cursor:pointer">+ Create Line (all stations)</button>
            </Show>
            {transitData().metroLines.map((l: any, i: number) => (
              <div style="font-size:11px;color:#ccc;margin-top:4px">Line {i + 1}: {l.stops.length} stations, {l.vehicles} train(s)</div>
            ))}
          </div>
        </Show>

        <Show when={transitData().tramStops.length > 0}>
          <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
            <div style="color:#8bc34a;font-weight:600;margin-bottom:4px">{'\u{1F68A}'} Tram System</div>
            <div style="font-size:12px;color:#aaa">Stops: {transitData().tramStops.length} | Routes: {transitData().tramRoutes.length} | Cost: ${transitData().tramCost}/tick</div>
            <Show when={transitData().tramStops.length >= 2 && transitData().tramRoutes.length === 0}>
              <button onClick={() => createRoute('tram')} style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid #8bc34a;background:#8bc34a22;color:#8bc34a;cursor:pointer">+ Create Route (all stops)</button>
            </Show>
            {transitData().tramRoutes.map((r: any, i: number) => (
              <div style="font-size:11px;color:#ccc;margin-top:4px">Route {i + 1}: {r.stops.length} stops, {r.vehicles} vehicle(s)</div>
            ))}
          </div>
        </Show>
      </Show>
    </Modal>
  );
}
