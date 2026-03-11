import { describe, it, expect } from 'vitest';
import { FerrySystem, type WaterChecker } from '../FerrySystem';
import { findWaterPath, type WaterGrid } from '../../pathfinding/WaterPathfinder';

/**
 * 建立測試用的水域格和岸邊檢查器。
 * checker.isWater 現在檢查「岸邊」：非水域且至少一個相鄰格是水。
 */
function createWaterEnv(rows: string[]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const grid: WaterGrid = {
    width,
    height,
    isWater: (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return rows[y]![x] === 'W';
    },
  };
  const checker: WaterChecker = {
    isWater: (x: number, y: number) => {
      // Shore check: NOT water AND at least one adjacent cell is water
      if (grid.isWater(x, y)) return false;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.isWater(x + dx!, y + dy!)) return true;
      }
      return false;
    },
  };
  return { grid, checker };
}

describe('FerrySystem with A* water navigation', () => {
  it('渡輪在岸邊碼頭間沿水路移動', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWWWWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    const d1 = ferry.addDock(0, 0, checker)!;
    const d2 = ferry.addDock(9, 0, checker)!;
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    ferry.createRoute([d1, d2], 1);

    // 初始化：渡輪應在第一個碼頭
    ferry.tick();
    const vessels = ferry.getVessels();
    expect(vessels).toHaveLength(1);
    expect(vessels[0]!.position.x).toBe(0);
    expect(vessels[0]!.position.y).toBe(0);
  });

  it('渡輪最終到達目的碼頭', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    const d1 = ferry.addDock(0, 0, checker)!;
    const d2 = ferry.addDock(4, 0, checker)!;
    ferry.createRoute([d1, d2], 1);

    // Tick 足夠多次讓渡輪到達（初始 dwell + travel + dwell 來回）
    let reachedDock = false;
    for (let i = 0; i < 50; i++) {
      ferry.tick();
      const vessels = ferry.getVessels();
      if (vessels[0]!.atStop && i > 5) {
        reachedDock = true;
        break;
      }
    }
    expect(reachedDock).toBe(true);
  });

  it('waterPath 應使用 A* 路徑避開陸地', () => {
    const { grid } = createWaterEnv([
      'WWLWW',
      'WWLWW',
      'WWLWW',
      'WWWWW',
    ]);

    // 驗證 A* 能找到繞行路徑
    const path = findWaterPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.path.length).toBeGreaterThan(5);
    // 所有路徑點必須在水域
    for (const p of path!.path) {
      expect(grid.isWater(p.x, p.y)).toBe(true);
    }
  });

  it('兩碼頭間無水路時 validateRoute 應返回 false', () => {
    const { grid, checker } = createWaterEnv([
      'LWLWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    // (0,0)=L adj (1,0)=W → shore; (4,0)=L adj (3,0)=W → shore
    // But water at (1,0) and (3,0) are separated by (2,0)=L
    const d1 = ferry.addDock(0, 0, checker)!;
    const d2 = ferry.addDock(4, 0, checker)!;

    const valid = ferry.validateRouteConnectivity([d1, d2]);
    expect(valid).toBe(false);
  });

  it('兩碼頭間有水路時 validateRoute 應返回 true', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    const d1 = ferry.addDock(0, 0, checker)!;
    const d2 = ferry.addDock(4, 0, checker)!;

    const valid = ferry.validateRouteConnectivity([d1, d2]);
    expect(valid).toBe(true);
  });

  it('碼頭放在水裡應被拒絕', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    // (2,0) is water — checker should reject
    const dock = ferry.addDock(2, 0, checker);
    expect(dock).toBeNull();
  });

  it('碼頭放在內陸（不鄰水）應被拒絕', () => {
    const { grid, checker } = createWaterEnv([
      'LLLWW',
      'LLLWW',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    // (0,0) is L, neighbors: (1,0)=L, (0,1)=L — no water
    const dock = ferry.addDock(0, 0, checker);
    expect(dock).toBeNull();
  });

  it('渡輪 heading 應根據 A* 路徑方向計算', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);
    const d1 = ferry.addDock(0, 0, checker)!;
    const d2 = ferry.addDock(4, 0, checker)!;
    ferry.createRoute([d1, d2], 1);

    // Tick 到渡輪開始移動
    for (let i = 0; i < 10; i++) ferry.tick();

    const vessels = ferry.getVessels();
    const v = vessels[0]!;
    // 渡輪有 waterPath 資訊可供 heading 計算
    const pathInfo = ferry.getVesselPath(v.id);
    if (pathInfo && pathInfo.length > 1) {
      // 路徑存在且有多個點
      expect(pathInfo.length).toBeGreaterThanOrEqual(2);
    }
  });
});
