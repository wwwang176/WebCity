import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstancedLayer } from '../InstancedLayer';

/**
 * 空桶的可見性。
 *
 * three.js 對 `count === 0` 的 `InstancedMesh` 仍會走完整條 render list ——
 * 量體桶從 60 漲到 168（階段 2C-1）之後，空桶的成本從「無所謂」變「有感」，
 * 而開局與稀疏城市大部分的桶都是空的。
 *
 * 直接測 `InstancedLayer` 而不是透過 `BuildingRenderer`：後者的 `build()` 會在
 * 建桶之後呼叫 `reset()`，把 `createBucket` 的初始狀態蓋掉 —— 從那個入口測，
 * 拿掉 `createBucket` 裡的那一行也不會轉紅。
 */
function layer() {
  const scene = new THREE.Scene();
  const l = new InstancedLayer(new THREE.MeshBasicMaterial(), 4);
  l.createBucket(scene, 'a', new THREE.BoxGeometry(1, 1, 1));
  l.createBucket(scene, 'b', new THREE.BoxGeometry(1, 1, 1));
  return { scene, l };
}

describe('empty instanced buckets are not drawn', () => {
  it('should be born invisible', () => {
    // 新生的空桶就該是不可見的，不該依賴稍後某個 reset 幫它補。
    const { l } = layer();
    expect(l.meshFor('a')!.visible).toBe(false);
    expect(l.meshFor('b')!.visible).toBe(false);
  });

  it('should become visible on the first instance', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    expect(l.meshFor('a')!.visible).toBe(true);
    expect(l.meshFor('b')!.visible, '沒用到的桶被連帶打開').toBe(false);
  });

  it('should go dark again when the last instance leaves', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    l.acquire(scene, 'a', '1,0');
    l.release('0,0');
    expect(l.meshFor('a')!.visible, '還有一個實例就不該關掉').toBe(true);
    l.release('1,0');
    expect(l.meshFor('a')!.visible).toBe(false);
  });

  it('should go dark on reset', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    l.reset();
    expect(l.meshFor('a')!.visible).toBe(false);
  });

  it('should stay visible across a capacity doubling', () => {
    // 倍增會換一個新的 InstancedMesh —— 可見性要跟著搬，否則城市長大到
    // 某個瞬間整桶建築會消失。
    const { scene, l } = layer();
    for (let i = 0; i < 6; i++) l.acquire(scene, 'a', `${i},0`);
    expect(l.countOf('a')).toBe(6);
    expect(l.meshFor('a')!.visible).toBe(true);
  });
});
