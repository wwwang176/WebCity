import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HighlightManager } from '../HighlightManager';

/**
 * 漸層高亮下，每一棟公共建築要拿**自己那一格**的顏色。
 *
 * 原本是 `cells[0].color` —— 整批基礎設施一律塗成陣列裡第一格的顏色。通勤圖層
 * 把站牌標成青色、住宅標成漸層色，於是所有交通建築都被塗成第一個住宅格的顏色，
 * 那一格通勤很糟的話就是全城的公共建築一起變紅。
 *
 * 警消圖層也有同樣的毛病，只是那裡的顏色全都來自同一組漸層，塗錯了看起來只是
 * 深淺不對，不像通勤圖層那樣一眼看穿。
 */

/** 一棟位在 (x,z) 的公共建築。 */
function infraGroup(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  group.add(mesh);
  return group;
}

function tintOf(group: THREE.Group): number | null {
  let hex: number | null = null;
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && hex === null) {
      const mat = child.material as THREE.MeshLambertMaterial;
      hex = mat.color.getHex();
    }
  });
  return hex;
}

const RED = 0xff5252;
const CYAN = 0x00e5ff;

describe('漸層高亮下的公共建築顏色', () => {
  it('should tint each building with the colour of its own cell', () => {
    const home = infraGroup(3, 3);
    const station = infraGroup(9, 9);
    const hm = new HighlightManager(new THREE.Scene(), () => 0);

    hm.hoverHighlightGradient(
      [{ x: 3, y: 3, color: RED }, { x: 9, y: 9, color: CYAN }],
      [], [home, station], 1.0,
    );

    expect(tintOf(station), '站牌被塗成第一格的顏色，不是自己的').not.toBe(tintOf(home));
  });

  it('should not repaint a building that is not in the highlight set', () => {
    const listed = infraGroup(3, 3);
    const other = infraGroup(20, 20);
    const before = tintOf(other);
    const hm = new HighlightManager(new THREE.Scene(), () => 0);

    hm.hoverHighlightGradient([{ x: 3, y: 3, color: RED }], [], [listed, other], 1.0);

    expect(tintOf(other), '不在名單上的建築也被上色了').toBe(before);
  });

  it('should still tint the building that is in the set', () => {
    const listed = infraGroup(3, 3);
    const before = tintOf(listed);
    const hm = new HighlightManager(new THREE.Scene(), () => 0);

    hm.hoverHighlightGradient([{ x: 3, y: 3, color: RED }], [], [listed], 1.0);

    expect(tintOf(listed), '名單上的建築完全沒有被上色').not.toBe(before);
  });
});
