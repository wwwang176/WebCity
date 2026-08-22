import { getDefaultMapConfig, type MapConfig } from '../core/config/MapConfig';

/**
 * 驗開新局的地圖設定。
 *
 * ## 為什麼一定要驗
 *
 * 地形產生器**不驗**。它直接拿 `config.waterAmount` 去查表，值不對就是
 * `Cannot read properties of undefined (reading 'riverHalfWidth')` —— 開局炸在
 * 一半，`startGameGuarded` 吞掉例外退回主選單，玩家看到載入畫面閃一下就沒了。
 *
 * UI 那一邊早就知道這件事（`NewGameConfig.pick()` 的註解寫著「一個
 * `waterAmount: undefined` 的設定會直接進到地形產生器而不是被拒絕」）並在自己那條路
 * 上擋掉了。agent 是**新開的第二條路**，那道防護沒有跟過來。
 *
 * ## 收部分設定，其餘補預設
 *
 * 逼呼叫端每次寫滿六個欄位，只會讓它們用猜的。而錯誤訊息要**列出可以用的東西** ——
 * 呼叫端是程式，它只能從訊息裡學會下一次該怎麼寫。
 */

const ALLOWED = {
  waterAmount: ['low', 'medium', 'high', 'very_high'],
  forestDensity: ['sparse', 'normal', 'dense'],
  startingFunds: ['easy', 'normal', 'hard'],
  disasterFrequency: ['low', 'medium', 'high'],
} as const;

/** `seed` 的範圍跟新遊戲設定畫面上那個輸入框一樣。 */
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
 * 檢查並補齊。給 `undefined` 就回 `undefined` —— 讓遊戲用它自己的預設，
 * 而不是在這裡另外編一份。
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
