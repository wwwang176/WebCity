import { For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { UI_COLORS } from '../constants';

export function TrafficModal(props: { open: boolean; onClose: () => void }) {
  const stats = () => {
    gameSignals.tick(); // reactive: throttled live-refresh
    return getGame().getTrafficStats();
  };

  return (
    <Modal id="traffic-modal" title={'\u{1F697} Traffic Overview'} open={props.open} onClose={props.onClose}>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="sc-value">{stats().commuteVehicleCount}</div>
          <div class="sc-label">Commuters Driving</div>
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
      <Show when={stats().topCongested.length > 0} fallback={<div style="font-size:12px;color:#667a90;padding:8px 0">No traffic data yet</div>}>
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
    </Modal>
  );
}
