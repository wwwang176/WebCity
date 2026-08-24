import { listSaves, saveGame, type SaveSlot } from '../core/save/SaveManager';
import { exportSaveToFile, importSaveFromFile } from '../core/save/ImportExport';
import { getScreen, getSessionBridge, getStartFailure, setStartFailure } from './registry';
import { checkMapConfig } from './mapConfig';
import type { MapConfig } from '../core/config/MapConfig';

/**
 * The main menu layer: listing saves, saving, exporting, loading, and starting a new game.
 *
 * ## There is no delete here, deliberately
 *
 * `SaveManager` has `deleteSave()` and this layer **does not wrap it**. The game has no undo
 * and saves are the only checkpoint, so one wrong loop in a program erases them with nothing
 * the player can do. Deleting a save is done from the main menu by hand.
 *
 * ## "The await returned without throwing" is not "the game started"
 *
 * `main.ts`'s `startGameGuarded` **swallows** any exception during startup and returns to the
 * main menu; it never rejects the promise. So both of these methods re-check the screen state
 * after awaiting, or the player sees the loading screen flash back to the menu while the API
 * reports success.
 *
 * ## Loading and starting a new game replace the whole Game
 *
 * Both live in `main.ts`, which rebuilds the UI after `new Game`. `window.__game` and
 * `window.__agent` both point at the new instance, so **every reference held before the call is
 * stale**.
 */

export interface SaveInfo {
  slotId: number;
  name: string;
  /** Population at the time of saving. Older formats may not have it. */
  population?: number;
  /** Bytes. */
  size: number;
  savedAt?: number;
}

export interface SessionResult {
  ok: boolean;
  reason?: string;
}

export interface ImportResult extends SessionResult {
  /** Which slot it landed in. */
  slotId?: number;
  name?: string;
  /** Things worth knowing that did not stop the import, such as a version mismatch. */
  warnings?: string[];
}

function describe(slot: SaveSlot): SaveInfo {
  const s = slot as unknown as Record<string, unknown>;
  return {
    slotId: slot.id,
    name: slot.name,
    ...(typeof s.population === 'number' ? { population: s.population } : {}),
    size: typeof slot.data === 'string' ? slot.data.length : 0,
    ...(typeof s.timestamp === 'number' ? { savedAt: s.timestamp } : {}),
  };
}

/**
 * Whether the game actually started.
 *
 * `startGameGuarded` and `handleLoadGame` both **return to the main menu** on failure rather
 * than throwing, so the only evidence is which screen is showing. This reads the same state
 * `status()` does, with no separate bookkeeping.
 */
function started(reason: string): SessionResult {
  if (getScreen() === 'game') return { ok: true };
  // The real reason as the game recorded it; failing that, at least name the screen.
  const detail = getStartFailure();
  return {
    ok: false,
    reason: detail
      ? `${reason}: ${detail}`
      : `${reason} — the game is back on the ${getScreen()} screen`,
  };
}

export class AgentSession {
  constructor(private readonly serialize: () => string, private readonly population: () => number) {}

  /** Which saves exist. */
  async list(): Promise<SaveInfo[]> {
    return (await listSaves()).map(describe);
  }

  /**
   * Saves the current city into a slot.
   *
   * **Overwrites whatever is in that slot.** Defaults to slot 1 rather than 0: slot 0 is the
   * autosave, and overwriting it destroys the player's only checkpoint.
   */
  async save(slotId = 1, name = 'Agent Save'): Promise<SessionResult> {
    if (slotId === 0) {
      return { ok: false, reason: 'slot 0 is the autosave checkpoint; pick another slot' };
    }
    try {
      await saveGame(slotId, name, this.serialize(), this.population());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /** Exports one save slot as a file download. */
  async export(slotId: number): Promise<SessionResult> {
    const slots = await listSaves();
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return { ok: false, reason: `no save in slot ${slotId}` };
    exportSaveToFile(slot);
    return { ok: true };
  }

  /**
   * Loads one save slot.
   *
   * On success the current session is replaced entirely and anything unsaved is gone.
   */
  async load(slotId: number): Promise<SessionResult> {
    const bridge = getSessionBridge();
    if (!bridge) return { ok: false, reason: 'session bridge not registered (no UI?)' };
    const slots = await listSaves();
    if (!slots.some(s => s.id === slotId)) return { ok: false, reason: `no save in slot ${slotId}` };
    setStartFailure(null);
    await bridge.load(slotId);
    return started(`could not load slot ${slotId}`);
  }

  /**
   * Imports an exported save file.
   *
   * **Overwrites nothing**: it writes into the first empty slot. Slot 0 is always occupied by
   * the autosave, so an import never touches it.
   *
   * An import does not load the save; playing it takes a further `load(slotId)`.
   */
  async importSave(fileContent: string, name?: string): Promise<ImportResult> {
    // An empty string passed on would only blow up in JSON.parse, with a message unrelated to
    // the file being empty.
    if (typeof fileContent !== 'string' || fileContent.trim() === '') {
      return { ok: false, reason: 'the save file is empty' };
    }
    try {
      const r = await importSaveFromFile(fileContent, name ? { customName: name } : undefined);
      if (!r.success) {
        return { ok: false, reason: (r.errors ?? ['import failed']).join('; ') };
      }
      return {
        ok: true,
        ...(r.slotId !== undefined ? { slotId: r.slotId } : {}),
        ...(r.saveName !== undefined ? { name: r.saveName } : {}),
        ...(r.warnings?.length ? { warnings: r.warnings } : {}),
      };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /**
   * Starts a new game, discarding the current session entirely.
   *
   * `mapConfig` may give only some fields, with the rest defaulted; omitting it entirely uses
   * the game's own defaults. **Invalid settings are refused before anything happens**: the
   * terrain generator does not validate, and a bad value fails partway through startup and
   * returns to the main menu.
   */
  async newGame(mapConfig?: Partial<MapConfig>): Promise<SessionResult> {
    const bridge = getSessionBridge();
    if (!bridge) return { ok: false, reason: 'session bridge not registered (no UI?)' };

    const checked = checkMapConfig(mapConfig);
    if (!checked.ok) return { ok: false, reason: checked.reason };

    // The previous attempt's reason must not carry into this one.
    setStartFailure(null);
    await bridge.newGame(checked.config);
    return started('the game did not start');
  }
}
