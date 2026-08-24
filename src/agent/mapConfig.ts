import { getDefaultMapConfig, type MapConfig } from '../core/config/MapConfig';

/**
 * Validates the map config for a new game.
 *
 * ## Why validation is required
 *
 * The terrain generator **does not validate**. It looks `config.waterAmount` up in a table
 * directly, and a wrong value is `Cannot read properties of undefined (reading
 * 'riverHalfWidth')`: startup fails partway, `startGameGuarded` swallows the exception and
 * returns to the main menu, and the player sees the loading screen flash past.
 *
 * The UI already guards this on its own path (`NewGameConfig.pick()`). The agent is a **second
 * path**, and that guard did not come with it.
 *
 * ## Partial configs are accepted and defaulted
 *
 * Requiring all six fields every time would only make callers guess. And the error messages
 * **list the valid values**: the caller is a program, and the message is the only place it can
 * learn what to write next time.
 */

const ALLOWED = {
  waterAmount: ['low', 'medium', 'high', 'very_high'],
  forestDensity: ['sparse', 'normal', 'dense'],
  startingFunds: ['easy', 'normal', 'hard'],
  disasterFrequency: ['low', 'medium', 'high'],
} as const;

/** The `seed` range matches the input box on the new game screen. */
const SEED_MIN = 1;
const SEED_MAX = 2147483646;

const FIELDS = [
  'seed', 'waterAmount', 'forestDensity',
  'startingFunds', 'disastersEnabled', 'disasterFrequency',
] as const;

export type MapConfigCheck =
  | { ok: true; config: MapConfig }
  | { ok: false; reason: string };

/**
 * Validates and fills in defaults. `undefined` in returns `undefined` out, leaving the game to
 * use its own defaults rather than assembling a second copy of them here.
 */
export function checkMapConfig(input?: Partial<MapConfig>): MapConfigCheck | { ok: true; config: undefined } {
  if (input === undefined || input === null) return { ok: true, config: undefined };
  if (typeof input !== 'object') {
    return { ok: false, reason: `map config must be an object, got ${typeof input}` };
  }

  for (const key of Object.keys(input)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      return { ok: false, reason: `unknown map config field: ${key} (valid: ${FIELDS.join(', ')})` };
    }
  }

  for (const [key, values] of Object.entries(ALLOWED)) {
    const given = (input as Record<string, unknown>)[key];
    if (given === undefined) continue;
    if (!(values as readonly string[]).includes(given as string)) {
      return { ok: false, reason: `${key} must be one of ${values.join(', ')}: ${String(given)}` };
    }
  }

  if (input.seed !== undefined) {
    const seed = input.seed;
    if (!Number.isInteger(seed) || seed < SEED_MIN || seed > SEED_MAX) {
      return { ok: false, reason: `seed must be a whole number from ${SEED_MIN} to ${SEED_MAX}: ${String(seed)}` };
    }
  }

  if (input.disastersEnabled !== undefined && typeof input.disastersEnabled !== 'boolean') {
    return { ok: false, reason: `disastersEnabled must be true or false: ${String(input.disastersEnabled)}` };
  }

  return { ok: true, config: { ...getDefaultMapConfig(), ...input } };
}
