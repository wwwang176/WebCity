import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HighlightManager } from '../HighlightManager';

/**
 * Under a gradient highlight each civic building takes **its own cell's** colour.
 *
 * With `cells[0].color`, every piece of infrastructure is painted the colour of the array's first
 * cell. The commute overlay marks stops cyan and houses on a gradient, so every transit building is
 * painted the first residential cell's colour — and if that cell commutes badly, every civic
 * building in the city turns red together.
 *
 * The police and fire overlays have the same flaw, but their colours all come from one gradient, so
 * the error only reads as a wrong shade rather than being obvious at a glance.
 */

/** A civic building at (x,z). */
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
