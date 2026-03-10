import { createSignal, createEffect, onCleanup, Show, untrack } from 'solid-js';
import { getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { DebugTools } from '../../core/simulation/DebugTools';

export function DebugModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);
  const [fundsInput, setFundsInput] = createSignal('');
  const [taxInput, setTaxInput] = createSignal('');
  const [speedInput, setSpeedInput] = createSignal('');
  const [saveStatus, setSaveStatus] = createSignal('');
  const [editing, setEditing] = createSignal(false);

  const snap = () => {
    version();
    const state = getGame().getState();
    const tools = new DebugTools(state);
    return tools.getSnapshot();
  };

  createEffect(() => {
    if (props.open) {
      // Use untrack to avoid circular dependency: snap() reads version(),
      // and setVersion below writes version(), which would re-trigger this effect
      const s = untrack(snap);
      setFundsInput(String(Math.round(s.funds)));
      setTaxInput(String(s.taxRate));
      setSpeedInput(String(s.speed));
      setVersion(v => v + 1);
    }
  });

  // Auto-refresh every 2 seconds while open
  createEffect(() => {
    if (!props.open) return;
    const id = setInterval(() => {
      if (editing() || saveStatus()) return;
      setVersion(v => v + 1);
    }, 2000);
    onCleanup(() => clearInterval(id));
  });

  const setParam = (param: string, value: number) => {
    const state = getGame().getState();
    const tools = new DebugTools(state);
    tools.setParam(param as any, value);
    setVersion(v => v + 1);
  };

  const saveGame = async () => {
    setSaveStatus('Saving...');
    try {
      await getGame().saveCurrentGame(0, `Manual Save - Tick ${snap().tick}`);
      setSaveStatus('Saved successfully!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      setSaveStatus(`Save failed: ${e}`);
    }
  };

  return (
    <Modal id="debug-modal" title={'\u{1F527} Developer Debug Tools'} open={props.open} onClose={props.onClose} style={{ 'min-width': '420px', 'max-width': '520px' }}>
      <div style="font-size:11px;line-height:1.6">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:bold;color:#0af">SIMULATION STATE</span>
          <span style="color:#888">Tick: {snap().tick}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tbody>
            <tr><td style="color:#aaa">Population</td><td style="text-align:right;font-weight:bold">{snap().population}</td></tr>
            <tr><td style="color:#aaa">Vehicles</td><td style="text-align:right">{snap().vehicleCount}</td></tr>
            <tr><td style="color:#aaa">Buildings</td><td style="text-align:right">{snap().buildingCount}</td></tr>
            <tr><td style="color:#aaa">Infrastructure</td><td style="text-align:right">{snap().infraCount}</td></tr>
            <tr><td style="color:#aaa">Roads</td><td style="text-align:right">{snap().roadCount}</td></tr>
            <tr><td colspan="2" style="border-top:1px solid #333;padding-top:4px" /></tr>
            <tr><td style="color:#aaa">Funds</td><td style="text-align:right;color:#4f4">${snap().funds.toLocaleString()}</td></tr>
            <tr><td style="color:#aaa">Income</td><td style="text-align:right;color:#4f4">${snap().income.toLocaleString()}</td></tr>
            <tr><td style="color:#aaa">Expenses</td><td style="text-align:right;color:#f44">${snap().expenses.toLocaleString()}</td></tr>
            <tr><td colspan="2" style="border-top:1px solid #333;padding-top:4px" /></tr>
            <tr><td style="color:#aaa">RCI Demand</td><td style="text-align:right">R:{Math.round(snap().rciDemand.r)} C:{Math.round(snap().rciDemand.c)} I:{Math.round(snap().rciDemand.i)}</td></tr>
            <tr><td style="color:#aaa">Power Supply</td><td style="text-align:right">{snap().powerSupply} MW</td></tr>
            <tr><td style="color:#aaa">Water Supply</td><td style="text-align:right">{snap().waterSupply}</td></tr>
            <tr><td style="color:#aaa">Avg Happiness</td><td style="text-align:right">{snap().avgHappiness}</td></tr>
            <tr><td style="color:#aaa">Avg Land Value</td><td style="text-align:right">{snap().avgLandValue}</td></tr>
            <tr><td style="color:#aaa">Avg Pollution</td><td style="text-align:right">{snap().avgPollution}</td></tr>
          </tbody>
        </table>
        <div style="border-top:1px solid #333;margin-top:8px;padding-top:8px">
          <div style="font-weight:bold;color:#0af;margin-bottom:6px">MODIFY PARAMETERS</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Funds:</label>
            <input type="number" value={fundsInput()}
              onInput={(e) => { setFundsInput(e.currentTarget.value); setEditing(true); }}
              onBlur={() => setEditing(false)}
              style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px" />
            <button onClick={() => { const v = parseInt(fundsInput(), 10); if (!isNaN(v)) setParam('funds', v); }}
              style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Tax Rate:</label>
            <input type="number" value={taxInput()} min="0" max="30"
              onInput={(e) => { setTaxInput(e.currentTarget.value); setEditing(true); }}
              onBlur={() => setEditing(false)}
              style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px" />
            <button onClick={() => { const v = parseInt(taxInput(), 10); if (!isNaN(v)) setParam('taxRate', v); }}
              style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <label style="color:#aaa;width:70px">Speed:</label>
            <input type="number" value={speedInput()} min="1" max="3"
              onInput={(e) => { setSpeedInput(e.currentTarget.value); setEditing(true); }}
              onBlur={() => setEditing(false)}
              style="flex:1;background:#222;border:1px solid #555;color:#fff;padding:2px 4px;font-size:11px" />
            <button onClick={() => { const v = parseInt(speedInput(), 10); if (!isNaN(v)) setParam('speed', v); }}
              style="background:#0af;color:#000;border:none;padding:2px 8px;cursor:pointer;font-size:11px">Set</button>
          </div>
          <div style="border-top:1px solid #333;margin-top:8px;padding-top:8px">
            <button onClick={saveGame} style="background:#4caf50;color:#fff;border:none;padding:6px 16px;cursor:pointer;font-size:12px;border-radius:3px;width:100%">Save Game</button>
            <Show when={saveStatus()}>
              <div style="color:#888;font-size:11px;margin-top:4px;text-align:center">{saveStatus()}</div>
            </Show>
          </div>
        </div>
      </div>
    </Modal>
  );
}
