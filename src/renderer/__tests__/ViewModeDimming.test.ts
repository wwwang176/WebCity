import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoadRenderer } from '../RoadRenderer';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { Grid } from '../../core/grid/Grid';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { RoadType, RoadDirection } from '../../core/road/types';
import { RailType } from '../../core/rail/types';
import { ViewMode } from '../../core/ViewMode';

/**
 * 進 focus 模式時，地面上的東西會被壓成半透明白模。
 *
 * 兩件事在這裡把關：
 *  1. **切回來要真的切回來。** 壓白模是直接改材質的 `color`，而顏色的定義只有
 *     建構材質那一行 —— 沒有人記住原色的話，還原時就沒東西可以寫回去。
 *  2. **高架要跟著地面一起變。** 高架路是獨立的一組 renderer，漏掉它的話，
 *     地下模式會被一整層不透明的高架橋蓋住。
 */

interface RoadInternals {
  roadMesh: THREE.InstancedMesh;
  sidewalkMesh: THREE.InstancedMesh;
  markingMesh: THREE.InstancedMesh;
  centerLineMesh: THREE.InstancedMesh;
  curvedCLMesh: THREE.InstancedMesh;
  crosswalkMesh: THREE.InstancedMesh;
  stopLineMesh: THREE.InstancedMesh;
  lampMesh: THREE.InstancedMesh;
}

const ROAD_MESH_KEYS = [
  'roadMesh', 'sidewalkMesh', 'markingMesh', 'centerLineMesh',
  'curvedCLMesh', 'crosswalkMesh', 'stopLineMesh', 'lampMesh',
] as const;

/** 一條東西向的地面道路，鋪滿一整列。 */
function makeRoadRenderer() {
  const scene = new THREE.Scene();
  const grid = new Grid(8, 8);
  for (let x = 0; x < 8; x++) {
    grid.setCell(x, 4, { roadType: RoadType.TWO_LANE });
  }
  const renderer = new RoadRenderer();
  renderer.build(scene, grid);
  return { renderer, internals: renderer as unknown as RoadInternals };
}

function segment(overrides: Partial<{ roadType: number; railType: number }> = {}) {
  return {
    roadType: RoadType.TWO_LANE,
    roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    railType: RailType.NONE,
    railFlags: 0,
    isRamp: false,
    rampAscendDirection: 0,
    ...overrides,
  };
}

interface ElevatedLevel {
  roadMesh: THREE.InstancedMesh;
  sidewalkMesh: THREE.InstancedMesh;
  markingMesh: THREE.InstancedMesh;
  lampMesh: THREE.InstancedMesh;
  lampGlowMesh: THREE.InstancedMesh;
  lampGlowMat: THREE.MeshBasicMaterial;
  pillarMat: THREE.MeshLambertMaterial;
  railMat: THREE.MeshLambertMaterial;
  pillarMeshes: Map<string, THREE.Mesh>;
  railMeshes: Map<string, THREE.Mesh>;
}

interface ElevatedInternals {
  levels: Map<number, ElevatedLevel>;
}

/** 一條高架道路（含一段鐵軌，這樣護欄材質也會被用到）。 */
function makeElevatedRenderer(build = true) {
  const scene = new THREE.Scene();
  const grid = new Grid(8, 8);
  const em = new ElevationManager();
  for (let x = 1; x < 7; x++) {
    em.set(x, 4, 1, segment({ railType: x === 3 ? RailType.STANDARD : RailType.NONE }));
  }
  const renderer = new ElevatedRoadRenderer();
  if (build) renderer.build(scene, grid, em);
  return { renderer, internals: renderer as unknown as ElevatedInternals, scene, grid, em };
}

function levelOne(internals: ElevatedInternals): ElevatedLevel {
  const ld = internals.levels.get(1);
  if (!ld) throw new Error('高架第一層沒有建起來，這組情境等於沒測');
  return ld;
}

function matOf(mesh: THREE.Mesh | THREE.InstancedMesh): THREE.MeshLambertMaterial {
  return mesh.material as THREE.MeshLambertMaterial;
}

describe('地面道路：切回正常視角要還原顏色', () => {
  it('should give every road mesh back its own build-time colour', () => {
    const { renderer, internals } = makeRoadRenderer();
    const before = ROAD_MESH_KEYS.map(k => matOf(internals[k]).color.getHex());

    renderer.setViewMode(ViewMode.UNDERGROUND);
    // 中間這一段必須真的變過，否則下面的還原斷言等於在測一個沒發生的事。
    expect(matOf(internals.roadMesh).opacity, '進地下模式沒有變半透明').toBeLessThan(1);

    renderer.setViewMode(ViewMode.NORMAL);
    const after = ROAD_MESH_KEYS.map(k => matOf(internals[k]).color.getHex());

    expect(after, '切回正常視角之後顏色沒有還原').toEqual(before);
  });

  it('should not collapse the road meshes onto one shared colour', () => {
    // 路面 0x3a3a3a、人行道 0x707070、標線 0xaaaaaa…… 各自不同。全部還原成
    // 同一個值也能騙過「有還原」的斷言，所以這裡盯住它們仍然是好幾種顏色。
    const { renderer, internals } = makeRoadRenderer();
    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.setViewMode(ViewMode.NORMAL);

    const distinct = new Set(ROAD_MESH_KEYS.map(k => matOf(internals[k]).color.getHex()));
    expect(distinct.size, '所有道路網格被還原成同一個顏色').toBeGreaterThan(1);
  });

  it('should restore transparency flags as well as colour', () => {
    const { renderer, internals } = makeRoadRenderer();
    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.setViewMode(ViewMode.NORMAL);

    const mat = matOf(internals.roadMesh);
    expect(mat.transparent).toBe(false);
    expect(mat.opacity).toBe(1);
    expect(mat.depthWrite).toBe(true);
    expect(internals.roadMesh.renderOrder).toBe(0);
  });
});

describe('高架道路：地下模式要跟著半透明', () => {
  it('should dim the elevated deck when entering underground', () => {
    const { renderer, internals } = makeElevatedRenderer();
    const ld = levelOne(internals);

    renderer.setViewMode(ViewMode.UNDERGROUND);

    for (const mesh of [ld.roadMesh, ld.sidewalkMesh, ld.markingMesh, ld.lampMesh]) {
      expect(matOf(mesh).transparent, '高架仍然不透明，會蓋住地下的隧道').toBe(true);
      expect(matOf(mesh).opacity).toBeLessThan(1);
      expect(matOf(mesh).depthWrite).toBe(false);
    }
  });

  it('should dim pillars and railings too', () => {
    // 橋墩與護欄是每格一個獨立 mesh，共用一份材質 —— 走的不是 InstancedMesh
    // 那條路，漏掉的話地下模式會看到一排實心的柱子。
    const { renderer, internals } = makeElevatedRenderer();
    const ld = levelOne(internals);
    expect(ld.pillarMeshes.size, '沒有橋墩，這組情境等於沒測').toBeGreaterThan(0);
    expect(ld.railMeshes.size, '沒有護欄，這組情境等於沒測').toBeGreaterThan(0);

    renderer.setViewMode(ViewMode.UNDERGROUND);

    expect(ld.pillarMat.transparent).toBe(true);
    expect(ld.railMat.transparent).toBe(true);
    for (const m of ld.pillarMeshes.values()) expect(m.renderOrder).toBeGreaterThan(0);
    for (const m of ld.railMeshes.values()) expect(m.renderOrder).toBeGreaterThan(0);
  });

  it('should give the elevated deck its colour back on the way out', () => {
    const { renderer, internals } = makeElevatedRenderer();
    const ld = levelOne(internals);
    const before = [ld.roadMesh, ld.sidewalkMesh, ld.markingMesh, ld.lampMesh]
      .map(m => matOf(m).color.getHex());
    const pillarBefore = ld.pillarMat.color.getHex();

    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.setViewMode(ViewMode.NORMAL);

    const after = [ld.roadMesh, ld.sidewalkMesh, ld.markingMesh, ld.lampMesh]
      .map(m => matOf(m).color.getHex());
    expect(after, '高架切回來之後顏色沒有還原').toEqual(before);
    expect(ld.pillarMat.color.getHex()).toBe(pillarBefore);
    expect(ld.pillarMat.transparent).toBe(false);
  });

  it('should dim a deck that is built while already underground', () => {
    // 蓋一段高架路會整個重建 renderer，材質全部是新的。重建不重新套用視角的話，
    // 玩家在地下模式蓋出來的那一段會是唯一不透明的東西。
    const { renderer, scene, grid, em } = makeElevatedRenderer(false);
    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.build(scene, grid, em);

    const ld = levelOne(renderer as unknown as ElevatedInternals);
    expect(matOf(ld.roadMesh).transparent, '地下模式中重建的高架又變回不透明').toBe(true);
    expect(matOf(ld.roadMesh).opacity).toBeLessThan(1);
  });

  it('should dim pillars and railings added to an existing deck while underground', () => {
    // 在已經蓋好的那一層旁邊再接一格，走的是 updateCells —— 這一層早就存在，
    // 不會再經過 ensureLevel，所以新生出來的橋墩與護欄得自己知道現在是白模狀態。
    const { renderer, internals, scene, grid, em } = makeElevatedRenderer();
    renderer.setViewMode(ViewMode.UNDERGROUND);

    em.set(7, 4, 1, segment({ railType: RailType.STANDARD }));
    renderer.updateCells(scene, grid, em, ['7,4']);

    const ld = levelOne(internals);
    const added = [ld.pillarMeshes.get('7,4'), ld.railMeshes.get('7,4')];
    expect(added, '新的一格沒有長出橋墩或護欄，這組情境等於沒測').not.toContain(undefined);
    for (const m of added) {
      expect(m!.renderOrder, '地下模式中新蓋的橋墩／護欄排在不透明物體那一批').toBeGreaterThan(0);
    }
  });

  it('should keep the lamp glow dark while dimmed', () => {
    // 燈光是加色混合的光暈，半透明蓋不住它 —— 地下模式會看到一排飄在空中的光點。
    const { renderer, internals } = makeElevatedRenderer();
    const ld = levelOne(internals);

    renderer.setViewMode(ViewMode.UNDERGROUND);
    // 切換當下就要滅掉，不能等下一次 update() —— 中間那幾個影格也是玩家看得到的。
    expect(ld.lampGlowMesh.visible, '切進地下模式的瞬間光暈還亮著').toBe(false);

    renderer.update(0);   // 半夜，路燈全開

    expect(ld.lampGlowMat.opacity, '地下模式看得到高架路燈的光暈').toBe(0);
  });
});
