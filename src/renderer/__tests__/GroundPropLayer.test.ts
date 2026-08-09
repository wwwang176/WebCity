import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { GROUND_LAYERS } from '../geometry/buildings/propBands';

const ZONE = ZoneType.RESIDENTIAL_LOW;

type Internals = Record<LayerName, InstancedLayer> & { zoneLayer: InstancedLayer };

/** 掛在建築上的三層。同一組不變式對三層都成立，所以測試也逐層跑。 */
const ATTACHMENT_LAYERS = ['decalLayer', 'propLayer', 'overheadLayer'] as const;
type AnyLayer = LayerName | 'zoneLayer';
type LayerName = (typeof ATTACHMENT_LAYERS)[number];

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

/** 這一格某一層實例的矩陣。 */
function layerMatrix(
  internals: Internals, layer: AnyLayer, x: number, y: number,
): THREE.Matrix4 {
  const entry = internals[layer].entryFor(`${x},${y}`)!;
  const mesh = internals[layer].meshFor(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  return m;
}

/** 這一格某一層在世界座標中的包圍盒。 */
function layerBox(
  internals: Internals, layer: AnyLayer, x: number, y: number,
): THREE.Box3 {
  const entry = internals[layer].entryFor(`${x},${y}`)!;
  const mesh = internals[layer].meshFor(entry.key)!;
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(layerMatrix(internals, layer, x, y));
}

const propMatrix = (i: Internals, x: number, y: number) => layerMatrix(i, 'propLayer', x, y);
const propBox = (i: Internals, x: number, y: number) => layerBox(i, 'propLayer', x, y);

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

/**
 * 貼片與懸挑是另外兩層。三層的實例管理一模一樣（同一個矩陣、跟著建築進退），
 * 差別只在幾何來源與是否投影 —— 所以不變式也要三層都測，否則新加的兩層會
 * 各自漂移。
 */
describe('the massing layer is never scaled either', () => {
  it('should keep the instance matrix free of scale', () => {
    // BUG-219 的不變式擴及量體層本身。生成器產出的是最終尺寸，所以實例矩陣
    // 只該有旋轉與位移 —— 縮放一旦回來，附掛層就又看不到建築有多寬了。
    const scale = new THREE.Vector3();
    const cases: Array<[number, number, 'LOW' | 'HIGH']> = [
      [ZoneType.RESIDENTIAL_LOW, 1, 'LOW'],
      [ZoneType.RESIDENTIAL_HIGH, 3, 'HIGH'],
      [ZoneType.INDUSTRIAL, 2, 'LOW'],
      [ZoneType.OFFICE, 3, 'HIGH'],
    ];
    cases.forEach(([zone, level, density], i) => {
      const { renderer, internals } = fresh();
      renderer.addBuilding(i, 0, zone, density, level, false);
      layerMatrix(internals, 'zoneLayer', i, 0).decompose(
        new THREE.Vector3(), new THREE.Quaternion(), scale,
      );
      expect(scale.x, `zone ${zone} 寬被縮放`).toBeCloseTo(1, 9);
      expect(scale.y, `zone ${zone} 高被縮放`).toBeCloseTo(1, 9);
      expect(scale.z, `zone ${zone} 深被縮放`).toBeCloseTo(1, 9);
    });
  });

  it('should draw every building at the size its variant was generated at', () => {
    // 上一條看矩陣，這一條看畫出來的結果 —— 兩者一起才擋得住「縮放搬到
    // 幾何生成裡」這種繞過。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, false);
    const entry = internals.zoneLayer.entryFor('0,0')!;
    const mesh = internals.zoneLayer.meshFor(entry.key)!;
    const authored = new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    const drawn = layerBox(internals, 'zoneLayer', 0, 0);
    expect(drawn.max.y - drawn.min.y).toBeCloseTo(authored.max.y - authored.min.y, 9);
    // 平面上比對「兩軸範圍的集合」而不是逐軸：四分之一圈的旋轉會交換 x 與 z。
    const span = (b: THREE.Box3) =>
      [b.max.x - b.min.x, b.max.z - b.min.z].sort((p, q) => p - q);
    const [a0, a1] = span(authored);
    const [d0, d1] = span(drawn);
    expect(d0).toBeCloseTo(a0!, 9);
    expect(d1).toBeCloseTo(a1!, 9);
  });
});

describe('decal and overhead layers', () => {
  /** 三層都有東西的組合：商業低 L2 起貼片、庭院、雨遮俱全。 */
  const SHOP = { zone: ZoneType.COMMERCIAL_LOW, density: 'LOW' as const };

  it('should not let flat decals cast shadows', () => {
    // 一片沒有厚度的四邊形投出來的影子是一條線，而且每一棟都要算一次。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 1, false);
    const entry = internals.decalLayer.entryFor('0,0')!;
    expect(internals.decalLayer.meshFor(entry.key)!.castShadow).toBe(false);
  });

  it('should still let overhead props cast shadows', () => {
    // 反過來的那一半：雨遮是立體的，它在人行道上投下的影子正是騎樓的樣子。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    const entry = internals.overheadLayer.entryFor('0,0')!;
    expect(internals.overheadLayer.meshFor(entry.key)!.castShadow).toBe(true);
  });

  it('should give every zone a forecourt', () => {
    const { renderer, internals } = fresh();
    const cells: Array<[number, number, 'LOW' | 'HIGH']> = [
      [0, ZoneType.RESIDENTIAL_LOW, 'LOW'],
      [1, ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
      [2, ZoneType.COMMERCIAL_LOW, 'LOW'],
      [3, ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [4, ZoneType.INDUSTRIAL, 'LOW'],
      [5, ZoneType.OFFICE, 'LOW'],
      [6, ZoneType.OFFICE, 'HIGH'],
    ];
    for (const [x, zone, density] of cells) {
      renderer.addBuilding(x, 0, zone, density, 3, false);
      expect(internals.decalLayer.entryFor(`${x},0`), `zone ${zone} 沒有前庭`).toBeDefined();
    }
  });

  it('should lay the forecourt at exactly the paving height', () => {
    // 貼片的幾何自己帶著絕對高度（鋪面與標線的層序留在幾何裡），所以實例
    // 不能再加一次基準高 —— 加了會把標線推到 5 mm，也把鋪面推離牆腳。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 1, false);
    expect(layerBox(internals, 'decalLayer', 0, 0).min.y)
      .toBeCloseTo(GROUND_LAYERS.DECAL, 9);
  });

  it('should never scale any of the three layers', () => {
    // BUG-219 的不變式擴及新的兩層：雨遮不會因為樓變高而變大，
    // 鋪面不會因為基地抖窄而縮水。
    const scale = new THREE.Vector3();
    for (const level of [2, 3]) {
      const { renderer, internals } = fresh();
      renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, level, false);
      for (const layer of ATTACHMENT_LAYERS) {
        layerMatrix(internals, layer, 0, 0).decompose(
          new THREE.Vector3(), new THREE.Quaternion(), scale,
        );
        expect(scale.x, `${layer} L${level} 寬被縮放`).toBeCloseTo(1, 9);
        expect(scale.y, `${layer} L${level} 高被縮放`).toBeCloseTo(1, 9);
        expect(scale.z, `${layer} L${level} 深被縮放`).toBeCloseTo(1, 9);
      }
    }
  });

  it('should take all three layers away with the building', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.addBuilding(1, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.removeBuilding(0, 0);
    for (const layer of ATTACHMENT_LAYERS) {
      expect(internals[layer].entryFor('0,0'), `${layer} 留下孤兒`).toBeUndefined();
      expect(internals[layer].entryFor('1,0'), `${layer} 誤刪鄰居`).toBeDefined();
    }
  });

  it('should swap all three layers when the shop upgrades', () => {
    // 三層的組合都依等級而不同，所以升級必須換桶 —— 只改矩陣的話，
    // L3 的店會配著 L2 的鋪面與雨遮。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 2, false);
    const before = ATTACHMENT_LAYERS.map(l => internals[l].entryFor('0,0')!.key);
    renderer.updateBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    ATTACHMENT_LAYERS.forEach((layer, i) => {
      expect(internals[layer].entryFor('0,0')!.key, `${layer} 沒跟著升級`)
        .not.toBe(before[i]);
      // 換桶前必須先退位，否則舊桶留下一個沒有主人的實例 —— 索引表指向新桶，
      // 舊的那一份永遠不會被移除，畫面上是 L2 的鋪面疊在 L3 的鋪面下。
      // 看的是舊桶的實例數：索引表以格子為 key，孤兒不會讓 size 變大。
      expect(internals[layer].countOf(before[i]!), `${layer} 舊桶留下孤兒`).toBe(0);
    });
  });

  it('should clear all three layers when the map is rebuilt', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 4; x++) renderer.addBuilding(x, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    for (const layer of ATTACHMENT_LAYERS) {
      expect(internals[layer].size, `${layer} 沒清乾淨`).toBe(0);
    }
  });

  it('should keep every remaining forecourt on its own building after removals', () => {
    // swap-with-last 的索引 bug 只在移除之後才現形，而且畫面上看不出來。
    const { renderer, internals } = fresh();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        renderer.addBuilding(x, y, SHOP.zone, SHOP.density, 3, false);
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
      for (const layer of ATTACHMENT_LAYERS) {
        pos.setFromMatrixPosition(layerMatrix(internals, layer, x, y));
        expect(pos.x, `${layer} ${x},${y} 跑到別人家`).toBeCloseTo(x, 6);
        expect(pos.z, `${layer} ${x},${y} 跑到別人家`).toBeCloseTo(y, 6);
      }
    }
  });
});
