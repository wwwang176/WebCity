/**
 * VehicleAnimator — 車輛渲染端動畫的統一介面。
 *
 * Ferry / Metro / 未來的飛機等需要「沿路徑插值 + 特殊動畫」的車輛，
 * 都應實作此介面，使 Game.ts 可以用一致的方式驅動動畫。
 */
export interface VehicleAnimator {
  /**
   * 每幀推進動畫。
   * @param dt    幀間隔（秒）
   * @param speed 遊戲速度倍率（0 = 暫停）
   * @param args  各 animator 自定義的額外參數
   */
  update(dt: number, speed: number, ...args: unknown[]): void;

  /** 釋放內部狀態。 */
  dispose(): void;
}
