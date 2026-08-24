import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { PolicyRow } from './PolicyRow';
import { isPolicyImplemented } from '../../core/district/PolicyManager';
import { computeCityScales } from '../../core/district/PolicyBilling';
import { countRoadCellsInDistrict } from '../../core/district/DistrictManager';
import {
  policiesByCategory, districtPolicyTotal, RETIRED_CATEGORY,
} from '../../core/district/PolicyPresentation';
import type { PolicyType } from '../../core/district/types';
import { sanitiseDistrictName, DISTRICT_NAME_MAX } from '../../core/district/DistrictNaming';
import { DISTRICT_SWATCHES, swatchCssFor } from '../../core/district/DistrictPalette';

/**
 * The policy panel.
 *
 * City-wide and district policies share one panel, scope on the left and content on the right: the two
 * answer the same question at two levels — whether the city wants this, whether this district wants
 * this — and split across two panels the player has to remember which policy lives where. The rows
 * look the same for the same reason: comparing them is the point.
 *
 * A district's list is what is offered now, unioned with what the district already carries. Without
 * the second part, a retired policy in an old save disappears from the view and the player can never
 * switch it off; they are collected in the Retired group at the end.
 */

type Pane = { kind: 'city' } | { kind: 'district'; id: string };

export function PolicyModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const [version, setVersion] = createSignal(0);
  const [pane, setPane] = createSignal<Pane>({ kind: 'city' });

  const districts = () => {
    version();
    gameSignals.tick();   // painting districts with the panel open moves the cell counts and fees
    return getGame().getState().districts.getAllDistricts();
  };

  createEffect(() => {
    if (!props.open) return;
    // **Subscribes** to the signal rather than reading the plain `game.activeDistrictId` field. While
    // the panel is open the selection can be cleared from outside — closing the overlay, switching
    // overlays by keyboard, deleting the district — and reading the plain field never reruns this
    // effect, leaving the sidebar on a district that is no longer active.
    const active = gameSignals.activeDistrictId();
    setVersion(v => v + 1);
    const game = getGame();
    // Stays on the district already being painted: a player who has just painted and opened the panel
    // wants that district.
    const districts = game.getState().districts.getAllDistricts();
    const target = districts.find(d => d.id === active);
    setPane(target ? { kind: 'district', id: target.id } : { kind: 'city' });
  });

  /**
   * The brush paints whichever district the sidebar selects.
   *
   * Without this, a player who clicks Docklands in the panel, closes it and keeps painting still puts
   * cells into Riverside, with nothing on screen explaining why.
   */
  const selectDistrict = (id: string) => {
    setPane({ kind: 'district', id });
    getGame().setActiveDistrict(id);
  };

  const population = () => { version(); return getGame().getState().citizens.getPopulation(); };

  /** The selected district. Returns undefined once the district is deleted, and the view falls back to city-wide. */
  const selectedDistrict = () => {
    const p = pane();
    if (p.kind !== 'district') return undefined;
    return districts().find(d => d.id === p.id);
  };

  const isCity = () => pane().kind === 'city' || !selectedDistrict();

  /**
   * The billing scale. Childcare support and free clinics are charged per actual beneficiary, so this
   * walks the citizen list — only while the panel is open, and not once it closes.
   */
  const scale = () => {
    version();
    const state = getGame().getState();
    return {
      ...computeCityScales(state.citizens.getCitizens(),
        (x: number, y: number) => state.health.getCoverage(x, y)),
      chargedDrivers: getGame().getCommuteStats()
        .chargedDriversByDistrict.get(selectedDistrict()?.id ?? '') ?? 0,
      districtCells: selectedDistrict()?.cells.size ?? 0,
      districtRoadCells: (() => {
        const d = selectedDistrict();
        return d ? countRoadCellsInDistrict(state.grid, d) : 0;
      })(),
    };
  };

  const groups = () => {
    version();
    const d = selectedDistrict();
    if (isCity() || !d) return policiesByCategory('city');
    return policiesByCategory('district', (d.policies as { type: PolicyType }[]).map(p => p.type));
  };

  const levelOf = (pt: PolicyType) => {
    version();
    gameSignals.tick();
    const d = selectedDistrict();
    const state = getGame().getState();
    return isCity() || !d
      ? state.ordinances.getLevel(pt)
      : state.policies.getPolicyLevel(d.id, pt);
  };

  const total = () => {
    version();
    gameSignals.tick();
    const d = selectedDistrict();
    const state = getGame().getState();
    if (isCity() || !d) return Math.round(state.ordinances.totalCost(scale()));
    return Math.round(districtPolicyTotal(
      d.policies as { type: PolicyType; level: number }[], scale()));
  };

  const setLevel = (pt: PolicyType, level: number) => {
    const game = getGame();
    const state = game.getState();
    const d = selectedDistrict();
    if (isCity() || !d) {
      state.ordinances.setLevel(pt, level);
    } else {
      state.policies.setPolicyLevel(d.id, pt, level);
      // Restrictive policies decide whether a district's empty land can grow buildings, and the
      // overlay is drawn from that. Nothing else here sees the change, and the game is usually paused
      // while the player sits in this panel.
      game.notifyDistrictPolicyChanged();
    }
    setVersion(v => v + 1);
  };

  const removePolicy = (pt: PolicyType) => {
    const d = selectedDistrict();
    if (!d) return;
    // A retired policy can only be removed. Going through the ordinary level setter writes a level 0
    // record back, which is how an old save keeps a policy the player can see and never switch off.
    getGame().getState().policies.removePolicy(d.id, pt);
    getGame().notifyDistrictPolicyChanged();
    setVersion(v => v + 1);
  };

  const rename = (raw: string) => {
    const d = selectedDistrict();
    if (!d) return;
    getGame().getState().districts.renameDistrict(d.id, sanitiseDistrictName(raw, d.name));
    // The overlay's labels are drawn from the name, and without a redraw the map keeps the old one.
    getGame().refreshOverlay();
    setVersion(v => v + 1);
  };

  const recolour = (index: number) => {
    const d = selectedDistrict();
    if (!d) return;
    getGame().getState().districts.setDistrictColor(d.id, index);
    // The overlay is drawn in the district's colour, and a new colour shows only after a redraw.
    getGame().refreshOverlay();
    setVersion(v => v + 1);
  };

  /**
   * Deletes a whole district.
   *
   * Erasing its last cell does not remove it — its policy settings should not vanish over one erase —
   * so there has to be an explicit path, or the sidebar slowly fills with names nothing can reach.
   */
  const removeDistrict = () => {
    const d = selectedDistrict();
    if (!d) return;
    const game = getGame();
    game.getState().districts.deleteDistrict(d.id);
    // The deleted district may be the one the brush holds; without releasing it the toolbar sits on a
    // name that no longer exists.
    if (game.activeDistrictId === d.id) game.setActiveDistrict(null);
    game.notifyDistrictPolicyChanged();
    game.refreshOverlay();
    setPane({ kind: 'city' });
    setVersion(v => v + 1);
  };

  const paneTitle = () => isCity() ? 'City Ordinances' : (selectedDistrict()?.name ?? '');
  const paneSubtitle = () => isCity()
    ? 'Billed per resident — the bill grows with the city.'
    : `${selectedDistrict()?.cells.size ?? 0} cells · billed per cell — paint it bigger and the bill grows.`;

  return (
    <Modal
      id="policy-modal"
      title={'\u{1F4CB} Policies'}
      open={props.open}
      onClose={props.onClose}
      style={{ 'min-width': '640px', 'max-width': '760px' }}
    >
      <div class="overview-layout">
        <nav class="overview-sidebar">
          {/* Switching to city-wide releases the selection too. Changing only the local pane leaves the
              sidebar saying City while the map's outline and the brush are still on that district. */}
          <button
            class="overview-nav-item"
            classList={{ active: isCity() }}
            onClick={() => { setPane({ kind: 'city' }); getGame().setActiveDistrict(null); }}
          >
            <span class="nav-icon">{'\u{1F3D9}'}</span>
            <span>City</span>
          </button>
          <For each={districts()}>
            {(d) => {
              // The name and colour are read through memos that track version(). <For> reuses the
              // same District object, so this body does not rerun: written as {d.name} directly, the
              // sidebar keeps the old name after a rename until the panel is closed and reopened.
              const name = () => { version(); gameSignals.tick(); return d.name; };
              const swatch = () => { version(); return swatchCssFor(d.colorIndex); };
              // The cell count is the only thing in the row that says whether the district is still on
              // the map. A district with 0 cells has nothing to click on the map, and the sidebar is
              // the only place that reaches it.
              const cells = () => { version(); gameSignals.tick(); return d.cells.size; };
              return (
                <button
                  class="overview-nav-item"
                  classList={{ active: !isCity() && selectedDistrict()?.id === d.id }}
                  onClick={() => selectDistrict(d.id)}
                >
                  <span
                    class="nav-icon"
                    style={{
                      width: '10px', height: '10px', 'border-radius': '3px',
                      background: swatch() ?? '#667', display: 'inline-block',
                    }}
                  />
                  <span>{name()}</span>
                  <span style={{
                    'margin-left': 'auto', 'font-size': '10px',
                    color: cells() === 0 ? '#a1655f' : '#667',
                  }}>
                    {cells() === 0 ? 'empty' : cells()}
                  </span>
                </button>
              );
            }}
          </For>
          <Show when={districts().length === 0}>
            <div style="padding:8px 14px;font-size:11px;color:#667;line-height:1.5">
              No districts yet. Use the District Paint tool to create one.
            </div>
          </Show>
        </nav>

        <div class="overview-content">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:2px">
            <Show
              when={!isCity()}
              fallback={<strong style="color:#e0e0e0;font-size:14px">{paneTitle()}</strong>}
            >
              {/* The name is editable directly rather than behind an edit button: a district's name is
                  the player's only cue on the map for which district this is, and renaming should not
                  be a hidden feature. */}
              <input
                value={paneTitle()}
                maxLength={DISTRICT_NAME_MAX}
                aria-label="District name"
                onInput={(e) => rename(e.currentTarget.value)}
                onBlur={(e) => { e.currentTarget.value = paneTitle(); }}
                style="background:transparent;border:none;border-bottom:1px dashed #445;color:#e0e0e0;font-size:14px;font-weight:600;padding:2px 0;outline:none;min-width:0;flex:1"
              />
            </Show>
            <span style="font-size:12px;color:#ce93d8;white-space:nowrap">This cycle: ${total()}</span>
            {/* Delete sits in the header rather than at the end of the list: a district with no cells
                left cannot be clicked on the map, the sidebar is the only place that reaches it, and
                deleting it is then the only thing anyone wants to do — scrolling past sixteen policies
                for that is not defensible. Nothing next to it is clicked repeatedly, so it is not hit
                by accident. */}
            <Show when={!isCity()}>
              <button
                onClick={removeDistrict}
                title="Delete this district and the policies set on it. Erasing its cells alone keeps them."
                style="background:transparent;border:1px solid #5d3a3a;color:#e57373;border-radius:4px;font-size:11px;padding:2px 8px;cursor:pointer;white-space:nowrap"
              >
                Delete
              </button>
            </Show>
          </div>
          <div style="font-size:11px;color:#777;margin-bottom:10px">{paneSubtitle()}</div>

          <Show when={!isCity()}>
            {/* The swatch. This is the colour on the overlay: the swatch's hue and the overlay's are the
                same number, pinned by a test. */}
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
              <span style="font-size:11px;color:#777">Colour</span>
              <For each={DISTRICT_SWATCHES}>
                {(sw, i) => (
                  <button
                    onClick={() => recolour(i())}
                    aria-label={`Colour ${i() + 1}`}
                    aria-pressed={selectedDistrict()?.colorIndex === i()}
                    style={{
                      width: '18px', height: '18px', 'border-radius': '4px',
                      cursor: 'pointer', background: sw.css,
                      border: selectedDistrict()?.colorIndex === i()
                        ? '2px solid #fff' : '1px solid #0006',
                    }}
                  />
                )}
              </For>
            </div>
          </Show>

          <For each={groups()}>
            {(group) => (
              <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
                  {group.category}
                </div>
                <For each={group.policies}>
                  {(pt) => (
                    <PolicyRow
                      type={pt}
                      level={levelOf(pt)}
                      scale={scale()}
                      retired={group.category === RETIRED_CATEGORY || !isPolicyImplemented(pt)}
                      onSetLevel={(lv) => setLevel(pt, lv)}
                      onRemove={() => removePolicy(pt)}
                    />
                  )}
                </For>
              </div>
            )}
          </For>

        </div>
      </div>
    </Modal>
  );
}
