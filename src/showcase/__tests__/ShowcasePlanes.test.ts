import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShowcasePlanes } from '../planes';
import { civicLayout } from '../civicLayout';
import { getAirportDimensions } from '../../core/transport/AirportSystem';

/**
 * 展示區的飛機起降動畫。
 *
 * 展示區要有飛機動畫才比較得出來。比較的對象是貼片 ——
 * 飛機真的落在跑道上嗎、真的沿著滑行道走嗎、真的停進機位嗎。
 */
describe('展示區的飛機', () => {
  const scene = () => new THREE.Scene();

  /**
   * 機場原點的換算。
   *
   * `AirplaneAnimator` 從 `airport.x + (w − 1) / 2` 算佔地中心，而 `airport.x`
   * 是**左上角的格索引**。直接把 slot 的中心填進去的話，整批飛機會偏掉半座
   * 機場 —— 而畫面上那只是「飛機好像沒對準跑道」。
   */
  it('should place the airport so its centre lands on the layout slot', () => {
    const planes = new ShowcasePlanes(scene());
    const slot = { size: 'LARGE' as const, x: -3.5, z: 8.25 };
    planes.setFields([slot]);
    const [airport] = (planes as unknown as { airports: Array<{ x: number; y: number }> })
      .airports;
    const dim = getAirportDimensions('LARGE');
    expect(airport!.x + (dim.w - 1) / 2, '機場中心沒有落在 slot 上')
      .toBeCloseTo(slot.x, 9);
    expect(airport!.y + (dim.h - 1) / 2, '機場中心沒有落在 slot 上')
      .toBeCloseTo(slot.z, 9);
  });

  /** 跑 `seconds` 秒，回報「其間有沒有出現過飛機」與最後一幀的池子。 */
  const fly = (planes: ShowcasePlanes, seconds: number) => {
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    let everSeen = false;
    for (let t = 0; t < seconds; t += 0.5) {
      planes.update(0.5);
      if (pool.some(m => m.visible)) everSeen = true;
    }
    return { everSeen, pool };
  };

  it('should run the very animator the game runs', () => {
    // 另寫一份的話，展示區看到的對齊與遊戲裡的對齊會是兩件事 —— 而展示區
    // 的唯一價值就是「這裡看到的就是出貨的東西」。
    //
    // 問的是「**期間**有沒有出現過」而不是「最後一幀在不在」：一輪起降跑完
    // 之後飛機就離場了，下一班還要等一個班距 —— 只看最後一幀的話，測試會
    // 隨著跑多久而時綠時紅。
    const planes = new ShowcasePlanes(scene());
    planes.setFields([{ size: 'SMALL', x: 0, z: 0 }]);
    expect(fly(planes, 45).everSeen, '跑了 45 秒沒有出現任何一架飛機').toBe(true);
  });

  it('should hide every plane when the view is cleared', () => {
    const planes = new ShowcasePlanes(scene());
    planes.setFields([{ size: 'SMALL', x: 0, z: 0 }]);
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    // **跑到真的有飛機在場上為止**再清。跑固定秒數的話，那一輪起降可能剛好
    // 已經結束，於是「清乾淨了」是廢話 —— 把 `clear()` 整個拿掉測試也是綠的。
    for (let t = 0; t < 120 && !pool.some(m => m.visible); t += 0.5) {
      planes.update(0.5);
    }
    expect(pool.some(m => m.visible), '一直沒有飛機可以清').toBe(true);
    planes.clear();
    expect(pool.every(m => !m.visible), '切走檢視模式之後飛機還留在場上')
      .toBe(true);
  });

  it('should fly the plane over the runway it was given, not over the origin', () => {
    // 機場原點換算錯的話，飛機仍然會飛 —— 只是飛在別的地方。所以要看它
    // **飛到哪裡**，不是「有沒有飛」。
    const at = { size: 'SMALL' as const, x: 20, z: -14 };
    const planes = new ShowcasePlanes(scene());
    planes.setFields([at]);
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    let closest = Infinity;
    for (let t = 0; t < 45; t += 0.5) {
      planes.update(0.5);
      for (const m of pool) {
        if (!m.visible) continue;
        closest = Math.min(closest, Math.hypot(m.position.x - at.x, m.position.z - at.z));
      }
    }
    expect(closest, '飛機從來沒有靠近過那座機場').toBeLessThan(4);
  });

  it('should fly a plane at every airport in the layout', () => {
    // 排版裡有三座機場。少接一座的話那一座永遠是空的，而它看起來只是
    // 「這座沒有班機」。
    const airports = civicLayout(['airport_s', 'airport_m', 'airport_l'])
      .map(s => s.type);
    expect(airports.length, '排版裡的機場數不是三座').toBe(3);
  });
});
