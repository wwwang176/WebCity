import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { SIMULATION } from '../../simulation/SimulationConstants';
import { buildOverlayValue, type OverlayBuildContext } from '../../overlay/OverlayBuilders';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';
import { HAPPINESS } from '../../citizen/Happiness';

/**
 * 條例上寫著 Crime +12，玩家在犯罪圖層、幸福度、棄置壓力上卻一點也看不到 ——
 * 那 UI 就是在說謊。犯罪原本只走到地價那一條線。
 *
 * 這裡量的是犯罪真正的四個出口，不是地價。
 */

// 整個檔案都上種子:每一條測試都在比較兩座城市，而 tick 裡的建築成長、解僱、
// 車輛抖動都在擲骰子。`city()` 另外在每次建城時重設序列，讓 A/B 從同一點出發。
useSeededRandom();

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;
/** Small Shop（COMMERCIAL_LOW）。 */
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // A/B 的兩座城市要從同一個亂數狀態出發。不重設的話第二次接續第一次留下的
  // 序列，兩座城市會自己走岔，量到的是那個岔而不是條例。
  reseedRandom();
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    for (let i = 0; i < 4; i++) {
      // 有家也有工作。失業的懲罰是 −15 起跳，會把幸福度壓在地板上 —— 那時候
      // 犯罪的 −10 加不加都一樣，測試就量不到東西了。
      state.citizens.restoreCitizen(
        { homeId: toPosKey(x, 11), workplaceId: toPosKey(x, 9) }, 0);
    }
  }
  // 要有電有水。缺一樣，幸福度就會掉到 0、房子就會自己被棄置 —— 兩個出口都被
  // 壓到底之後，條例推不推得動就量不出來了。
  state.power.addPlant({ x: 12, y: 8, output: 100000, pollution: 0, type: 'wind' });
  state.water.addPlant({ x: 13, y: 8, output: 100000 });
  return { state, loop: new SimulationLoop(state) };
}

/** 圖層的 ctx 就是 GameState 加兩個通勤統計欄位（見 `Game.buildOverlayData`）。 */
function overlayCtx(state: GameState): OverlayBuildContext {
  return Object.assign(Object.create(state) as OverlayBuildContext, {
    commuteByHome: new Map<string, number>(),
    commuteMax: 1,
  });
}

/** 圖層鍵是字串 —— `OverlayType` 這個 enum 住在 renderer，core 不能 import。 */
function crimeOverlayAt(state: GameState, x: number, y: number): number {
  return buildOverlayValue(overlayCtx(state), 'crime', state.grid.getCell(x, y)!, x, y);
}

/** 暫時給全城條例塞一組效果。測的是接線，不是某一條條例現在的數字。 */
function withCityCrime(state: GameState, crime: number, body: () => void) {
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
  state.ordinances.setLevel(type, 1);
  try {
    body();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

/** 分區版本。賭場借來當載體 —— 測的是接線，不是賭場現在的數字。 */
function withDistrictCrime(
  state: GameState, districtId: string, crime: number, body: () => void,
) {
  const type = PolicyType.LEGALIZE_GAMBLING;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
  state.policies.setPolicyLevel(districtId, type, 1);
  try {
    body();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('犯罪圖層看得到條例', () => {
  it('should rise where a district legalises gambling', () => {
    const { state } = city();
    const before = crimeOverlayAt(state, 10, 11);
    expect(before, '圖層本來就是 0，這條測試等於空轉').toBeGreaterThan(0);

    const d = state.districts.createDistrict('D');
    for (let x = 6; x < 12; x++) state.districts.addCellToDistrict(d.id, x, 11);
    state.policies.setPolicyLevel(d.id, PolicyType.LEGALIZE_GAMBLING, 1);

    expect(crimeOverlayAt(state, 10, 11), '賭場區的犯罪圖層沒有變高').toBeGreaterThan(before);
    expect(crimeOverlayAt(state, 15, 11), '分區外的格子也跟著變高了').toBe(before);
  });

  it('should fall city-wide under a surveillance network', () => {
    const { state } = city();
    const before = crimeOverlayAt(state, 15, 11);
    state.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);
    expect(crimeOverlayAt(state, 15, 11), '監視器網路沒有降低犯罪圖層').toBeLessThan(before);
  });
});

describe('犯罪走到幸福度', () => {
  it('should make residents unhappier', () => {
    // 直接叫那一輪的幸福度計算，不跑整個 tick —— 建築成長與棄置都帶隨機取樣，
    // 混進來的話兩次執行的差異就不一定來自犯罪了。既有測試也是這樣戳私有方法
    // （見 `BuildingAbandonment.test.ts`）。
    const avgHappinessWith = (crime: number) => {
      const { state, loop } = city();
      // 快樂度改成分片之後，一個 tick 只重算其中一片 —— 要推進 SLOW_TICK_INTERVAL 個
      // tick 才輪得到每一位市民（BUG-330）。時鐘不動的話會重複算同一片。
      const inner = loop as unknown as {
        refreshHappinessContext(): void;
        updateCitizenHappinessSlice(): void;
      };
      const update = () => {
        inner.refreshHappinessContext();
        for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL; i++) {
          state.clock.tick++;
          inner.updateCitizenHappinessSlice();
        }
      };
      if (crime !== 0) withCityCrime(state, crime, () => { for (let i = 0; i < 8; i++) update(); });
      else for (let i = 0; i < 8; i++) update();
      const cs = state.citizens.getCitizens();
      return cs.reduce((s, c) => s + c.happiness, 0) / cs.length;
    };
    const plain = avgHappinessWith(0);
    const withCrime = avgHappinessWith(60);
    expect(plain, '幸福度已經是 0，再低也看不出來').toBeGreaterThan(0);
    // 綁在常數上而不是「比較小」:上了種子之後兩次執行只差條例這一項，差距就是
    // 犯罪懲罰本身。犯罪 60 超過最高門檻，拿到的是最重的那一級。
    //
    // 只寫 toBeLessThan 的話沒有接線也有一半機率會過 —— 那正是這條測試上種子之前
    // 的樣子。
    const worst = HAPPINESS.CRIME_MODIFIERS[0]!.modifier;
    expect(plain - withCrime, '犯罪飆高，居民卻一樣開心').toBeCloseTo(-worst, 6);
  });
});

describe('犯罪走到棄置壓力', () => {
  // 棄置的犯罪門檻是 30 —— 一座小城的基礎犯罪遠低於它，所以只有條例推得過去。
  const abandonedAfter = (
    withPolicy: (state: GameState, districtId: string, run: () => void) => void,
  ) => {
    const { state, loop } = city();
    const d = state.districts.createDistrict('D');
    for (let x = 6; x < 19; x++) state.districts.addCellToDistrict(d.id, x, 11);
    withPolicy(state, d.id, () => { for (let i = 0; i < 120; i++) loop.tick(); });
    let n = 0;
    state.grid.forEachCell((cell) => {
      if (cell.buildingId === HOUSE && cell.reserved !== 0) n++;
    });
    return n;
  };

  it('should stay standing when no ordinance is in force', () => {
    expect(abandonedAfter((_state, _id, run) => run()),
      '什麼都沒開就有房子被棄置，量不到條例的影響').toBe(0);
  });

  it('should push buildings towards abandonment city-wide', () => {
    expect(abandonedAfter((state, _id, run) => withCityCrime(state, 200, run)),
      '全城條例把犯罪飆到 200 也沒有房子撐不住').toBeGreaterThan(0);
  });

  it('should add the two scopes up before deciding the crime is gone', () => {
    // 夾值只能做一次，而且要在全城與分區都加完之後。
    //
    // 先夾全城那一半的話:基礎 1 + 全城 −100 會先變成 0，分區的 +120 再加上去就是
    // 120 —— 遠超過棄置門檻 30。全部加完再夾是 max(0, 1 − 100 + 120) = 21，房子
    // 撐得住。同一格在地價那條線看到 21、在棄置這條線看到 120，兩套系統對同一件
    // 事有兩個答案。
    const n = abandonedAfter((state, districtId, run) => {
      withCityCrime(state, -100, () => withDistrictCrime(state, districtId, 120, run));
    });
    expect(n, '全城的減量被提早夾成 0，分區的加量才會把房子壓垮').toBe(0);
  });

  it('should push buildings towards abandonment inside the district that asked for it', () => {
    expect(abandonedAfter((state, id, run) => withDistrictCrime(state, id, 200, run)),
      '分區條例把犯罪飆到 200 也沒有房子撐不住').toBeGreaterThan(0);
  });
});
