import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { propGeometry, propExtent, type PropSpec } from '../props';
import { triangleCount } from '../buildings/parts';
import { M } from '../buildings/massing/metrics';

const boundsOf = (parts: THREE.BufferGeometry[]) => {
  const box = new THREE.Box3();
  for (const g of parts) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  return box;
};

/**
 * 圍籬。
 *
 * `props.ts` 一直有 `fencePost` 與 `fenceRail` 兩個圖元（住宅那側從物件帶
 * 算出座標再呼叫它們），但沒有宣告式的入口 —— 而公共建築是宣告式的，它只能
 * 寫一張表。四座廠區與機場都要圍籬，各自用方塊量體再畫一遍的下場是同一座
 * 城市裡四種長得不一樣的圍籬。
 */
describe('圍籬', () => {
  const fence = (o: Partial<Extract<PropSpec, { kind: 'fence' }>> = {}) =>
    ({ kind: 'fence' as const, x: 0, z: 0, axis: 'z' as const, length: M(6), ...o });

  it('should build posts and a rail', () => {
    const parts = propGeometry(fence());
    expect(parts.length, '圍籬不只一段').toBeGreaterThan(2);
    for (const g of parts) expect(triangleCount(g), '有一段是空的').toBeGreaterThan(0);
  });

  it('should span the length it was asked for', () => {
    // 短了的話兩段圍籬之間會露出縫；長了的話它會伸出基地。
    const box = boundsOf(propGeometry(fence({ length: M(6) })));
    expect(box.max.x - box.min.x).toBeCloseTo(M(6), 4);
  });

  it('should lay the fence along the axis it was given', () => {
    // `'z'` 表示沿世界 x 展開 —— 與 `strip`、`hedge` 同一套約定。兩邊不一致
    // 的話，一道本來要圍住廠區北緣的圍籬會橫在大門前面。
    const along = boundsOf(propGeometry(fence({ axis: 'z' })));
    const across = boundsOf(propGeometry(fence({ axis: 'x' })));
    expect(along.max.x - along.min.x).toBeGreaterThan(along.max.z - along.min.z);
    expect(across.max.z - across.min.z).toBeGreaterThan(across.max.x - across.min.x);
  });

  it('should space the posts evenly along the run', () => {
    // 不等距的柱子讀起來是壞掉的圍籬。柱數隨長度成長 —— 固定三根的話，
    // 一道 30 m 的圍籬中間會垂著兩條沒有支撐的長桿。
    const short = propGeometry(fence({ length: M(4) })).length;
    const long = propGeometry(fence({ length: M(20) })).length;
    expect(long, '長圍籬沒有多加柱子').toBeGreaterThan(short);
  });

  it('should report an extent that covers the whole run', () => {
    // 少報的話它會伸出基地而沒有人擋（`assembleFixtures` 只看 `propExtent`）。
    const e = propExtent(fence({ length: M(6) }));
    const box = boundsOf(propGeometry(fence({ length: M(6) })));
    expect(e.x + 1e-9, '沿長度的範圍少報了').toBeGreaterThanOrEqual(box.max.x);
    expect(e.z + 1e-9, '沿厚度的範圍少報了').toBeGreaterThanOrEqual(box.max.z);
  });

  it('should stay below head height', () => {
    // 圍籬是矮物件。高過 2.2 m 的行人淨空就變成牆了。
    const box = boundsOf(propGeometry(fence()));
    expect(box.max.y * 12).toBeLessThan(2.2);
  });
});
