import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createShowcaseGround } from '../ground';
import { TERRAIN_COLORS } from '../../renderer/terrainColors';
import { TerrainType } from '../../core/grid/types';

/**
 * 展示區的地板。
 *
 * 它原本是自己挑的一個暗綠 `0x3a4a3a`，而遊戲的地形是 `0x4caf50` 亮綠。
 * 亮度差了一倍，所以**地面貼片的對比在兩邊完全不同** —— 工業區的柏油是
 * shade 0（近黑），壓在遊戲的亮綠上一眼就看得見，壓在展示區的暗綠上幾乎
 * 融進背景。「展示區看到的就是出貨的東西」是它唯一的價值，而那個判斷
 * 在地面這一層本來是失真的。
 */
describe('showcase ground', () => {
  it('should use the same colour as the game terrain', () => {
    const ground = createShowcaseGround(120);
    const mat = ground.material as THREE.MeshLambertMaterial;
    expect(mat.color.getHex()).toBe(TERRAIN_COLORS[TerrainType.PLAIN]);
  });

  it('should use the same lighting model as the game terrain', () => {
    // 顏色一樣但受光模型不同的話，對比一樣是錯的。遊戲的地形是
    // MeshLambertMaterial（帶一張逐格的 DataTexture）。
    const ground = createShowcaseGround(120);
    expect((ground.material as THREE.Material).type).toBe('MeshLambertMaterial');
  });

  it('should lie flat at y = 0 and receive shadow', () => {
    // 貼片層在 y = 0.002，只有 2.4 cm。地板歪一點就會把整片鋪面吃掉。
    const ground = createShowcaseGround(120);
    expect(ground.position.y).toBe(0);
    expect(ground.receiveShadow).toBe(true);
    ground.geometry.computeBoundingBox();
    const b = ground.geometry.boundingBox!;
    expect(b.max.y - b.min.y, '地板不是水平的').toBeCloseTo(0, 9);
  });

  it('should keep the industrial tarmac readable against it', () => {
    // 這一條是整件事的理由，不是額外的講究。工業是唯一用 shade 0 的分區，
    // 而 shader 的 tarmac 是 vec3(0.20, 0.20, 0.21)。地板與它的亮度比
    // 低於 2 的話，那塊鋪面在展示區裡就是看不見的。
    //
    // **兩者不在同一個色彩空間**：`THREE.Color` 的 r/g/b 是線性值，而建築
    // 材質是 ShaderMaterial 且沒有 include colorspace_fragment —— 它寫進
    // framebuffer 的數字直接被當成已編碼的顯示值。所以要先把地板轉回顯示
    // 空間才比得下去。直接比會得到 1.63，而那個數字沒有任何意義。
    const toSRGB = (v: number) =>
      (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    const ground = createShowcaseGround(120);
    const c = (ground.material as THREE.MeshLambertMaterial).color;
    const groundLum = lum(toSRGB(c.r), toSRGB(c.g), toSRGB(c.b));
    expect(groundLum / lum(0.20, 0.20, 0.21), '柏油與地板的亮度太接近')
      .toBeGreaterThan(2);
  });
});
