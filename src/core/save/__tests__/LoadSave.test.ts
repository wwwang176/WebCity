import { describe, it, expect } from 'vitest';
import { loadSaveData } from '../LoadSave';
import { snapshotGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

/**
 * Loading a save was the only path in the game that could destroy one. On any
 * throw main.ts started a new city on the same slot, and the next autosave
 * overwrote the save that had failed to open.
 *
 * Two things have to hold. A good save must still load — otherwise "never lose
 * a save" is trivially satisfiable by never loading any. And a bad one must
 * come back as a failure with a reason, from every shape of damage, rather
 * than as an exception from somewhere inside the deserializer.
 */
function goodSave(): string {
  const state = createGameState(12, 12);
  state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(3, 4, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  state.budget.funds = 12345;
  state.clock.tick = 720;
  return JSON.stringify(snapshotGameState(state));
}

/** A good save with one field replaced, so each case differs in exactly one way. */
function damaged(mutate: (o: Record<string, unknown>) => void): string {
  const o = JSON.parse(goodSave()) as Record<string, unknown>;
  mutate(o);
  return JSON.stringify(o);
}

describe('a valid save still loads', () => {
  it('should return the state it was given', () => {
    const result = loadSaveData(goodSave());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.budget.funds).toBe(12345);
    expect(result.state.clock.tick).toBe(720);
    expect(result.state.grid.getCell(3, 3)!.buildingId).toBe(1);
  });

  it('should survive a round trip through a real city', () => {
    // Guards the cases below: if the validators rejected everything, every
    // "returns a failure" assertion would pass for the wrong reason.
    const state = createGameState(20, 20);
    for (let x = 1; x < 19; x++) {
      state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
      state.grid.setCell(x, 6, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    }
    const result = loadSaveData(JSON.stringify(snapshotGameState(state)));
    expect(result.ok).toBe(true);
  });
});

describe('a damaged save comes back as a reason, never as a throw', () => {
  const cases: Array<[string, string]> = [
    ['truncated JSON', '{"version":7,"grid":'],
    ['empty string', ''],
    ['a JSON array', '[]'],
    ['a JSON number', '42'],
    ['null', 'null'],
    ['no grid', damaged(o => { delete o.grid; })],
    ['no clock', damaged(o => { delete o.clock; })],
    ['no budget', damaged(o => { delete o.budget; })],
    ['grid with no cells array', damaged(o => { (o.grid as Record<string, unknown>).cells = 'nope'; })],
    ['a negative grid width', damaged(o => { (o.grid as Record<string, unknown>).width = -1; })],
    ['a cell outside the grid', damaged(o => {
      (o.grid as { cells: unknown[] }).cells = [{ x: 999, y: 0, data: {} }];
    })],
    ['a non-finite fund balance', damaged(o => {
      (o.budget as Record<string, unknown>).funds = null;
    })],
    // Injected into the JSON text, not via an object literal: assigning
    // `o.__proto__` sets the prototype and JSON.stringify emits nothing, so the
    // obvious way to write this case produces a perfectly clean save. A real
    // attack is a literal "__proto__" key on the wire, which JSON.parse turns
    // into an ordinary own property.
    ['a prototype-pollution key', goodSave().replace('{', '{"__proto__":{"polluted":true},')],
  ];

  it.each(cases)('%s', (_label, json) => {
    // The assertion is deliberately about NOT throwing as much as about the
    // result: an exception here is what main.ts used to swallow.
    let result;
    expect(() => { result = loadSaveData(json); }).not.toThrow();
    expect(result!.ok).toBe(false);
    if (result!.ok) return;
    expect(result!.failure.message.length).toBeGreaterThan(10);
    expect(result!.failure.detail.length).toBeGreaterThan(0);
  });

  it('should tell the player the damaged save was left alone', () => {
    const result = loadSaveData('{"grid":');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('CORRUPT');
    expect(result.failure.message).toMatch(/left untouched|export/i);
  });

  it('should name the field that was wrong, in the detail', () => {
    // The console line has to be enough to diagnose from a bug report.
    const result = loadSaveData(damaged(o => { delete o.clock; }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail.toLowerCase()).toContain('clock');
  });
});

describe('a save from a newer build is refused as such, not as damage', () => {
  it('should be VERSION_TOO_NEW, and say to update', () => {
    // The first version reported this as CORRUPT — "the file is damaged" — and
    // that was also a regression: the old path ran the save through the
    // migrations (which no-op forwards) and usually loaded it.
    const result = loadSaveData(damaged(o => { o.version = 9999; }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('VERSION_TOO_NEW');
    expect(result.failure.message).toMatch(/update/i);
    expect(result.failure.message).not.toMatch(/damaged/i);
    expect(result.failure.detail).toContain('9999');
  });

  it('should still call a nonsense version damaged', () => {
    // The control: only "newer than current" is a version problem.
    for (const bad of [0, -1, 'seven', null]) {
      const result = loadSaveData(damaged(o => { o.version = bad; }));
      expect(result.ok, String(bad)).toBe(false);
      if (result.ok) continue;
      expect(result.failure.kind, String(bad)).toBe('CORRUPT');
    }
  });
});
