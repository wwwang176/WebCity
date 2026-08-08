import { describe, it, expect } from 'vitest';
import { dragToOrbit, dragToPan, wheelToZoom, ORBIT_SENSITIVITY } from '../cameraInput';

/**
 * DOM 接線錯了會完全沒反應，一眼就看得出來；換算算錯只會「怪怪的」——
 * 轉太快、拉遠之後平移慢到像卡住、滾輪方向相反。所以測的是換算。
 */
describe('dragToOrbit', () => {
  it('should turn a rightward drag into a positive angle', () => {
    expect(dragToOrbit(100, 0).angle).toBeGreaterThan(0);
  });

  it('should raise the view when dragging downward', () => {
    // 拖曳方向與仰角相反：往下拖等於把相機抬高，這是等角視角的慣例。
    expect(dragToOrbit(0, 100).elevation).toBeLessThan(0);
    expect(dragToOrbit(0, -100).elevation).toBeGreaterThan(0);
  });

  it('should scale linearly with distance', () => {
    expect(dragToOrbit(200, 0).angle).toBeCloseTo(dragToOrbit(100, 0).angle * 2, 10);
  });

  it('should need a reasonable drag for a quarter turn', () => {
    // 90 度需要多少像素？太靈敏會轉過頭，太鈍會拖到手酸。
    const pixels = (Math.PI / 2) / ORBIT_SENSITIVITY.ANGLE_PER_PIXEL;
    expect(pixels).toBeGreaterThan(120);
    expect(pixels).toBeLessThan(400);
  });

  it('should do nothing when the pointer does not move', () => {
    // toEqual 與 toBe 都會分辨 +0 與 -0（Object.is），而 0 * -0.005 就是 -0。
    // 正負零在這裡毫無意義，所以用近似比較。
    const o = dragToOrbit(0, 0);
    expect(o.angle).toBeCloseTo(0, 10);
    expect(o.elevation).toBeCloseTo(0, 10);
  });
});

describe('dragToPan', () => {
  it('should move the world opposite to the drag, so content follows the cursor', () => {
    expect(dragToPan(100, 0, 60).x).toBeLessThan(0);
    expect(dragToPan(0, 100, 60).z).toBeLessThan(0);
  });

  it('should move further per pixel when zoomed out', () => {
    // 沒有這個比例，拉遠之後平移會慢到像卡住。
    const near = Math.abs(dragToPan(100, 0, 20).x);
    const far = Math.abs(dragToPan(100, 0, 120).x);
    expect(far).toBeGreaterThan(near * 5);
  });
});

describe('wheelToZoom', () => {
  it('should zoom out on a positive deltaY, as browsers report scroll-down', () => {
    expect(wheelToZoom(100)).toBeGreaterThan(0);
    expect(wheelToZoom(-100)).toBeLessThan(0);
  });

  it('should move a sensible amount per notch', () => {
    // 正交視野預設約 60 單位，一格滾輪動 3 單位 = 5%，大約是 20 格走完全程。
    expect(Math.abs(wheelToZoom(100))).toBeGreaterThan(1);
    expect(Math.abs(wheelToZoom(100))).toBeLessThan(10);
  });
});
