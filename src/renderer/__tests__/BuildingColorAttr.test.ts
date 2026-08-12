import { describe, it, expect } from 'vitest';
import { BUILDING_VERT } from '../BuildingMaterial';

/**
 * 建築的牆色從哪裡來。
 *
 * 分區建築走 `InstancedMesh.setColorAt` → `instanceColor`，那條路徑一直是對的。
 * 但公共建築在遊戲裡是 `THREE.Group` 底下的普通 `Mesh`，展示區也是普通 `Mesh`
 * —— 它們**沒有** `instanceColor`，所以會落到 `#else` 分支。
 *
 * 那個分支以前寫死 `vec3(0.7)`：不論是警局還是消防局，牆一律是同一片灰。
 * 「警局藍、消防局紅」在那個寫法下做不到。
 */
/**
 * 只切出決定 `vBldgColor` 的那一段。
 *
 * 不能用 `indexOf('#ifdef USE_INSTANCING')` 當終點 —— `USE_INSTANCING` 是
 * `USE_INSTANCING_COLOR` 的前綴，所以它會撞回起點，切出空字串，而空字串
 * 讓 `toContain` 以外的斷言全部靜靜地通過。
 */
function colourBlock(): string {
  const start = BUILDING_VERT.indexOf('#ifdef USE_INSTANCING_COLOR');
  const end = BUILDING_VERT.indexOf('mat4 world');
  return BUILDING_VERT.slice(start, end);
}

describe('非實例化的建築也要有自己的顏色', () => {
  it('should declare the per-geometry colour attribute', () => {
    expect(BUILDING_VERT, '沒有宣告 aBldgColor').toContain('attribute vec3 aBldgColor;');
  });

  it('should read that attribute when there is no instanceColor', () => {
    const block = colourBlock();
    expect(block.length, '找不到 vBldgColor 的指定').toBeGreaterThan(0);
    expect(block, '非實例化的分支還是寫死的灰').not.toContain('vec3(0.7)');
    expect(block, '非實例化的分支沒有讀 aBldgColor').toContain('vBldgColor = aBldgColor;');
  });

  it('should still prefer instanceColor when instancing', () => {
    // 分區建築在遊戲裡走這一條。改壞的話整座城市的建築會變成同一個顏色。
    const block = colourBlock();
    expect(block).toContain('vBldgColor = instanceColor;');
    expect(block.indexOf('instanceColor'), 'instanceColor 不在 #ifdef 那一支')
      .toBeLessThan(block.indexOf('aBldgColor'));
  });
});
