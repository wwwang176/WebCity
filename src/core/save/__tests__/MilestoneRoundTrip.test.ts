import { describe, it, expect } from 'vitest';
import { snapshotGameState, deserializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';

/**
 * `highestMilestonePop` is the high-water mark that stops already-earned
 * milestones re-firing after the population dips and recovers (BUG-094), and
 * BUG-123 made it survive a save. It had no round-trip test.
 *
 * Game.ts restores it with
 * `Math.max(loadedMilestone?.populationRequired ?? 0, extra?.highestMilestonePop ?? 0)`,
 * and Math.max returns NaN if either argument is NaN. NaN compares false
 * against everything, so a single non-finite value in a save disables every
 * milestone for the rest of that city's life — silently, and permanently,
 * because the poisoned value is written back out on the next save.
 */
function saveWith(highestMilestonePop: number | undefined): string {
  const state = createGameState(10, 10);
  return JSON.stringify(snapshotGameState(state, { highestMilestonePop }));
}

const restored = (json: string): number | undefined =>
  (deserializeGameState(json) as { _extra?: { highestMilestonePop?: number } })
    ._extra?.highestMilestonePop;

/** What Game.ts does with the restored value. */
const asGameWouldRestore = (loadedMilestonePop: number, saved: number | undefined): number =>
  Math.max(loadedMilestonePop, saved ?? 0);

describe('the milestone high-water mark survives a save', () => {
  it('should come back with the value it went in with', () => {
    expect(restored(saveWith(12500))).toBe(12500);
  });

  it('should come back as zero from a fresh city', () => {
    expect(restored(saveWith(0))).toBe(0);
  });

  it('should be absent, not garbage, in a save written before the field existed', () => {
    const state = createGameState(10, 10);
    const json = JSON.stringify(snapshotGameState(state));
    expect(restored(json)).toBeUndefined();
    // ...and the restore expression copes.
    expect(asGameWouldRestore(5000, restored(json))).toBe(5000);
  });

  it('should never let a non-finite value poison the restore', () => {
    // JSON.stringify turns NaN and Infinity into null, which is the format's
    // own protection — but the value can also arrive from a hand-edited or
    // imported file, and that is where Math.max would be poisoned.
    for (const bad of [NaN, Infinity, -Infinity]) {
      const json = saveWith(bad);
      const value = restored(json);
      expect(Number.isFinite(value ?? 0), `${bad} survived serialization`).toBe(true);
      expect(Number.isFinite(asGameWouldRestore(5000, value)), `${bad} poisoned the restore`)
        .toBe(true);
    }
  });

  it('should not be poisoned by a value a hand-edited file can carry', () => {
    // JSON cannot express NaN, but it can express a string, and an imported or
    // hand-edited save is not obliged to be sane. `Math.max(5000, "abc")` is
    // NaN, which compares false against everything — so every milestone in that
    // city is disabled for good, and the poisoned value is written straight
    // back out on the next save.
    for (const bad of ['abc', '{}', 'true', 'null', '[]']) {
      const json = JSON.stringify({
        ...JSON.parse(saveWith(1000)) as Record<string, unknown>,
        highestMilestonePop: JSON.parse(bad === 'abc' ? '"abc"' : bad),
      });
      expect(Number.isFinite(asGameWouldRestore(5000, restored(json))), `${bad} poisoned the restore`)
        .toBe(true);
    }
  });

  it('should keep the higher of the two sources', () => {
    // The whole point of Math.max there: a save written before the field
    // existed still carries the milestone the player had reached.
    expect(asGameWouldRestore(20000, restored(saveWith(5000)))).toBe(20000);
    expect(asGameWouldRestore(5000, restored(saveWith(20000)))).toBe(20000);
  });

  it('should survive being saved again', () => {
    // The failure mode that makes a bad value permanent: it is written back out.
    const first = restored(saveWith(30000));
    const state = createGameState(10, 10);
    const second = JSON.stringify(snapshotGameState(state, { highestMilestonePop: first }));
    expect(restored(second)).toBe(30000);
  });
});
