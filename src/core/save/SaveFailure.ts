/**
 * Turning a save/load failure into something the player can act on.
 *
 * Every one of these paths used to end in silence. The worker replaced the real
 * QuotaExceededError with a placeholder string, Game.ts never read the worker's
 * reply at all, and main.ts caught a failed load and started a brand new game
 * on top of it. A player whose disk was full kept playing a city that had
 * stopped being saved an hour ago, and a player whose save would not parse lost
 * it to the next autosave.
 *
 * Kept in core, with no DOM and no IndexedDB, so the classification and the
 * wording are testable; the UI layers only decide where to put the string.
 */

export type SaveFailureKind =
  /** The browser refused the write for lack of space. */
  | 'QUOTA'
  /** Another tab is holding an older version of the database open. */
  | 'BLOCKED'
  /** The save exists but its contents cannot be read as a save. */
  | 'CORRUPT'
  /** The slot the player asked for is not there. */
  | 'MISSING'
  /** Anything else — an I/O fault, a forced abort, private-browsing refusal. */
  | 'UNKNOWN';

export interface SaveFailure {
  kind: SaveFailureKind;
  /** One line, addressed to the player, saying what to do next. */
  message: string;
  /** The original error text, for the console. Never shown as the whole message. */
  detail: string;
}

/**
 * DOMException names are the only reliable signal here: IndexedDB error
 * messages are not standardised across browsers, but the names are.
 */
const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) return String((err as { name: unknown }).name);
  return '';
}

export function errorDetail(err: unknown): string {
  if (err === null || err === undefined) return 'unknown error';
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

const MESSAGES: Record<SaveFailureKind, string> = {
  QUOTA: 'Save failed: this browser is out of storage. Delete a save or free up disk space — the city is NOT being saved until you do.',
  BLOCKED: 'Save storage is locked by another tab of this game. Close the other tab and try again.',
  CORRUPT: 'That save could not be read — the file is damaged. It has been left untouched, so you can still export it.',
  MISSING: 'That save slot is empty.',
  UNKNOWN: 'Save failed and the city is NOT being saved. Try again, or export the city to a file.',
};

export function classifySaveError(err: unknown): SaveFailure {
  const detail = errorDetail(err);
  const name = errorName(err);

  let kind: SaveFailureKind = 'UNKNOWN';
  if (QUOTA_NAMES.has(name) || /quota/i.test(detail)) kind = 'QUOTA';
  else if (name === 'SaveBlockedError' || /blocked/i.test(detail)) kind = 'BLOCKED';
  else if (name === 'SyntaxError' || /JSON|unexpected token|corrupt/i.test(detail)) kind = 'CORRUPT';

  return { kind, message: MESSAGES[kind], detail };
}

/** The failure for a slot that loaded cleanly but held nothing. */
export function missingSaveFailure(slotId: number): SaveFailure {
  return { kind: 'MISSING', message: MESSAGES.MISSING, detail: `slot ${slotId} is empty` };
}

/**
 * What a load failure means for the game that is (not) running.
 *
 * `startFresh` is deliberately never true. main.ts used to fall through to
 * `startGame()` with no state, which begins a new city on the same slot — the
 * next autosave then overwrote the save the player had just failed to load.
 * Returning to the menu leaves the bytes on disk, which is what makes the
 * failure recoverable.
 */
export function loadFailureAction(failure: SaveFailure): {
  returnToMenu: boolean; startFresh: boolean; message: string;
} {
  return { returnToMenu: true, startFresh: false, message: failure.message };
}

/**
 * Thrown when IndexedDB signals `blocked` — another connection is holding an
 * older version of the database open, and the upgrade cannot proceed.
 *
 * Without this the open request simply never settles: no success, no error, and
 * every `await openDB()` in the app hangs forever behind a loading screen.
 */
export class SaveBlockedError extends Error {
  override readonly name = 'SaveBlockedError';
  constructor() {
    super('Save database is blocked by another tab');
  }
}
