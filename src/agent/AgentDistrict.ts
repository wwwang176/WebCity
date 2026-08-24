import type { DistrictPaintMode } from '../core/district/DistrictPaint';
import { DISTRICT_SWATCHES } from '../core/district/DistrictPalette';

/**
 * Districts.
 *
 * ## Cells are not painted here
 *
 * A district's cells are **dragged out**: `act({ tool: 'district', x1, y1, x2, y2 })` uses the
 * same brush the player holds. This layer decides **which district** the brush points at and
 * **which mode** it uses (replace / add / subtract), plus creating, deleting, renaming and
 * recolouring districts themselves.
 *
 * ## Every id is validated first
 *
 * `DistrictManager`'s writes almost all return silently on an unknown id, except
 * `mergeDistricts`, which **throws**. Neither is acceptable: the first produces an `ok: true`
 * for an action that did nothing, and the second lands an exception in the caller's hands. So
 * every method checks before entering the game.
 *
 * ## Names must be unique
 *
 * Districts are identified by id, but people talk about them by name. Two Downtowns in the list
 * makes "turn off Downtown's congestion charge" unanswerable. The game does not enforce this —
 * auto-naming avoids collisions, manual naming does not — so this layer does.
 */

export interface DistrictRecord {
  id: string;
  name: string;
  cells: ReadonlySet<string>;
  colorIndex?: number | undefined;
}

export interface DistrictHost {
  all(): readonly DistrictRecord[];
  create(name?: string): string;
  remove(id: string): void;
  rename(id: string, name: string): void;
  setColor(id: string, colorIndex: number | undefined): void;
  merge(keepId: string, mergedId: string): string;
  activeId(): string | null;
  setActive(id: string | null): void;
  paintMode(): DistrictPaintMode;
  setPaintMode(mode: DistrictPaintMode): void;
}

export const PAINT_MODES: readonly DistrictPaintMode[] = ['replace', 'add', 'subtract'];

export interface DistrictInfo {
  id: string;
  name: string;
  cellCount: number;
  /** Swatch index, or `null` when never set, meaning the default palette colour. */
  colorIndex: number | null;
  /** The brush currently points at it. */
  active: boolean;
}

export interface BrushInfo {
  active: string | null;
  mode: DistrictPaintMode;
  modes: readonly DistrictPaintMode[];
}

export interface DistrictResult {
  ok: boolean;
  districtId?: string | null;
  name?: string;
  colorIndex?: number;
  mode?: DistrictPaintMode;
  reason?: string;
}

export class AgentDistrict {
  constructor(private readonly host: DistrictHost) {}

  // ── Reading ─────────────────────────────────────────────────────

  list(): DistrictInfo[] {
    const active = this.host.activeId();
    return this.host.all().map(d => ({
      id: d.id,
      name: d.name,
      cellCount: d.cells.size,
      colorIndex: d.colorIndex ?? null,
      active: d.id === active,
    }));
  }

  /** Which district the brush points at. */
  active(): string | null {
    return this.host.activeId();
  }

  /** The brush state: its target, its mode, and the available modes. */
  brush(): BrushInfo {
    return { active: this.host.activeId(), mode: this.host.paintMode(), modes: PAINT_MODES };
  }

  // ── Brush ───────────────────────────────────────────────────────

  /** Points the brush at a district. `null` releases it, so the next drag creates a new one. */
  setActive(districtId: string | null): DistrictResult {
    if (districtId !== null && !this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    this.host.setActive(districtId);
    return { ok: true, districtId };
  }

  setBrushMode(mode: string): DistrictResult {
    if (!(PAINT_MODES as readonly string[]).includes(mode)) {
      return { ok: false, reason: `brush mode must be one of ${PAINT_MODES.join(', ')}: ${mode}` };
    }
    this.host.setPaintMode(mode as DistrictPaintMode);
    return { ok: true, mode: mode as DistrictPaintMode };
  }

  // ── Create, edit, delete ────────────────────────────────────────

  /** Creates a district and points the brush at it. Without a name the game numbers it. */
  create(name?: string): DistrictResult {
    if (name !== undefined) {
      const bad = this.badName(name, null);
      if (bad) return { ok: false, name, reason: bad };
    }
    const id = this.host.create(name?.trim());
    const made = this.host.all().find(d => d.id === id);
    return { ok: true, districtId: id, name: made?.name ?? name ?? '' };
  }

  rename(districtId: string, name: string): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    const bad = this.badName(name, districtId);
    if (bad) return { ok: false, districtId, name, reason: bad };

    this.host.rename(districtId, name.trim());
    return { ok: true, districtId, name: name.trim() };
  }

  /** Changes the swatch. The index is a position in `DISTRICT_SWATCHES`. */
  setColor(districtId: string, colorIndex: number): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    // The core silently turns an out-of-range index into undefined, reverting to the default
    // colour, which looks like no response at all.
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= DISTRICT_SWATCHES.length) {
      return {
        ok: false, districtId,
        reason: `colour index must be 0..${DISTRICT_SWATCHES.length - 1}: ${colorIndex}`,
      };
    }
    this.host.setColor(districtId, colorIndex);
    return { ok: true, districtId, colorIndex };
  }

  /**
   * Deletes a district along with its policies. Its cells return to belonging to none.
   *
   * The brush is released if it pointed at that district: pointing at one that no longer exists
   * makes the next drag answer "Pick a district first" while the toolbar looks normal.
   */
  delete(districtId: string): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    const wasActive = this.host.activeId() === districtId;
    this.host.remove(districtId);
    if (wasActive) this.host.setActive(null);
    return { ok: true, districtId };
  }

  /** Merges `mergedId` into `keepId`. The cells move across and `mergedId` disappears. */
  merge(keepId: string, mergedId: string): DistrictResult {
    for (const id of [keepId, mergedId]) {
      if (!this.exists(id)) return { ok: false, districtId: id, reason: `no district with id ${id}` };
    }
    if (keepId === mergedId) {
      return { ok: false, districtId: keepId, reason: 'cannot merge a district into itself' };
    }
    const wasActive = this.host.activeId() === mergedId;
    const kept = this.host.merge(keepId, mergedId);
    if (wasActive) this.host.setActive(kept);
    return { ok: true, districtId: kept };
  }

  // ── Internal ────────────────────────────────────────────────────

  private exists(id: string): boolean {
    return this.host.all().some(d => d.id === id);
  }

  /** `exceptId` means "this name is already mine": a caller changing only the colour sends the
   *  existing name back. */
  private badName(name: string, exceptId: string | null): string | null {
    const trimmed = name.trim();
    if (trimmed === '') return 'district name cannot be blank';
    const clash = this.host.all().find(d => d.name === trimmed && d.id !== exceptId);
    return clash ? `district ${clash.id} is already called ${trimmed}` : null;
  }
}
