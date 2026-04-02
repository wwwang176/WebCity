import { Show, Index, createMemo } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
export function TransferOverlayPanel(props: { panelOrder?: number }) {
  const visible = () => gameSignals.selectedTransferRoute() !== null;
  const selected = () => gameSignals.selectedTransferRoute();

  const stats = createMemo(() => {
    gameSignals.tick();
    if (!visible()) return null;
    return getGame().getTransferStats();
  });

  const routes = () => stats()?.routeBreakdown.filter(r => r.rides >= 2 && r.weeklyUse > 0) ?? [];

  const select = (label: string) => {
    getGame().selectTransferRoute(label);
  };

  const close = () => {
    getGame().selectTransferRoute(null);
  };

  return (
    <Show when={visible()}>
      <div id="transfer-overlay-panel" class="visible" style={{
        order: props.panelOrder ?? 0,
        'min-width': '220px',
        'max-width': '280px',
        background: 'rgba(14, 22, 38, 0.92)',
        'border-radius': '8px',
        padding: '10px 12px',
        color: '#b0c4de',
        'font-size': '12px',
        'backdrop-filter': 'blur(8px)',
        border: '1px solid rgba(66,165,245,0.2)',
      }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '8px' }}>
          <span style={{ 'font-size': '13px', 'font-weight': '600', color: '#e0e8f0' }}>
            Transfer Routes
          </span>
          <button
            style={{
              background: 'none', border: 'none', color: '#667a90', cursor: 'pointer',
              'font-size': '16px', padding: '0 2px', 'line-height': '1',
            }}
            onClick={close}
          >&times;</button>
        </div>

        <div style={{ 'font-size': '10px', color: '#667a90', 'margin-bottom': '6px', 'text-transform': 'uppercase' }}>
          Click a route to highlight on map
        </div>

        <Index each={routes()}>
          {(row) => {
            const isSelected = () => selected() === row().label;
            return (
              <div
                style={{
                  padding: '5px 8px',
                  'margin-bottom': '2px',
                  'border-radius': '4px',
                  cursor: 'pointer',
                  background: isSelected() ? 'rgba(66,165,245,0.2)' : 'transparent',
                  display: 'flex',
                  'justify-content': 'space-between',
                  'align-items': 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                onClick={() => select(row().label)}
              >
                <span>{row().label}</span>
                <span style={{ color: row().weeklyUse > 0 ? '#66bb6a' : '#667a90', 'font-size': '11px' }}>
                  {row().weeklyUse}/wk
                </span>
              </div>
            );
          }}
        </Index>

      </div>
    </Show>
  );
}
