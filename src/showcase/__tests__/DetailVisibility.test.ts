import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DetailVisibility } from '../detailVisibility';
import { DETAIL_LOD } from '../../renderer/detailLOD';

/**
 * 展示區的遠景細節剔除。
 *
 * 遊戲把矮物件與懸挑放在 `InstancedLayer` 裡，靠整層的閘門開關；展示區畫的是
 * 普通 `Mesh`，那個閘門碰不到它。兩邊的**門檻與遲滯**必須是同一份 ——
 * 展示區唯一的價值是「這裡看到的就是出貨的東西」，而地板顏色（BUG-231）
 * 已經示範過同一件事各寫一份的下場。
 *
 * 所以判斷本身抽在 `renderer/detailLOD`（純函式、不碰 Three.js），這個類別
 * 只負責記住哪些 Mesh 屬於可剔除的兩層。
 */
describe('showcase detail visibility', () => {
  const cube = () => new THREE.Mesh(new THREE.BoxGeometry());

  it('should hide everything it tracks once zoomed far out', () => {
    const lod = new DetailVisibility();
    const a = cube();
    const b = cube();
    lod.add(a);
    lod.add(b);

    lod.update(DETAIL_LOD.HIDE_ABOVE + 1);

    expect(a.visible, '第一個沒被關掉').toBe(false);
    expect(b.visible, '第二個沒被關掉').toBe(false);
  });

  it('should bring them back when zoomed in again', () => {
    const lod = new DetailVisibility();
    const a = cube();
    lod.add(a);

    lod.update(200);
    lod.update(DETAIL_LOD.SHOW_BELOW - 1);

    expect(a.visible, '沒有回來').toBe(true);
  });

  it('should start new meshes hidden while zoomed out', () => {
    // 與遊戲那一側的 `acquire` 完全同一個坑：切換控制項會整批重畫，
    // 而重畫出來的東西若一律 visible = true，縮在遠景時動一下滑桿
    // 矮物件就會全部冒回來。
    const lod = new DetailVisibility();
    lod.update(200);

    const late = cube();
    lod.add(late);

    expect(late.visible, '重畫出來的物件把細節帶回來了').toBe(false);
  });

  it('should share the game thresholds exactly', () => {
    // 展示區自己抄一份門檻的話，兩邊會在不同的縮放掉細節 —— 那就等於
    // 展示區又開始說謊。這一條在數值漂移時轉紅。
    const lod = new DetailVisibility();
    const a = cube();
    lod.add(a);

    lod.update(DETAIL_LOD.HIDE_ABOVE);
    expect(a.visible, '剛好在門檻上就關掉了').toBe(true);

    lod.update(DETAIL_LOD.HIDE_ABOVE + 0.001);
    expect(a.visible, '過了門檻沒關').toBe(false);

    lod.update(DETAIL_LOD.SHOW_BELOW);
    expect(a.visible, '遲滯帶內就打開了').toBe(false);

    lod.update(DETAIL_LOD.SHOW_BELOW - 0.001);
    expect(a.visible, '低於下門檻沒開').toBe(true);
  });

  it('should be driven by showcase/main.ts, not just exist', () => {
    // 同 Game.ts 那一側：這層接線沒有單元測試擋得住（main.ts 一載入就要
    // DOM 與 WebGL），所以照 `EveryFieldIsAccountedFor` 的前例讀原始碼。
    // 它擋的是「整個功能在展示區是死碼」。
    const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const lines = src.split('\n');

    const call = lines.findIndex(l => l.includes('detailLOD.update('));
    expect(call, 'showcase/main.ts 從來沒有呼叫 update').toBeGreaterThanOrEqual(0);
    expect(lines.slice(call, call + 3).join('\n'), '餵進去的不是視錐高度')
      .toContain('camera.top');

    expect(src, '重畫時沒有放掉舊的參照').toContain('detailLOD.clear()');
    expect(src, '新畫出來的物件沒有登記').toContain('detailLOD.add(');
  });

  it('should forget meshes that were cleared away', () => {
    // 展示區每次重畫都會 dispose 舊的 Mesh。留著參照就是洩漏，而且
    // 下一次 update 會去動已經不在場景裡的東西。
    const lod = new DetailVisibility();
    const gone = cube();
    lod.add(gone);
    lod.clear();

    lod.update(200);

    expect(gone.visible, '被清掉的物件還在被管').toBe(true);
    expect(lod.size, '參照沒有放掉').toBe(0);
  });
});
