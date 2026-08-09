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
 * 縮到遠景時把矮物件與懸挑整層關掉。
 *
 * 鏡頭是正交的，所以沒有「遠處的建築」—— 全畫面同一個距離，唯一有意義的
 * 訊號是縮放（`camera.top - camera.bottom`，單位是格）。這讓整件事變成一個
 * 全域布林翻三層的 `visible`，不需要逐實例的距離判斷，也不需要簡化幾何。
 *
 * 地面貼片**不關**：它是平的鋪面，撐住「地面有東西」的觀感，關掉會讓遠景
 * 整片地變空，工業區那塊柏油也會消失。
 */

type Internals = {
  zoneLayer: Layer;
  decalLayer: Layer;
  propLayer: Layer;
  overheadLayer: Layer;
};

type LayerName = keyof Internals;

/**
 * 一整座小城，四層都有實例可以看。
 *
 * 必須混住宅與商業：獨棟住宅沒有雨遮也沒有招牌，所以只蓋住宅的話懸挑層
 * 一個實例都沒有，「懸挑被關掉了」會因為它本來就是空的而假裝成立。
 * `(7, 7)` 留白給「遠景時新蓋一棟」那一條。
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
 * 這一層有多少非空的桶畫得出來：全部、一個都沒有，還是介於中間。
 *
 * 三態而不是布林。二值的「每個桶都畫嗎」會漏掉最重要的那個失敗 ——
 * 閘門漏在 `acquire` 時只有**新蓋的那一桶**會亮回來，其餘仍是關的，
 * 於是「不是全開」照樣成立、測試綠燈通過。'some' 一律是錯的。
 *
 * 空桶本來就是 `visible = false`（那是省 render list 的既有優化），不算在內。
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
    // 量體關掉就沒有城市了；貼片是選擇留下的（見檔頭）。這一條是防止
    // 「乾脆全部關掉」這種省事的實作。
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
    // 兩個門檻之間必須留一段遲滯。只有一條線的話，滾輪停在門檻上會讓整層
    // 每幀開關一次 —— 那比不做還糟，因為畫面在閃。
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
    // 這是最容易漏的一條：`acquire()` 為了讓桶從空變成有實例，會設
    // `visible = true`。少了閘門，縮在遠景時蓋一棟新房子，它腳下的矮物件
    // 會單獨冒出來 —— 而且只有那一桶。
    const { renderer, internals } = city();
    renderer.updateDetailLOD(200);
    renderer.addBuilding(7, 7, ZoneType.COMMERCIAL_LOW, 'LOW', 3, false);

    expect(drawnState(internals, 'propLayer'), '新蓋的房子把矮物件帶回來了').toBe('none');
  });
});

describe('view mode hides every attachment layer', () => {
  it('should hide decals, low props and overheads behind the white model', () => {
    // 階段 2B 把這三層從量體拆出去時漏掉了 `setViewMode`：它藏的是
    // variantMeshes / overlayMeshes / infraGroups，三個附掛層一個都沒藏，
    // `buildWhiteModelMesh` 也沒烘它們。所以切到污染或地價檢視時，貼片、
    // 樹、招牌會維持原色浮在白模上面。
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
    // 兩個閘門是獨立的。離開檢視模式時直接把三層設回 visible，會讓縮在
    // 遠景的鏡頭突然長回矮物件 —— 而使用者從頭到尾沒有動過滾輪。
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
    // 上面九條全綠、遊戲裡卻什麼都沒發生 —— 因為沒有人呼叫。這一層接線
    // 沒有單元測試擋得住（`Game` 要真的 WebGL 才建得起來），所以照
    // `EveryFieldIsAccountedFor` 與 `JsxIdentifiersAreImported` 的前例讀原始碼。
    //
    // 它擋的是「整個功能是死碼」，不是「參數算對了」。後者靠 DETAIL_LOD
    // 的註解與那兩個門檻本身。
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
    // 閘門開不等於全部畫出來。空桶要維持關閉 —— three.js 對 count === 0 的
    // InstancedMesh 仍會走完整條 render list，而開局大部分的桶都是空的。
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
    // `release()` 把桶清空時會設 visible = false，而清空後再開閘門也不該
    // 把它打開。反過來說，閘門關著時移除實例也不能把它打開。
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
