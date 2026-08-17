import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * 壓在色塊上的建築，要拿到色塊本來的顏色。
 *
 * 用地與土地價值的資訊在地面上，而建築正好蓋在地面上 —— 蓋滿房子的街廓只看得到
 * 屋頂，看不到腳下那一格是什麼級。（色塊還沒對位的時候看得出來，因為顏色露在建築
 * 的東南邊；對位修好之後就整片被蓋住了。）
 *
 * 所以 `Game` 會把建築也塗一次。塗什麼顏色不能各算各的:兩邊各有一份對照表的話，
 * 改了一邊另一邊就不一樣。這支測試釘住「建築的顏色 === 那一格地面的顏色」。
 */

const W = 16;
const H = 16;

/** 蓋一張圖層，回傳格 (x,y) 那個頂點的顏色（hex）。 */
function groundHex(type: OverlayType, x: number, y: number, value: number): number {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  renderer.setOverlay(type, scene, new Grid(W, H), new Map([[`${x},${y}`, value]]));
  const mesh = (renderer as unknown as { mesh: THREE.Mesh | null }).mesh!;
  const attr = mesh.geometry.getAttribute('color');
  const idx = y * W + x;
  return new THREE.Color().setRGB(attr.getX(idx), attr.getY(idx), attr.getZ(idx)).getHex();
}

describe('colorFor', () => {
  it.each([
    [OverlayType.ZONE, 15],
    [OverlayType.ZONE, 30],
    [OverlayType.ZONE, 45],
    [OverlayType.LAND_VALUE, 10],
    [OverlayType.LAND_VALUE, 55],
    [OverlayType.LAND_VALUE, 100],
    [OverlayType.POLLUTION, 70],
    [OverlayType.CRIME, 40],
  ])('should hand out the same colour the ground gets (%s @ %i)', (type, value) => {
    expect(new OverlayRenderer().colorFor(type, value)).toBe(groundHex(type, 4, 6, value));
  });

  it('should keep two levels apart', () => {
    // 同一張圖層裡不同的值要看得出差別 —— 全部回同一個顏色也能通過上面那條。
    const r = new OverlayRenderer();
    expect(r.colorFor(OverlayType.LAND_VALUE, 10)).not.toBe(r.colorFor(OverlayType.LAND_VALUE, 90));
    expect(r.colorFor(OverlayType.ZONE, 15)).not.toBe(r.colorFor(OverlayType.ZONE, 45));
  });

  it('should clamp out-of-range values instead of wrapping', () => {
    const r = new OverlayRenderer();
    expect(r.colorFor(OverlayType.LAND_VALUE, 200)).toBe(r.colorFor(OverlayType.LAND_VALUE, 100));
    expect(r.colorFor(OverlayType.LAND_VALUE, -50)).toBe(r.colorFor(OverlayType.LAND_VALUE, 0));
  });
});
