import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * 色塊要蓋在它描述的那一格上。
 *
 * 覆蓋層是逐頂點上色的，而頂點落在格子的**角**上 —— 格 (i,j) 的中心在世界座標
 * `(i, ·, j)`（建築、游標、分區外框都是整數），但頂點 (i,j) 原本落在
 * `(i-0.5, ·, j-0.5)`。於是整張色場往 −x、−z 各偏半格，在等角視角下看起來就是
 * 整片往西北挪了半格。
 *
 * 內插造成的糊是另一回事，這裡不管:色塊本來就會在相鄰格之間漸層，而建築壓在
 * 上面時仍然看得出誰是誰。位置錯了就沒得救。
 */

const W = 16;
const H = 16;

function build(type: OverlayType, data: Map<string, number>): THREE.Mesh {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  renderer.setOverlay(type, scene, new Grid(W, H), data);
  const mesh = (renderer as unknown as { mesh: THREE.Mesh | null }).mesh;
  expect(mesh, '覆蓋層沒有建起來，這支測試等於沒測').not.toBeNull();
  return mesh!;
}

/** 有上色的頂點在世界座標的哪裡。 */
function litAt(mesh: THREE.Mesh): { x: number; y: number }[] {
  const pos = mesh.geometry.getAttribute('position');
  const color = mesh.geometry.getAttribute('color');
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (color.itemSize < 4 || color.getW(i) === 0) continue;
    out.push({
      x: pos.getX(i) + mesh.position.x,
      y: pos.getZ(i) + mesh.position.z,
    });
  }
  return out;
}

/** 整張色塊蓋到的世界範圍。 */
function extent(mesh: THREE.Mesh): { minX: number; maxX: number; minY: number; maxY: number } {
  const pos = mesh.geometry.getAttribute('position');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + mesh.position.x;
    const y = pos.getZ(i) + mesh.position.z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

describe('覆蓋層的對位', () => {
  it('should paint the cell the value belongs to, not the corner north-west of it', () => {
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(litAt(mesh)).toEqual([{ x: 3, y: 5 }]);
  });

  it.each([
    [0, 0],
    [W - 1, H - 1],
    [0, H - 1],
    [W - 1, 0],
  ])('should line up at the map corner (%i, %i) too', (cx, cy) => {
    // 四個角是夾邊界的地方 —— 原本 `Math.min(i, w-1)` 把最外圈的頂點折回來，
    // 折的方向就是偏移的來源。
    const mesh = build(OverlayType.POLICE, new Map([[`${cx},${cy}`, 80]]));
    expect(litAt(mesh)).toEqual([{ x: cx, y: cy }]);
  });

  it('should keep every overlay type on the same grid', () => {
    // 所有圖層共用同一段建立程式碼。
    for (const type of [
      OverlayType.DISTRICT, OverlayType.COMMUTE, OverlayType.LAND_VALUE,
      OverlayType.CRIME, OverlayType.GARBAGE, OverlayType.POWER, OverlayType.WATER,
    ]) {
      expect(litAt(build(type, new Map([['7,2', 80]]))), `${type} 沒有對齊`)
        .toEqual([{ x: 7, y: 2 }]);
    }
  });

  it('should not hang over the edge of the map', () => {
    // 把整片往東南推半格也能修好偏移，但那樣色塊會有半格懸在地圖外面 ——
    // 地形只鋪到 w-0.5，多出來的那條會浮在虛空上。
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(extent(mesh)).toEqual({ minX: 0, maxX: W - 1, minY: 0, maxY: H - 1 });
  });

  it('should still give every cell its own vertex', () => {
    // 一格一個頂點。少了就代表有格子共用同一個值，圖層會漏格。
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(mesh.geometry.getAttribute('position').count).toBe(W * H);
  });
});
