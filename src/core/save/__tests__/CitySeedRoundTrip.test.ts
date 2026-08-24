import { describe, it, expect } from 'vitest';
import { snapshotGameState, deserializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { citizenName } from '../../citizen/CitizenName';

/**
 * `citySeed` is this city's identity: citizen and building names all use it as salt.
 *
 * Names are derived from sequence numbers rather than stored one by one, so losing the seed
 * renames everyone in the city at once — and **only after a load**, with nothing else out of
 * order as play continues.
 */
function roundTrip(seed: number) {
  const state = createGameState(10, 10);
  state.citySeed = seed;
  return deserializeGameState(JSON.stringify(snapshotGameState(state)));
}

describe('城市種子存得下來', () => {
  it('should come back with the same seed', () => {
    expect(roundTrip(4242).citySeed).toBe(4242);
  });

  it('should keep everyone`s name across a save', () => {
    const before = [1, 2, 3].map(id => citizenName(id, 4242));
    const after = [1, 2, 3].map(id => citizenName(id, roundTrip(4242).citySeed));
    expect(after).toEqual(before);
  });

  it('should read a save that predates the field as seed 0', () => {
    // Old saves lack the field. It needs a definite value rather than undefined, which turns
    // `Math.imul(undefined, k)` into 0 and looks like it happens to work until someone
    // rewrites it.
    const json = JSON.parse(JSON.stringify(snapshotGameState(createGameState(10, 10))));
    delete json.citySeed;
    expect(deserializeGameState(JSON.stringify(json)).citySeed).toBe(0);
  });
});
