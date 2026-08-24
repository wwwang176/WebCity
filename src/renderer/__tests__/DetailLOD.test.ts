import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { DETAIL_LOD } from '../detailLOD';
import { InstancedLayer } from '../InstancedLayer';
import type { InstancedLayer as Layer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { ViewMode } from '../../core/ViewMode';

/**
 * Zoomed out, the low-prop and overhead layers switch off wholesale.
 *
 * The camera is orthographic, so there is no such thing as a distant building — the whole screen is
 * at one distance, and the only meaningful signal is the zoom (`camera.top - camera.bottom`, in
 * cells). That makes the whole thing one global boolean flipping three layers' `visible`, with no
 * per-instance distance test and no simplified geometry.
 *
 * Ground decals **stay on**: they are flat paving holding up the sense that the ground has
 * something on it, and dropping them empties the ground at range, taking the industrial zone's
 * asphalt with it.
 */

type Internals = {
  zoneLayer: Layer;
  decalLayer: Layer;
  propLayer: Layer;
  overheadLayer: Layer;
};

type LayerName = keyof Internals;

/**
 * A small city with instances in all four layers.
 *
 * Residential and commercial have to be mixed: a detached house has neither canopy nor signage, so
 * a residential-only city leaves the overhead layer with no instances at all and "the overhead
 * layer was switched off" passes because it was empty to begin with. `(7, 7)` is left free for the
 * "build one while zoomed out" case.
 */
function city() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(8, 8));
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      renderer.addBuilding(x, y, ZoneType.RESIDENTIAL_LOW, 'LOW', 2, false);
      renderer.addBuilding(x, y + 4, ZoneType.COMMERCIAL_LOW, 'LOW', 3, false);
    }
  }
  return { renderer, internals: renderer as unknown as Internals };
}

/**
 * How many of this layer's non-empty buckets draw: all, none, or somewhere in between.
 *
 * Three states rather than a boolean. A binary "do all buckets draw" misses the most important
 * failure: with the gate missed in `acquire`, only the **newly built** bucket comes back on and the
 * rest stay off, so "not all open" still holds and the test passes. 'some' is always wrong.
 *
 * Empty buckets are `visible = false` already — an existing optimisation that saves render list
 * work — and are not counted.
 */
function drawnState(internals: Internals, name: LayerName): 'all' | 'none' | 'some' {
  const layer = internals[name];
  let shown = 0;
  let total = 0;
  for (const [key, mesh] of layer.bucketMap) {
    if (layer.countOf(key) === 0) continue;
    total++;
    if (mesh.visible) shown++;
  }
  expect(total, `${name} 一個實例都沒有，這條測試等於沒測`).toBeGreaterThan(0);
  return shown === total ? 'all' : shown === 0 ? 'none' : 'some';
}

describe('detail LOD', () => {
  it('should hide low props and overheads when zoomed far out', () => {
    const { renderer, internals } = city();
    expect(drawnState(internals, 'propLayer'), '一開始就是關的').toBe('all');

    renderer.updateDetailLOD(DETAIL_LOD.HIDE_ABOVE + 1);

    expect(drawnState(internals, 'propLayer'), '矮物件沒有被關掉').toBe('none');
    expect(drawnState(internals, 'overheadLayer'), '懸挑沒有被關掉').toBe('none');
  });

  it('should keep the massing and the ground decals at every zoom', () => {
    // Switching off the masses leaves no city, and decals are kept deliberately (see the top of
    // this file). This guards against the lazy implementation that switches everything off.
    const { renderer, internals } = city();
    renderer.updateDetailLOD(200);

    expect(drawnState(internals, 'zoneLayer'), '量體被關掉了').toBe('all');
    expect(drawnState(internals, 'decalLayer'), '地面貼片被關掉了').toBe('all');
  });

  it('should bring them back when zoomed in again', () => {
    const { renderer, internals } = city();
    renderer.updateDetailLOD(200);
    renderer.updateDetailLOD(DETAIL_LOD.SHOW_BELOW - 1);

    expect(drawnState(internals, 'propLayer'), '矮物件沒有回來').toBe('all');
    expect(drawnState(internals, 'overheadLayer'), '懸挑沒有回來').toBe('all');
  });

  it('should not flip inside the hysteresis band', () => {
    // The two thresholds have to leave a band of hysteresis. With a single line, a wheel resting on
    // it switches the whole layer on and off every frame — worse than doing nothing, because the
    // screen flickers.
    expect(DETAIL_LOD.HIDE_ABOVE, '遲滯帶是空的').toBeGreaterThan(DETAIL_LOD.SHOW_BELOW);

    const mid = (DETAIL_LOD.HIDE_ABOVE + DETAIL_LOD.SHOW_BELOW) / 2;
    const { renderer, internals } = city();

    renderer.updateDetailLOD(mid);
    expect(drawnState(internals, 'propLayer'), '從近景進遲滯帶就關掉了').toBe('all');

    renderer.updateDetailLOD(DETAIL_LOD.HIDE_ABOVE + 1);
    renderer.updateDetailLOD(mid);
    expect(drawnState(internals, 'propLayer'), '從遠景進遲滯帶就打開了').toBe('none');
  });

  it('should keep new buildings hidden while zoomed out', () => {
    // The easiest one to miss: `acquire()` sets `visible = true` to bring a bucket from empty to
    // occupied. Without the gate, building a house while zoomed out makes the low props at its feet
    // appear on their own — and only that one bucket.
    const { renderer, internals } = city();
    renderer.updateDetailLOD(200);
    renderer.addBuilding(7, 7, ZoneType.COMMERCIAL_LOW, 'LOW', 3, false);

    expect(drawnState(internals, 'propLayer'), '新蓋的房子把矮物件帶回來了').toBe('none');
  });
});

describe('view mode hides every attachment layer', () => {
  it('should hide decals, low props and overheads behind the white model', () => {
    // `setViewMode` hides variantMeshes, overlayMeshes and infraGroups, and none of the three
    // attachment layers, which `buildWhiteModelMesh` does not bake either. So switching to the
    // pollution or land value view leaves decals, trees and signage in their own colours floating
    // above the white model.
    const { renderer, internals } = city();
    const scene = new THREE.Scene();

    renderer.setViewMode(ViewMode.RAIL_FOCUS, scene);

    for (const name of ['decalLayer', 'propLayer', 'overheadLayer'] as const) {
      expect(drawnState(internals, name), `${name} 浮在白模上`).toBe('none');
    }
  });

  it('should restore them when returning to the normal view', () => {
    const { renderer, internals } = city();
    const scene = new THREE.Scene();

    renderer.setViewMode(ViewMode.RAIL_FOCUS, scene);
    renderer.setViewMode(ViewMode.NORMAL, scene);

    for (const name of ['decalLayer', 'propLayer', 'overheadLayer'] as const) {
      expect(drawnState(internals, name), `${name} 沒有回來`).toBe('all');
    }
  });

  it('should not resurrect the detail layers if the camera is still zoomed out', () => {
    // The two gates are independent. Setting all three back to visible on leaving a view mode makes
    // a zoomed-out camera suddenly grow low props again, with the user never having touched the
    // wheel.
    const { renderer, internals } = city();
    const scene = new THREE.Scene();

    renderer.updateDetailLOD(200);
    renderer.setViewMode(ViewMode.RAIL_FOCUS, scene);
    renderer.setViewMode(ViewMode.NORMAL, scene);

    expect(drawnState(internals, 'decalLayer'), '貼片沒有回來').toBe('all');
    expect(drawnState(internals, 'propLayer'), '矮物件在遠景復活了').toBe('none');
  });
});

describe('the game actually drives it', () => {
  it('should feed the camera frustum height in every frame', () => {
    // The nine cases above can all be green while nothing happens in the game, because nothing
    // calls it. No unit test can guard that wiring — `Game` needs real WebGL to construct — so this
    // reads the source, following `EveryFieldIsAccountedFor` and `JsxIdentifiersAreImported`.
    //
    // It guards against the whole feature being dead code, not against the parameters being right.
    // That is DETAIL_LOD's comments and the two thresholds themselves.
    const src = readFileSync(
      new URL('../../Game.ts', import.meta.url), 'utf8',
    );
    const call = src.split('\n').findIndex(l => l.includes('updateDetailLOD('));
    expect(call, 'Game.ts 從來沒有呼叫 updateDetailLOD').toBeGreaterThanOrEqual(0);

    const stmt = src.split('\n').slice(call, call + 3).join('\n');
    expect(stmt, '餵進去的不是視錐高度').toContain('camera.top');
    expect(stmt, '餵進去的不是視錐高度').toContain('camera.bottom');
  });
});

describe('InstancedLayer visibility gate', () => {
  it('should leave empty buckets hidden when the gate opens', () => {
    // An open gate does not mean everything draws. Empty buckets stay closed: three.js still walks
    // the full render list for an InstancedMesh with count === 0, and most buckets are empty at
    // startup.
    const layer = new InstancedLayer(new THREE.MeshBasicMaterial(), 4);
    const scene = new THREE.Scene();
    layer.createBucket(scene, 'empty', new THREE.BoxGeometry());
    layer.createBucket(scene, 'used', new THREE.BoxGeometry());
    layer.acquire(scene, 'used', '0,0');

    layer.setVisible(false);
    layer.setVisible(true);

    expect(layer.meshFor('empty')!.visible, '空桶被打開了').toBe(false);
    expect(layer.meshFor('used')!.visible, '有實例的桶沒有回來').toBe(true);
  });

  it('should keep the last release consistent with the gate', () => {
    // `release()` sets visible = false when it empties a bucket, and opening the gate afterwards
    // must not turn it back on. Conversely, removing an instance while the gate is closed must not
    // open it either.
    const layer = new InstancedLayer(new THREE.MeshBasicMaterial(), 4);
    const scene = new THREE.Scene();
    layer.createBucket(scene, 'b', new THREE.BoxGeometry());
    layer.acquire(scene, 'b', '0,0');
    layer.acquire(scene, 'b', '1,0');

    layer.setVisible(false);
    layer.release('1,0');

    expect(layer.meshFor('b')!.visible, '移除實例把關著的桶打開了').toBe(false);
  });
});
