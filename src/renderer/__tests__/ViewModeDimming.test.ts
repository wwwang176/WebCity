import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoadRenderer } from '../RoadRenderer';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { TrafficLightRenderer } from '../TrafficLightRenderer';
import { BuildingRenderer } from '../BuildingRenderer';
import { type TrafficLight } from '../../core/traffic/TrafficLights';
import { Grid } from '../../core/grid/Grid';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { RoadType, RoadDirection } from '../../core/road/types';
import { ZoneType } from '../../core/grid/types';
import { RailType } from '../../core/rail/types';
import { ViewMode } from '../../core/ViewMode';

/**
 * Entering a focus mode flattens everything on the ground into a translucent white model.
 *
 * Two things are guarded here:
 *  1. **Switching back really switches back.** Whitening writes the material's `color` directly, and
 *     the colour is defined only on the line that constructs the material: with nothing recording
 *     the original, there is nothing to write back on restore.
 *  2. **Elevated follows the ground.** Elevated roads are a separate set of renderers, and missing
 *     them leaves underground mode covered by a whole layer of opaque viaduct.
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

/** One east-west ground road filling a whole row. */
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

/** One elevated road, including a stretch of rail so the parapet material is used too. */
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
    // The middle step has to actually change something, or the restore assertion below tests
    // something that never happened.
    expect(matOf(internals.roadMesh).opacity, '進地下模式沒有變半透明').toBeLessThan(1);

    renderer.setViewMode(ViewMode.NORMAL);
    const after = ROAD_MESH_KEYS.map(k => matOf(internals[k]).color.getHex());

    expect(after, '切回正常視角之後顏色沒有還原').toEqual(before);
  });

  it('should not collapse the road meshes onto one shared colour', () => {
    // Road surface 0x3a3a3a, sidewalk 0x707070, markings 0xaaaaaa and so on all differ. Restoring
    // them all to one value would still satisfy "it restored", so this watches that several colours
    // remain.
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

interface SignalInternals {
  poleMesh: THREE.InstancedMesh;
  armMesh: THREE.InstancedMesh;
  lightMesh: THREE.InstancedMesh;
}

const SIGNAL_MESH_KEYS = ['poleMesh', 'armMesh', 'lightMesh'] as const;

/** One four-way junction's signals. */
function trafficLight(x: number, y: number): TrafficLight {
  return {
    x, y, phase: 0, timer: 10, phaseDuration: 10, clearing: false,
    roadType: RoadType.FOUR_LANE,
    roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH
      | RoadDirection.EAST | RoadDirection.WEST,
  };
}

function makeSignalRenderer(build = true) {
  const scene = new THREE.Scene();
  const lights = [trafficLight(3, 3), trafficLight(6, 3)];
  const renderer = new TrafficLightRenderer();
  if (build) renderer.build(scene, lights);
  return { renderer, internals: renderer as unknown as SignalInternals, scene, lights };
}

interface BuildingInternals {
  infraIndex: Map<string, THREE.Group>;
  _whiteModelMesh: THREE.Mesh | null;
}

/** A bus stop, a train station and a police station. */
function makeBuildingRenderer() {
  const scene = new THREE.Scene();
  const renderer = new BuildingRenderer();
  renderer.build(scene, new Grid(16, 16));
  renderer.addInfrastructure(scene, 2, 2, 'bus_stop', 0);
  renderer.addInfrastructure(scene, 6, 2, 'train_station', 0);
  renderer.addInfrastructure(scene, 10, 2, 'police', 0);
  return { renderer, internals: renderer as unknown as BuildingInternals, scene };
}

function whiteModelVertexCount(internals: BuildingInternals): number {
  const mesh = internals._whiteModelMesh;
  if (!mesh) throw new Error('白模沒有建起來，這組情境等於沒測');
  return mesh.geometry.getAttribute('position').count;
}

describe('白模', () => {
  it('should actually bake a white model when the city has infrastructure', () => {
    // Handing every geometry to mergeGeometries untouched fails: infrastructure models variously
    // carry uvs or not and are indexed or not, so the merge returns null — by which point the real
    // buildings are already visible = false. The result is not a white model but the city
    // disappearing.
    const { renderer, internals, scene } = makeBuildingRenderer();

    renderer.setViewMode(ViewMode.UNDERGROUND, scene);

    const mesh = internals._whiteModelMesh;
    expect(mesh, '白模沒有建起來 —— 建築已經隱藏了，畫面上什麼都不剩').not.toBeNull();
    expect(mesh!.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('should bake zone buildings and infrastructure together', () => {
    // The two have different geometry attributes, and mixed together they are a real city.
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.build(scene, new Grid(16, 16));
    renderer.addBuilding(1, 1, ZoneType.RESIDENTIAL_LOW, 'LOW', 2, false);
    renderer.addInfrastructure(scene, 5, 5, 'police', 0);

    renderer.setViewMode(ViewMode.UNDERGROUND, scene);

    const internals = renderer as unknown as BuildingInternals;
    expect(internals._whiteModelMesh, '住宅與基礎設施混在一起就合併失敗').not.toBeNull();
  });
});

describe('聚焦中的那一種站點要保持原樣', () => {
  it('should keep the focused stops in colour and white-model the rest', () => {
    const { renderer, internals, scene } = makeBuildingRenderer();

    renderer.setViewMode(ViewMode.BUS_FOCUS, scene);

    expect(internals.infraIndex.get('2,2')!.visible, '公車聚焦時公車站被白模吃掉了').toBe(true);
    expect(internals.infraIndex.get('6,2')!.visible, '火車站沒有白模化').toBe(false);
    expect(internals.infraIndex.get('10,2')!.visible, '警察局沒有白模化').toBe(false);
  });

  it('should focus a different stop type per view mode', () => {
    const { renderer, internals, scene } = makeBuildingRenderer();

    renderer.setViewMode(ViewMode.RAIL_FOCUS, scene);

    expect(internals.infraIndex.get('6,2')!.visible, '鐵路聚焦時火車站被白模吃掉了').toBe(true);
    expect(internals.infraIndex.get('2,2')!.visible, '公車站在鐵路聚焦下還是原色').toBe(false);
  });

  it('should leave the focused stop out of the white model', () => {
    // Keeping the original colours while also baking into the white model leaves one station with
    // two geometries stacked and flickering against each other.
    const bus = makeBuildingRenderer();
    bus.renderer.setViewMode(ViewMode.BUS_FOCUS, bus.scene);
    const rail = makeBuildingRenderer();
    rail.renderer.setViewMode(ViewMode.RAIL_FOCUS, rail.scene);

    expect(
      whiteModelVertexCount(bus.internals),
      '公車聚焦的白模與鐵路聚焦一樣大 —— 公車站還是被烘進去了',
    ).not.toBe(whiteModelVertexCount(rail.internals));
  });

  it('should put everything back when the focus ends', () => {
    const { renderer, internals, scene } = makeBuildingRenderer();
    renderer.setViewMode(ViewMode.BUS_FOCUS, scene);
    renderer.setViewMode(ViewMode.NORMAL, scene);

    for (const key of ['2,2', '6,2', '10,2']) {
      expect(internals.infraIndex.get(key)!.visible, `${key} 沒有回到正常視角`).toBe(true);
    }
  });
});

describe('路口號誌：地下模式要跟著半透明', () => {
  it('should dim the poles, arms and lamp heads', () => {
    // Signals are street furniture like street lamps: left solid once the ground is whitened,
    // underground mode shows a row of traffic lights floating over a translucent road.
    const { renderer, internals } = makeSignalRenderer();

    renderer.setViewMode(ViewMode.UNDERGROUND);

    for (const key of SIGNAL_MESH_KEYS) {
      const mat = matOf(internals[key]);
      expect(mat.transparent, `${key} 仍然是實心的`).toBe(true);
      expect(mat.opacity).toBeLessThan(1);
      expect(mat.depthWrite).toBe(false);
      expect(internals[key].renderOrder).toBeGreaterThan(0);
    }
  });

  it('should give the signals their colour back on the way out', () => {
    const { renderer, internals } = makeSignalRenderer();
    const before = SIGNAL_MESH_KEYS.map(k => matOf(internals[k]).color.getHex());

    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.setViewMode(ViewMode.NORMAL);

    const after = SIGNAL_MESH_KEYS.map(k => matOf(internals[k]).color.getHex());
    expect(after, '號誌切回來之後顏色沒有還原').toEqual(before);
    expect(matOf(internals.poleMesh).transparent).toBe(false);
    expect(internals.poleMesh.renderOrder).toBe(0);
  });

  it('should dim signals rebuilt while already underground', () => {
    // Changing a junction rebuilds the signals entirely, with fresh materials.
    const { renderer, internals, scene, lights } = makeSignalRenderer(false);
    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.build(scene, lights);

    expect(matOf(internals.poleMesh).transparent, '地下模式中重建的號誌又變回實心').toBe(true);
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
    // Piers and parapets are one mesh per cell sharing a material, not the InstancedMesh path;
    // missed, underground mode shows a row of solid columns.
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
    // Building a stretch of elevated road rebuilds the renderer entirely with fresh materials.
    // Without reapplying the view mode, the stretch a player builds in underground mode is the only
    // opaque thing there.
    const { renderer, scene, grid, em } = makeElevatedRenderer(false);
    renderer.setViewMode(ViewMode.UNDERGROUND);
    renderer.build(scene, grid, em);

    const ld = levelOne(renderer as unknown as ElevatedInternals);
    expect(matOf(ld.roadMesh).transparent, '地下模式中重建的高架又變回不透明').toBe(true);
    expect(matOf(ld.roadMesh).opacity).toBeLessThan(1);
  });

  it('should dim pillars and railings added to an existing deck while underground', () => {
    // Adding one cell beside an existing level goes through updateCells: that level already exists
    // and does not pass through ensureLevel again, so the new piers and parapets have to know the
    // white-model state for themselves.
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
    // The lights are additive glows that translucency cannot hide: underground mode shows a row of
    // points of light floating in the air.
    const { renderer, internals } = makeElevatedRenderer();
    const ld = levelOne(internals);

    renderer.setViewMode(ViewMode.UNDERGROUND);
    // They go out at the moment of switching rather than at the next update(): the frames in
    // between are visible to the player too.
    expect(ld.lampGlowMesh.visible, '切進地下模式的瞬間光暈還亮著').toBe(false);

    renderer.update(0);   // 半夜，路燈全開

    expect(ld.lampGlowMat.opacity, '地下模式看得到高架路燈的光暈').toBe(0);
  });
});
