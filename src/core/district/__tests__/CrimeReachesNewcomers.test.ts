import { describe, it, expect, vi } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import {
  calculateAttractiveness, getImmigrationCap, type CityAttractiveness,
} from '../../citizen/Migration';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 條例的犯罪效果要走到「外地人要不要搬進來」這條線。
 *
 * 量的不是搬進來幾個人 —— 那一步是擲骰子的，在測試規模下訊號會被隨機性蓋過。
 * 量的是骰子的偏向:模擬迴圈餵給 `migrationTick` 的那個犯罪數字、它算出來的吸引力，
 * 以及吸引力換算出來的這一輪移民上限。這三個都是純函式，完全確定。
 */

/** 攔下 `migrationTick` 的第二個參數 —— 模擬迴圈眼中的這座城市。 */
const seen: CityAttractiveness[] = [];
vi.mock('../../citizen/Migration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../citizen/Migration')>();
  return {
    ...actual,
    migrationTick: (manager: never, city: CityAttractiveness, ...rest: never[]) => {
      seen.push({ ...city });
      return (actual.migrationTick as (...a: unknown[]) => unknown)(manager, city, ...rest);
    },
  };
});

/** Small House / Small Shop。 */
const HOUSE = 1;
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // A/B 的兩座城市要從同一個亂數狀態出發。不重設的話第二次接續第一次留下的
  // 序列，兩座城市會自己走岔，量到的是那個岔而不是條例。
  reseedRandom();
  const state = createGameState(30, 30);
  for (let x = 5; x < 25; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 24; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    // 一戶只住一個人 —— 留著空房，移民上限才不會被「沒地方住」卡住。
    state.citizens.restoreCitizen({ homeId: toPosKey(x, 11), workplaceId: toPosKey(x, 9) }, 0);
  }
  state.power.addPlant({ x: 12, y: 8, output: 100000, pollution: 0, type: 'wind' });
  state.water.addPlant({ x: 13, y: 8, output: 100000 });
  return { state, loop: new SimulationLoop(state) };
}

/** 跑到移民那一輪，回傳模擬迴圈當時看到的城市。 */
function cityAsSeenByNewcomers(crime: number): CityAttractiveness {
  seen.length = 0;
  const { state, loop } = city();
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  if (crime !== 0) {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
    state.ordinances.setLevel(type, 1);
  }
  try {
    for (let i = 0; i < 12; i++) loop.tick();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
  const last = seen[seen.length - 1];
  if (!last) throw new Error('migrationTick 一次都沒有被呼叫，這條測試等於空轉');
  return last;
}

// 整個檔案都上種子:每一條測試都在比較兩座城市，而 tick 裡的建築成長、解僱、
// 車輛抖動都在擲骰子。建城時另外重設序列，讓 A/B 從同一點出發。
useSeededRandom();

describe('條例的犯罪效果走到外地人眼前', () => {
  it('should show newcomers the crime rate the ordinances actually produce', () => {
    // 不比兩次執行的差:基礎犯罪是人口 × 0.02，而犯罪本來就會影響人口，兩次跑的
    // 基礎值不會一樣。改成各自釘一個區間 —— 條例那一項固定是 40，基礎值在這座
    // 二十來人、沒有警察局的城市裡怎麼漂都不到 3。
    const plain = cityAsSeenByNewcomers(0);
    const scary = cityAsSeenByNewcomers(40);
    expect(plain.crimeRate, '沒開條例，基礎犯罪卻不小 —— 這條測試的區間站不住').toBeLessThan(3);
    expect(scary.crimeRate, '外地人看到的犯罪率沒有反映條例').toBeGreaterThanOrEqual(40);
    expect(scary.crimeRate, '外地人看到的犯罪率被多加了東西').toBeLessThan(43);
  });

  it('should make the city less attractive, not just less happy', () => {
    // 幸福度那條線已經另外接了。這裡要的是犯罪自己那一項 —— 所以比的是同一個
    // 城市物件在改掉犯罪率前後的吸引力，其餘欄位完全一樣。
    const seenCity = cityAsSeenByNewcomers(0);
    const withCrime: CityAttractiveness = { ...seenCity, crimeRate: seenCity.crimeRate + 40 };
    expect(calculateAttractiveness(withCrime), '犯罪飆高，城市卻一樣吸引人')
      .toBeLessThan(calculateAttractiveness(seenCity));
  });

  it('should shrink how many newcomers this round can take', () => {
    // 這是玩家真正看得到的後果:同樣的空房，願意來的人變少。
    const seenCity = cityAsSeenByNewcomers(0);
    const pop = 18, vacant = 18;
    const capOf = (c: CityAttractiveness) =>
      getImmigrationCap(pop, vacant, calculateAttractiveness(c));
    const plainCap = capOf(seenCity);
    expect(plainCap, '本來就沒有人要搬進來，量不出減少').toBeGreaterThan(0);
    expect(capOf({ ...seenCity, crimeRate: seenCity.crimeRate + 40 }), '犯罪飆高，移民上限卻沒有變小')
      .toBeLessThan(plainCap);
  });

  it('should not move the crime rate when no ordinance is in force', () => {
    // 反面控制:把犯罪率寫死成一個大數字的實作也會讓第一條過。這座城市只有
    // 二十來人又沒有警察局，基礎犯罪是人口 × 0.02，連 1 都不到。
    const a = cityAsSeenByNewcomers(0);
    const b = cityAsSeenByNewcomers(0);
    expect(a.crimeRate, '沒開條例，外地人看到的犯罪率卻是個大數字').toBeLessThan(5);
    // 上了種子而且每次建城都重設序列，所以兩次執行是逐字相同的。差一點點就表示
    // 有東西在 A/B 之間漏了狀態。
    expect(a.crimeRate, '同樣的城市兩次跑出不一樣的犯罪率').toBe(b.crimeRate);
  });
});
