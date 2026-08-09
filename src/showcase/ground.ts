import * as THREE from 'three';
import { TERRAIN_COLORS } from '../renderer/terrainColors';
import { TerrainType } from '../core/grid/types';

/**
 * 展示區的地板。
 *
 * 顏色與受光模型都必須與遊戲的地形一致，因為**地面貼片是靠對比讀出來的**：
 * 工業區的柏油是 shade 0（近黑 0.20），壓在遊戲的亮綠地形上亮度比是 2.75，
 * 一眼就看得見；壓在展示區原本自己挑的暗綠 `0x3a4a3a` 上只有 1.35，
 * 幾乎融進背景 —— 於是「工業好像沒有鋪面」是展示區獨有的假象。
 *
 * 遊戲的地形是 `MeshLambertMaterial` 配一張逐格的 `DataTexture`。那張貼圖
 * 沒有設 `colorSpace`（也就是線性），而寫進去的值是 `THREE.Color.set(hex)`
 * 轉換過的線性值 —— 所以這裡直接用 `color: hex` 拿到的是同一個線性顏色。
 */
export function createShowcaseGround(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshLambertMaterial({
    color: TERRAIN_COLORS[TerrainType.PLAIN],
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
