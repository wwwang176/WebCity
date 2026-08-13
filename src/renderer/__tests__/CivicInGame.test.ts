import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { HighlightManager } from '../HighlightManager';
import { getBuildingMaterial } from '../BuildingMaterial';
import { getCivicPlan, civicTypesDone } from '../geometry/civic/registry';
import { placeCivicPlan } from '../geometry/civic/place';
import type { InfraType } from '../../core/building/InfraConfig';

/**
 * 十九種公共建築在**遊戲裡**也走同一條路。
 *
 * 它們原本只在 showcase 看得到：遊戲裡的 `BuildingRenderer` 走的是另一條
 * 完全獨立的路徑 —— 手寫的 `MeshLambertMaterial` 加實心 `BoxGeometry`，
 * 沒有窗戶、沒有夜間亮窗、沒有自發光（BUG-238）。同一棟建築在兩個地方
 * 長得不一樣，而「展示區看到的就是出貨的東西」是展示區唯一的價值。
 *
 * 這一組測的是**接上去了**，不是幾何本身 —— 幾何的驗收在
 * `civic/__tests__/CivicPlans.test.ts` 與各批的 model 測試裡。
 */

const TYPES = civicTypesDone();

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(c => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
}

describe('公共建築的遊戲內模型', () => {
  it('should have a plan for every infrastructure type', () => {
    // 少一種就是那一種在遊戲裡仍然是一個手寫的方塊，而畫面上它「有東西」。
    expect(TYPES.length, '還有種類沒有 plan').toBe(19);
  });

  it.each(TYPES)('should build %s from its plan', (type) => {
    const group = new THREE.Group();
    const placed = placeCivicPlan(getCivicPlan(type)!, group);
    expect(placed.building.length, `${type} 一個量體都沒有`).toBeGreaterThan(0);
    for (const mesh of placed.building) {
      expect(mesh.material, `${type} 有一層沒走建築 shader`)
        .toBe(getBuildingMaterial());
    }
  });

  /**
   * 逐實例屬性要真的寫進去。
   *
   * 非實例化的 `Mesh` 上那些 attribute **完全不存在**，而 WebGL 對沒有繫結的
   * attribute 一律餵 0 —— `aOccupancy = 0` 的意思是「沒有人」，所以一扇燈都
   * 不會亮。這正是 BUG-238 的現象，而它不會報錯。
   */
  it.each(TYPES)('should stamp the attributes the shader reads on %s', (type) => {
    const group = new THREE.Group();
    const placed = placeCivicPlan(getCivicPlan(type)!, group);
    for (const mesh of placed.building) {
      for (const name of ['aSeed', 'aOccupancy', 'aBldgColor', 'aHighlight']) {
        expect(mesh.geometry.getAttribute(name), `${type} 少了 ${name}`).toBeDefined();
      }
      const occ = mesh.geometry.getAttribute('aOccupancy');
      expect(occ.getX(0), `${type} 的 aOccupancy 是 0 —— 夜裡一扇燈都不會亮`)
        .toBeGreaterThan(0);
    }
  });

  it.each(TYPES)('should place %s into the scene through BuildingRenderer', (type) => {
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.addInfrastructure(scene, 3, 4, type as InfraType, 0);

    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    expect(group, `${type} 沒有進場景`).toBeTruthy();
    const shader = meshesOf(group).filter(m => m.material === getBuildingMaterial());
    expect(shader.length, `${type} 在遊戲裡仍然走舊的手寫路徑`).toBeGreaterThan(0);
  });

  it('should keep the ground under the building, not float it', () => {
    // 舊路徑的幾何底部寫在 0.05（路面高度），所以每一棟都浮空 0.6 m，
    // 而 `snapToGround` 是為了那件事存在的。plan 的幾何自己就貼著地面，
    // 所以對齊之後不該再被推上去。
    const scene = new THREE.Scene();
    new BuildingRenderer().addInfrastructure(scene, 0, 0, 'police', 0);
    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y, '建築浮空或陷進地裡').toBeLessThan(0.05);
    expect(box.min.y, '建築陷進地面以下').toBeGreaterThanOrEqual(-1e-6);
  });
});

/**
 * 高亮不准 clone 材質。
 *
 * 舊的 `applyTintToGroup` 只認得 `MeshLambertMaterial` 與 `MeshBasicMaterial`
 * —— 公共建築改走 `ShaderMaterial` 之後兩個分支都不中，高亮會**靜默失效**。
 * 而就算補上第三個分支也還是錯的：clone 出來的材質收不到 `uTime`，被高亮過
 * 的那一棟窗戶會凍結在某個亮燈狀態，而且再也不會動。
 *
 * 建築 shader 本來就吃 `aHighlight` / `aHighlightColor`，分區建築走的就是
 * 那條路。公共建築照做即可 —— 不必碰材質。
 */
describe('公共建築的高亮', () => {
  function setup() {
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.addInfrastructure(scene, 2, 2, 'police', 0);
    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const hm = new HighlightManager(scene, () => 0);
    return { scene, group, hm };
  }

  it('should tint a civic building without cloning its material', () => {
    const { group, hm } = setup();
    // 停放的車輛走 `MeshLambertMaterial`，它本來就是 clone 那條路 ——
    // 這一條顧的是走建築 shader 的那幾層。
    const before = meshesOf(group).filter(m => m.material === getBuildingMaterial());
    expect(before.length, '這一棟沒有任何一層走建築 shader').toBeGreaterThan(0);

    hm.highlight(2, 2, 3, 3, 0xff0000, [], [group]);
    for (const mesh of before) {
      expect(mesh.material, '高亮 clone 了材質 —— 它收不到 uTime')
        .toBe(getBuildingMaterial());
    }
    const lit = meshesOf(group).filter(m => {
      const a = m.geometry.getAttribute('aHighlight');
      return a && a.getX(0) > 0;
    });
    expect(lit.length, '高亮沒有寫進 aHighlight —— 它靜默失效了')
      .toBeGreaterThan(0);
  });

  it('should put the highlight back when it clears', () => {
    const { group, hm } = setup();
    hm.highlight(2, 2, 3, 3, 0xff0000, [], [group]);
    hm.clear();
    for (const mesh of meshesOf(group)) {
      const a = mesh.geometry.getAttribute('aHighlight');
      if (!a) continue;
      expect(a.getX(0), '高亮沒有清掉 —— 那一棟會一直亮著').toBe(0);
    }
  });
});
