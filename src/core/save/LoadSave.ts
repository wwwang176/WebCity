import {
  validateVersion, validateGrid, validateClock, validateBudget, validateTaxRates,
  validateCitizens, checkPrototypePollution,
} from './SaveValidator';
import { deserializeGameState, type DeserializedExtra } from './Serializer';
import type { GameState } from '../simulation/GameState';
import { classifySaveError, versionTooNewFailure, type SaveFailure } from './SaveFailure';

export type LoadResult =
  | { ok: true; state: GameState & { _extra?: DeserializedExtra } }
  | { ok: false; failure: SaveFailure };

/**
 * Read a save, or explain why it cannot be read.
 *
 * `deserializeGameState` opens with a bare `JSON.parse(json)` and then reaches
 * straight for `saved.grid.width`. Anything short of a complete save therefore
 * failed as "Cannot read properties of undefined (reading 'width')" from four
 * frames down — a message that told the player nothing and told us nothing
 * either, since main.ts caught it and started a new city over the top.
 *
 * The same validators the import path has always used run here too. They were
 * written for untrusted files, but a save read back from IndexedDB after a
 * crash, a quota abort or a version skew is no more trustworthy, and running
 * them is what turns a crash into a sentence.
 */
export function loadSaveData(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, failure: classifySaveError(err, 'load') };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, failure: corrupt('save data is not an object') };
  }
  if (checkPrototypePollution(parsed)) {
    return { ok: false, failure: corrupt('save data contains a dangerous key') };
  }

  const state = parsed as Record<string, unknown>;

  // A save from a LATER build is not damage, and saying so was a regression:
  // the old path ran it through the migrations (which no-op forwards) and
  // usually loaded it. Refusing is still right — this build cannot know what
  // the newer format means — but it has to be refused as its own thing, so the
  // player is told to update rather than told their save is broken.
  const version = validateVersion(state.version);
  if (!version.valid) {
    const detail = version.errors[0] ?? 'invalid save version';
    return {
      ok: false,
      failure: /newer than current/i.test(detail)
        ? versionTooNewFailure(detail)
        : corrupt(detail),
    };
  }

  for (const result of [
    validateGrid(state.grid),
    validateClock(state.clock),
    validateBudget(state.budget),
    validateTaxRates(state.taxRates),
    state.citizens === undefined ? null : validateCitizens(state.citizens),
  ]) {
    if (result && !result.valid) {
      return { ok: false, failure: corrupt(result.errors[0] ?? 'save data failed validation') };
    }
  }

  try {
    return { ok: true, state: deserializeGameState(json) };
  } catch (err) {
    // Validation passed and the deserializer still threw: that is a bug in this
    // build, or damage in a section no validator covers. It still must not take
    // the save with it, and it is still a LOAD failure — reporting it with the
    // save-side wording told the player "the city is NOT being saved" about a
    // city that was never loaded.
    return { ok: false, failure: classifySaveError(err, 'load') };
  }
}

function corrupt(detail: string): SaveFailure {
  const base = classifySaveError(new SyntaxError('corrupt'), 'load');
  return { ...base, detail };
}
