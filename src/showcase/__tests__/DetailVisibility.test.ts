import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DetailVisibility } from '../detailVisibility';
import { DETAIL_LOD } from '../../renderer/detailLOD';

/**
 * The showcase's distance culling of detail.
 *
 * The game holds ground props and overhangs in `InstancedLayer`s and gates whole layers; the showcase
 * draws plain `Mesh` nodes that gate cannot reach. The **thresholds and hysteresis** have to be one
 * shared copy — the showcase's only value is that what it shows is what ships, and the floor colour
 * (BUG-231) already demonstrated what two copies of one thing lead to.
 *
 * So the decision itself lives in `renderer/detailLOD`, a pure function that does not touch
 * Three.js, and this class only remembers which meshes belong to the two cullable layers.
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
    // Exactly the trap `acquire` holds on the game's side: touching a control redraws everything,
    // and if everything redrawn is visible = true, moving a slider while zoomed out brings all the
    // ground props back.
    const lod = new DetailVisibility();
    lod.update(200);

    const late = cube();
    lod.add(late);

    expect(late.visible, '重畫出來的物件把細節帶回來了').toBe(false);
  });

  it('should share the game thresholds exactly', () => {
    // With a copy of the thresholds in the showcase, the two drop detail at different zooms and the
    // showcase starts lying again. This case turns red when the numbers drift.
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
    // As on Game.ts' side: no unit test can cover this wiring, since loading main.ts requires DOM and
    // WebGL, so it reads the source as `EveryFieldIsAccountedFor` does. What it guards against is the
    // whole feature being dead code in the showcase.
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
    // The showcase disposes the old meshes on every redraw. A retained reference leaks, and the next
    // update touches something no longer in the scene.
    const lod = new DetailVisibility();
    const gone = cube();
    lod.add(gone);
    lod.clear();

    lod.update(200);

    expect(gone.visible, '被清掉的物件還在被管').toBe(true);
    expect(lod.size, '參照沒有放掉').toBe(0);
  });
});
