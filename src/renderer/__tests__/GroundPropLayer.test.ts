import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals { propLayer: InstancedLayer }

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

/** 這一格地面物件實例的矩陣。 */
function propMatrix(internals: Internals, x: number, y: number): THREE.Matrix4 {
  const entry = internals.propLayer.entryFor(`${x},${y}`)!;
  const mesh = internals.propLayer.meshFor(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  return m;
}

/** 這一格的地面物件在世界座標中的包圍盒。 */
function propBox(internals: Internals, x: number, y: number): THREE.Box3 {
  const entry = internals.propLayer.entryFor(`${x},${y}`)!;
  const mesh = internals.propLayer.meshFor(entry.key)!;
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(propMatrix(internals, x, y));
}

describe('ground prop layer', () => {
  it('should never scale a garden, at any level', () => {
    // BUG-219：等級是乘在整份合併幾何上的 Y 縮放，所以住宅低 L1 升到 L3 時
    // 庭院的樹被拉高 1.75 倍（1.44 -> 2.52 m）。樹不會因為房子加蓋而長高。
    //
    // 斷言的是「矩陣沒有縮放」而不是「不同等級的庭院一樣高」—— 後者是錯的，
    // 庭院組合本來就隨等級換（素土院子 -> 樹籬 -> 修剪庭園）。
    const scale = new THREE.Vector3();
    for (const level of [1, 2, 3]) {
      for (const [x, y] of [[0, 0], [3, 7], [11, 4]] as const) {
        const { renderer, internals } = fresh();
        renderer.addBuilding(x, y, ZONE, 'LOW', level, false);
        propMatrix(internals, x, y).decompose(
          new THREE.Vector3(), new THREE.Quaternion(), scale,
        );
        expect(scale.x, `L${level} @${x},${y} 寬被縮放`).toBeCloseTo(1, 9);
        expect(scale.y, `L${level} @${x},${y} 高被縮放`).toBeCloseTo(1, 9);
        expect(scale.z, `L${level} @${x},${y} 深被縮放`).toBeCloseTo(1, 9);
      }
    }
  });

  it('should draw the garden at exactly the size it was authored', () => {
    // 上一條看矩陣，這一條看畫出來的結果 —— 兩者一起才擋得住「縮放搬到
    // 幾何生成裡」這種繞過。真實尺寸：4 m 的樹就該是 4 m。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 2, false);
    const entry = internals.propLayer.entryFor('0,0')!;
    const mesh = internals.propLayer.meshFor(entry.key)!;
    const authored = new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    const drawn = propBox(internals, 0, 0);
    expect(drawn.max.y - drawn.min.y).toBeCloseTo(authored.max.y - authored.min.y, 9);
  });

  it('should give every low-density house a garden', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    }
    expect(internals.propLayer.size).toBe(36);
  });

  it('should give every zone props, not just residential', () => {
    // 階段 2B 時這一條是「鋪滿基地的分區沒有物件」—— 那是當時的幾何事實。
    // 2B-2 把建築縮窄 7-8% 讓出 0.4 m 的帶子之後，事實反過來了。
    const { renderer, internals } = fresh();
    const cells: Array<[number, number, number, 'LOW' | 'HIGH']> = [
      [0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
      [1, 0, ZoneType.INDUSTRIAL, 'LOW'],
      [2, 0, ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [3, 0, ZoneType.OFFICE, 'HIGH'],
      [4, 0, ZoneType.COMMERCIAL_LOW, 'LOW'],
    ];
    for (const [x, y, zone, density] of cells) {
      renderer.addBuilding(x, y, zone, density, 3, false);
      expect(internals.propLayer.entryFor(`${x},${y}`), `zone ${zone} 沒有物件`).toBeDefined();
    }
  });

  it('should take the garden away with the building', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    renderer.addBuilding(1, 0, ZONE, 'LOW', 1, false);
    renderer.removeBuilding(0, 0);
    expect(internals.propLayer.entryFor('0,0')).toBeUndefined();
    expect(internals.propLayer.entryFor('1,0')).toBeDefined();
  });

  it('should swap the garden when the house upgrades', () => {
    // 庭院組合依等級而不同，所以升級必須換桶 —— 只改矩陣不換桶的話，
    // L3 的房子會配著 L1 的素土院子。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    const before = internals.propLayer.entryFor('0,0')!.key;
    renderer.updateBuilding(0, 0, ZONE, 'LOW', 3, false);
    expect(internals.propLayer.entryFor('0,0')!.key).not.toBe(before);
  });

  it('should clear every garden when the map is rebuilt', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 4; x++) renderer.addBuilding(x, 0, ZONE, 'LOW', 1, false);
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    expect(internals.propLayer.size).toBe(0);
  });

  it('should keep every remaining garden on its own house after removals', () => {
    // swap-with-last 的索引 bug 只在移除之後才現形，而且畫面上看不出來。
    // 20x20 也會撐破初始容量，順帶蓋到倍增那條路徑。
    const { renderer, internals } = fresh();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
        cells.push([x, y]);
      }
    }
    for (let i = 0; i < cells.length; i += 3) {
      renderer.removeBuilding(cells[i]![0], cells[i]![1]);
    }
    const pos = new THREE.Vector3();
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 === 0) continue;
      const [x, y] = cells[i]!;
      pos.setFromMatrixPosition(propMatrix(internals, x, y));
      expect(pos.x, `${x},${y} 的院子跑到別人家`).toBeCloseTo(x, 6);
      expect(pos.z, `${x},${y} 的院子跑到別人家`).toBeCloseTo(y, 6);
    }
  });

  it('should not give the whole street the same yard', () => {
    // 庭院自己一條亂數流。與量體共用的話，同一種房子必定配同一個院子，
    // 等於把重複感從房子搬到院子。
    const { renderer, internals } = fresh();
    const keys = new Set<string>();
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 3, false);
        keys.add(internals.propLayer.entryFor(`${x},${y}`)!.key);
      }
    }
    expect(keys.size).toBeGreaterThan(1);
  });
});
