import {
  validateVersion, validateGrid, validateClock, validateBudget, validateTaxRates,
  validateCitizens, checkPrototypePollution,
} from './SaveValidator';
import { deserializeGameState, type DeserializedExtra } from './Serializer';
import type { GameState } from '../simulation/GameState';
import { classifySaveError, type SaveFailure } from './SaveFailure';

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
    return { ok: false, failure: classifySaveError(err) };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, failure: corrupt('save data is not an object') };
  }
  if (checkPrototypePollution(parsed)) {
    return { ok: false, failure: corrupt('save data contains a dangerous key') };
  }

  const state = parsed as Record<string, unknown>;
  for (const result of [
    validateVersion(state.version),
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
    // build, not damage on disk. It still must not take the save with it.
    return { ok: false, failure: classifySaveError(err) };
  }
}

function corrupt(detail: string): SaveFailure {
  const base = classifySaveError(new SyntaxError('corrupt'));
  return { ...base, detail };
}
