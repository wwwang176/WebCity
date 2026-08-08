import { describe, it, expect } from 'vitest';
import {
  classifySaveError, missingSaveFailure, loadFailureAction,
  errorDetail, SaveBlockedError,
} from '../SaveFailure';

/**
 * The whole point of this module is that a failure reaches the player, so the
 * cases below are about the message as much as the classification.
 */
describe('a save failure is classified so the player can act', () => {
  it('should recognise a quota error by its DOMException name', () => {
    // Browsers word the message differently; only the name is dependable.
    const err = Object.assign(new Error('mumble'), { name: 'QuotaExceededError' });
    expect(classifySaveError(err).kind).toBe('QUOTA');
  });

  it('should recognise Firefox’s quota name too', () => {
    const err = Object.assign(new Error(''), { name: 'NS_ERROR_DOM_QUOTA_REACHED' });
    expect(classifySaveError(err).kind).toBe('QUOTA');
  });

  it('should recognise a blocked database', () => {
    expect(classifySaveError(new SaveBlockedError()).kind).toBe('BLOCKED');
  });

  it('should recognise unparseable save data', () => {
    // What JSON.parse throws on a truncated save.
    let thrown: unknown;
    try { JSON.parse('{"grid":'); } catch (e) { thrown = e; }
    expect(classifySaveError(thrown).kind).toBe('CORRUPT');
  });

  it('should fall back to UNKNOWN rather than guessing', () => {
    expect(classifySaveError(new Error('disk on fire')).kind).toBe('UNKNOWN');
  });

  it('should never produce an empty message', () => {
    for (const err of [null, undefined, '', new Error(''), {}, 42]) {
      const f = classifySaveError(err);
      expect(f.message.length, String(err)).toBeGreaterThan(10);
    }
  });

  it('should tell the player the city is no longer being saved', () => {
    // The failure mode that matters is the silent one: the player keeps
    // building for an hour on a city that stopped persisting.
    for (const kind of ['QUOTA', 'UNKNOWN'] as const) {
      const err = kind === 'QUOTA'
        ? Object.assign(new Error(''), { name: 'QuotaExceededError' })
        : new Error('something else');
      expect(classifySaveError(err).message).toMatch(/NOT being saved/);
    }
  });

  it('should keep the original error text out of the headline but available', () => {
    const f = classifySaveError(new Error('IDBTransaction aborted: 0x8052000e'));
    expect(f.detail).toContain('0x8052000e');
    expect(f.message).not.toContain('0x8052000e');
  });
});

describe('errorDetail survives whatever IndexedDB throws', () => {
  it.each([
    [new Error('boom'), 'boom'],
    ['plain string', 'plain string'],
    [{ message: 'object with message' }, 'object with message'],
    [null, 'unknown error'],
    [undefined, 'unknown error'],
  ])('%s', (input, expected) => {
    expect(errorDetail(input)).toBe(expected);
  });

  it('should use the name when an Error has no message', () => {
    const err = Object.assign(new Error(''), { name: 'AbortError' });
    expect(errorDetail(err)).toBe('AbortError');
  });
});

describe('a failed load must not become a new city', () => {
  it('should return to the menu and never start fresh', () => {
    // This is the defect the whole module exists for: main.ts caught a load
    // failure and called startGame() with no state. The player was dropped into
    // an empty map on the same slot, and the first autosave — 30 seconds later
    // — wrote that empty city over the save they had failed to load. The bytes
    // were still intact at the moment of failure; only the recovery destroyed
    // them.
    for (const kind of ['QUOTA', 'BLOCKED', 'CORRUPT', 'MISSING', 'UNKNOWN'] as const) {
      const failure = kind === 'MISSING'
        ? missingSaveFailure(3)
        : classifySaveError(new SaveBlockedError());
      const action = loadFailureAction(failure);
      expect(action.startFresh, kind).toBe(false);
      expect(action.returnToMenu, kind).toBe(true);
      expect(action.message.length).toBeGreaterThan(0);
    }
  });

  it('should say the damaged save was left alone', () => {
    const f = classifySaveError(new SyntaxError('Unexpected end of JSON input'));
    expect(f.kind).toBe('CORRUPT');
    expect(f.message).toMatch(/left untouched|export/i);
  });

  it('should name an empty slot as empty, not as a failure to read one', () => {
    const f = missingSaveFailure(2);
    expect(f.kind).toBe('MISSING');
    expect(f.detail).toContain('2');
  });
});
