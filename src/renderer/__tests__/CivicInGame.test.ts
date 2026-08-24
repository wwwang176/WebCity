import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { HighlightManager } from '../HighlightManager';
import { getBuildingMaterial } from '../BuildingMaterial';
import { getCivicPlan, civicTypesDone } from '../geometry/civic/registry';
import { placeCivicPlan } from '../geometry/civic/place';
import type { InfraType } from '../../core/building/InfraConfig';

/**
 * All nineteen civic buildings take the same path **in the game** too.
 *
 * Visible only in the showcase, the game's `BuildingRenderer` takes a completely separate path:
 * hand-written `MeshLambertMaterial` over solid `BoxGeometry`, with no windows, no lit windows at
 * night and no emissive (BUG-238). One building looks different in the two places, and "what the
 * showcase shows is what ships" is the showcase's only value.
 *
 * This group tests **that it is wired in**, not the geometry itself, whose acceptance lives in
 * `civic/__tests__/CivicPlans.test.ts` and each batch's model tests.
 */

const TYPES = civicTypesDone();

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(c => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
}

describe('公共建築的遊戲內模型', () => {
  it('should have a plan for every infrastructure type', () => {
    // One missing type is one still drawn in the game as a hand-written box, which on screen looks
    // like something is there.
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
   * The per-instance attributes are actually written.
   *
   * On a non-instanced `Mesh` those attributes **do not exist at all**, and WebGL feeds 0 for every
   * unbound attribute: `aOccupancy = 0` means "nobody here", so not one window lights. That is
   * BUG-238's symptom, and it reports nothing.
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
    // The older path wrote geometry bottoms at 0.05, the road height, floating every building 0.6 m
    // up, which is why `snapToGround` exists. A plan's geometry already sits on the ground, so
    // aligning must not push it up again.
    const scene = new THREE.Scene();
    new BuildingRenderer().addInfrastructure(scene, 0, 0, 'police', 0);
    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y, '建築浮空或陷進地裡').toBeLessThan(0.05);
    expect(box.min.y, '建築陷進地面以下').toBeGreaterThanOrEqual(-1e-6);
  });
});

/**
 * Highlighting must not clone materials.
 *
 * `applyTintToGroup` recognises `MeshLambertMaterial` and `MeshBasicMaterial` only, so once civic
 * buildings use a `ShaderMaterial` neither branch matches and highlighting **fails silently**. A
 * third branch would still be wrong: a cloned material never receives `uTime`, and a highlighted
 * building's windows freeze in one lit state and never move again.
 *
 * The building shader already reads `aHighlight` and `aHighlightColor`, which is the path zoned
 * buildings take. Civic buildings do the same, and no material is touched.
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
    // Parked vehicles use `MeshLambertMaterial` and take the cloning path by design; this case
    // guards the layers that use the building shader.
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
