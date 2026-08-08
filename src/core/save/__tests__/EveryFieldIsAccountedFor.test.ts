import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGameState } from '../../simulation/GameState';
import { snapshotGameState } from '../Serializer';

/**
 * A field added to GameState and forgotten in the serializer is silent: the
 * game runs, the save writes, and the state simply resets on load. BUG-053 was
 * one of those, and nothing would have caught the next.
 *
 * So every field must be one of two things, and say which:
 *
 *   - written by snapshotGameState, or
 *   - listed in TRANSIENT below, with a reason.
 *
 * Adding a field to GameState without doing either fails this file. That is the
 * point: the failure is the prompt to decide, not a chore to silence.
 */

/**
 * Fields deliberately NOT saved, each with why.
 *
 * "Rebuilt on load" is the common reason and is only valid if something
 * actually rebuilds it — the entries below name what.
 */
const TRANSIENT: Record<string, string> = {
  // Rebuilt from the grid: rebuildRailNetworkFromGrid / the road builders walk
  // every road cell after a load.
  roadNetwork: 'rebuilt from the grid on load',
  // Vehicles are re-spawned by SimulationLoop.warmup; a saved vehicle would be
  // stranded on an edge the rebuilt graph may not own.
  traffic: 're-spawned by warmup',
  // Derived from road flags every rebuild (updateTrafficLights).
  trafficLights: 'derived from road flags',
  // Pure functions over the grid; hold no state between ticks.
  buildingGrowth: 'stateless',
  buildingUpgrade: 'stateless',
  // Recomputed every MEDIUM_TICK_INTERVAL from sources on the grid.
  pollution: 'recomputed from grid sources',
  // Rebuilt by rebuildSidewalkGraph from the grid.
  sidewalkGraph: 'rebuilt from the grid',
  // Agents are transient by design — they walk one journey and despawn.
  pedestrianManager: 'agents are transient',
  // Derived: a flood fill over the road network, redone on every road change.
  shopping: 'derived from the road network',
  // Recomputed every slow-slot 0 by calculateRCIDemand from the city's own
  // counts. Resets to INITIAL_RCI_DEMAND for the first tick after a load,
  // which is a one-tick blip in a bar rather than lost state.
  rciDemand: 'recomputed every slow tick from the city',
  // Every field of it (commercialSupply, exportableFactorySet, lastDemand,
  // lastTrade) is rewritten by calculateSupply from the grid each slow tick.
  freight: 'rewritten by calculateSupply from the grid',
  // Coverage caches, rebuilt by recalculateCoverage after a load.
  power: 'coverage rebuilt on load',
  water: 'coverage rebuilt on load',
};

/** The GameState field list, read from the interface rather than a copy of it. */
function gameStateFields(): string[] {
  const src = readFileSync(
    join(process.cwd(), 'src', 'core', 'simulation', 'GameState.ts'), 'utf8',
  );
  const start = src.indexOf('export interface GameState {');
  expect(start, 'could not find the GameState interface').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('\n}', start));
  return [...body.matchAll(/^\s{2}(\w+)\s*:/gm)].map(m => m[1]!);
}

describe('every GameState field is either saved or declared transient', () => {
  const fields = gameStateFields();

  it('should have found the interface', () => {
    // Without this, a rename of the interface would make the whole file pass
    // over an empty list.
    expect(fields.length).toBeGreaterThan(20);
    expect(fields).toContain('grid');
    expect(fields).toContain('budget');
  });

  it('should account for each one', () => {
    const state = createGameState(8, 8);
    const snapshot = snapshotGameState(state) as unknown as Record<string, unknown>;
    const saved = new Set(Object.keys(snapshot));

    const unaccounted = fields.filter(f => !saved.has(f) && !(f in TRANSIENT));
    expect(
      unaccounted,
      'add these to the serializer, or to TRANSIENT above with the reason they '
      + 'do not need saving',
    ).toEqual([]);
  });

  it('should not carry a stale transient entry', () => {
    // The list decays in the other direction too: a field that gets removed, or
    // that starts being saved, leaves an entry here claiming something untrue.
    const state = createGameState(8, 8);
    const saved = new Set(Object.keys(
      snapshotGameState(state) as unknown as Record<string, unknown>,
    ));

    const stale = Object.keys(TRANSIENT)
      .filter(f => !fields.includes(f) || saved.has(f));
    expect(stale, 'these are listed as transient but are saved, or no longer exist')
      .toEqual([]);
  });

  it('should give every transient field a reason', () => {
    for (const [field, reason] of Object.entries(TRANSIENT)) {
      expect(reason.length, `${field} has no reason`).toBeGreaterThan(5);
    }
  });
});
