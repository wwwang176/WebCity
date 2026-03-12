import { createSignal, For, createEffect } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';

const SPECS = [
  { type: 'NONE', label: 'None', desc: 'No specialization', icon: '\u2796' },
  { type: 'MINING_CITY', label: 'Mining City', desc: 'Revenue +15%, Happiness -5, Crime +5', icon: '\u26CF' },
  { type: 'OIL_CITY', label: 'Oil City', desc: 'Revenue +20%, Happiness -5, Crime +3', icon: '\u{1F6E2}' },
  { type: 'TECH_CITY', label: 'Tech City', desc: 'Revenue +25%, Happiness +5, Crime -5', icon: '\u{1F4BB}' },
  { type: 'TOURISM_CITY', label: 'Tourism City', desc: 'Revenue +20%, Happiness +3, Crime +5', icon: '\u{1F3D6}' },
  { type: 'GAMBLING_CITY', label: 'Gambling City', desc: 'Revenue +40%, Happiness -10, Crime +15', icon: '\u{1F3B0}' },
  { type: 'TRADE_CITY', label: 'Trade City', desc: 'Revenue +15%, Happiness +2', icon: '\u{1F4E6}' },
];

export function CitySpecModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);

  const data = () => {
    version();
    gameSignals.tick(); // reactive: throttled live-refresh
    const state = getGame().getState();
    return {
      pop: state.citizens.getPopulation(),
      currentSpec: state.citySpec.getCurrent(),
    };
  };

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const choose = (specType: string) => {
    const state = getGame().getState();
    const pop = state.citizens.getPopulation();
    const success = state.citySpec.choose(specType as any, pop);
    if (success) setVersion(v => v + 1);
  };

  return (
    <Modal id="cityspec-modal" title={'\u2B50 City Specialization'} open={props.open} onClose={props.onClose} style={{ 'min-width': '380px', 'max-width': '440px' }}>
      <div style="margin-bottom:8px;font-size:12px;color:#aaa">
        Population: <strong style="color:#e0e0e0">{data().pop}</strong> (5,000 needed to specialize)
      </div>
      <For each={SPECS}>
        {(s) => {
          const isCurrent = () => s.type === data().currentSpec;
          const canChoose = () => s.type === 'NONE' || data().pop >= 5000;
          return (
            <button
              onClick={() => canChoose() && choose(s.type)}
              style={{
                display: 'flex', 'align-items': 'center', gap: '8px', width: '100%',
                padding: '8px 10px', 'margin-bottom': '4px', 'border-radius': '6px',
                border: `1px solid ${isCurrent() ? '#ffc107' : '#333'}`,
                background: isCurrent() ? '#ffc10722' : '#1a2233',
                color: canChoose() ? '#e0e0e0' : '#555',
                cursor: canChoose() ? 'pointer' : 'not-allowed',
                'font-size': '12px', 'text-align': 'left',
              }}
            >
              <span style="font-size:18px">{s.icon}</span>
              <div>
                <div style="font-weight:600">{isCurrent() ? '\u2605 ' : ''}{s.label}</div>
                <div style={{ 'font-size': '11px', color: canChoose() ? '#888' : '#444' }}>{s.desc}</div>
              </div>
            </button>
          );
        }}
      </For>
    </Modal>
  );
}
