import { describe, it, expect } from 'vitest';
import { findWaterPath, type WaterGrid } from '../WaterPathfinder';

/**
 * 建立測試用的水域網格。
 * 'W' = 水域，'L' = 陸地
 */
function createGrid(rows: string[]): WaterGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  return {
    width,
    height,
    isWater: (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return rows[y]![x] === 'W';
    },
  };
}

describe('WaterPathfinder', () => {
  describe('findWaterPath', () => {
    it('直線水域應找到最短路徑', () => {
      const grid = createGrid([
        'WWWWW',
        'LLLLL',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).not.toBeNull();
      expect(result!.path[0]).toEqual({ x: 0, y: 0 });
      expect(result!.path[result!.path.length - 1]).toEqual({ x: 4, y: 0 });
      expect(result!.path.length).toBe(5); // 0,1,2,3,4
    });

    it('無水路可走時應返回 null', () => {
      const grid = createGrid([
        'WLLLW',
        'LLLLL',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).toBeNull();
    });

    it('起點是岸邊（陸地鄰水）應找到路徑', () => {
      const grid = createGrid([
        'LWWWW',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).not.toBeNull();
      expect(result!.path[0]).toEqual({ x: 0, y: 0 });
      expect(result!.path[result!.path.length - 1]).toEqual({ x: 4, y: 0 });
    });

    it('終點是岸邊（陸地鄰水）應找到路徑', () => {
      const grid = createGrid([
        'WWWWL',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).not.toBeNull();
      expect(result!.path[0]).toEqual({ x: 0, y: 0 });
      expect(result!.path[result!.path.length - 1]).toEqual({ x: 4, y: 0 });
    });

    it('岸邊到岸邊經水域應找到路徑', () => {
      const grid = createGrid([
        'LWWWL',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).not.toBeNull();
      expect(result!.path[0]).toEqual({ x: 0, y: 0 });
      expect(result!.path[result!.path.length - 1]).toEqual({ x: 4, y: 0 });
      expect(result!.path.length).toBe(5);
    });

    it('起點不鄰水應返回 null', () => {
      const grid = createGrid([
        'LLWWW',
        'LLWWW',
      ]);
      // (0,0) is L, neighbors: (1,0)=L, (0,1)=L — no water neighbor
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).toBeNull();
    });

    it('終點不鄰水應返回 null', () => {
      const grid = createGrid([
        'WWWLL',
        'WWWLL',
      ]);
      // (4,0) is L, neighbors: (3,0)=L, (4,1)=L — no water neighbor
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).toBeNull();
    });

    it('起點等於終點應返回單點路徑', () => {
      const grid = createGrid([
        'W',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 0, y: 0 });
      expect(result).not.toBeNull();
      expect(result!.path).toEqual([{ x: 0, y: 0 }]);
      expect(result!.distance).toBe(0);
    });

    it('應繞過陸地找到路徑', () => {
      // 高牆擋在中間，迫使繞行到底部
      const grid = createGrid([
        'WWLWW',
        'WWLWW',
        'WWLWW',
        'WWWWW',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(result).not.toBeNull();
      // 路徑必須繞行，不能直走 5 格
      expect(result!.path.length).toBeGreaterThan(5);
      // 每個路徑點都必須是水域
      for (const p of result!.path) {
        expect(grid.isWater(p.x, p.y)).toBe(true);
      }
    });

    it('8 方向移動：應支援對角線路徑', () => {
      const grid = createGrid([
        'WWWW',
        'LWWW',
        'LLWW',
        'LLLW',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 3, y: 3 });
      expect(result).not.toBeNull();
      // 對角線移動的路徑長度應少於 7（Manhattan distance）
      expect(result!.path.length).toBeLessThanOrEqual(5);
    });

    it('distance 應反映實際路徑距離（對角線為 sqrt(2)）', () => {
      const grid = createGrid([
        'WW',
        'LW',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 });
      expect(result).not.toBeNull();
      expect(result!.distance).toBeCloseTo(Math.SQRT2, 5);
    });

    it('繞島測試：環形水域應找到路徑', () => {
      const grid = createGrid([
        'WWWWW',
        'WLLLW',
        'WLLLW',
        'WLLLW',
        'WWWWW',
      ]);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
      expect(result).not.toBeNull();
      for (const p of result!.path) {
        expect(grid.isWater(p.x, p.y)).toBe(true);
      }
    });

    it('大範圍水域應找到路徑', () => {
      const rows: string[] = [];
      for (let y = 0; y < 20; y++) {
        rows.push('W'.repeat(20));
      }
      const grid = createGrid(rows);
      const result = findWaterPath(grid, { x: 0, y: 0 }, { x: 19, y: 19 });
      expect(result).not.toBeNull();
      // 對角線直走，大約 20 步
      expect(result!.path.length).toBeLessThanOrEqual(25);
    });
  });
});
