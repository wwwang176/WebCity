import { describe, it, expect } from 'vitest';
import { snapshotGameState, deserializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { citizenName } from '../../citizen/CitizenName';

/**
 * `citySeed` 是這座城市的身分，市民與建築的名字都拿它當鹽。
 *
 * 名字是從流水號算出來的、不逐一存檔，所以種子掉了就等於整座城市的人一起改名 ——
 * 而且是**只在讀檔之後**才發生，玩下去不會有任何異常，只有名字全變了。
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
    // 舊存檔沒有這個欄位。要有一個確定的值，不能是 undefined —— 那會讓
    // `Math.imul(undefined, k)` 變成 0 而看起來「剛好也能動」，直到有人改了寫法。
    const json = JSON.parse(JSON.stringify(snapshotGameState(createGameState(10, 10))));
    delete json.citySeed;
    expect(deserializeGameState(JSON.stringify(json)).citySeed).toBe(0);
  });
});
