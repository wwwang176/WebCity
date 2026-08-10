import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dragToPan } from '../cameraPan';

/**
 * 拖曳平移的換算。
 *
 * 遊戲與展示區共用這一份。展示區原本自己寫了一版，分母寫死 600 —— 那等於
 * 假設畫布高度永遠是 600 px，在別的高度下拖曳速度與游標對不上。遊戲的
 * space + 左鍵那條路徑用的是真實的畫布高度，兩者一直不一致。
 *
 * 正確性的判準只有一條：**游標按住的那一點要黏在游標下面。** 拖曳 N 像素，
 * 世界就該移動「N 像素在目前縮放下代表的距離」，不多不少。
 */
describe('dragToPan', () => {
  it('should keep the grabbed point under the cursor', () => {
    // 視錐 60 格、畫布 600 px → 一格 10 px。拖 100 px 就該走 10 格。
    expect(dragToPan(100, 0, 60, 600).x).toBeCloseTo(-10, 9);
    expect(dragToPan(0, 100, 60, 600).z).toBeCloseTo(-10, 9);
  });

  it('should not depend on a hard-coded canvas height', () => {
    // 同樣的視錐、同樣的拖曳距離，畫布高一倍 → 一像素代表的世界距離減半。
    const tall = dragToPan(100, 0, 60, 1200).x;
    const short = dragToPan(100, 0, 60, 600).x;
    expect(Math.abs(tall), '畫布高度沒有被算進去').toBeCloseTo(Math.abs(short) / 2, 9);
  });

  it('should move the world opposite to the drag, so content follows the cursor', () => {
    expect(dragToPan(100, 0, 60, 600).x).toBeLessThan(0);
    expect(dragToPan(0, 100, 60, 600).z).toBeLessThan(0);
  });

  it('should move further per pixel when zoomed out', () => {
    // 沒有這個比例，拉遠之後平移會慢到像卡住。
    const near = Math.abs(dragToPan(100, 0, 20, 600).x);
    const far = Math.abs(dragToPan(100, 0, 120, 600).x);
    expect(far).toBeCloseTo(near * 6, 9);
  });

  it('should survive a zero-height canvas', () => {
    // 畫布還沒佈局完時 clientHeight 是 0。除以零會讓相機焦點變成 NaN，
    // 而 NaN 一旦進到 cameraTarget 就再也回不來 —— 畫面整個消失。
    expect(Number.isFinite(dragToPan(100, 0, 60, 0).x), '除以零讓焦點變成 NaN')
      .toBe(true);
  });
});

describe('the game wires right-drag to pan', () => {
  it('should handle the right button in mousemove', () => {
    // `Game.ts` 原本有這一段：
    //
    //     if (e.button === 2) {
    //       // Right-click camera pan handled in mousemove
    //     }
    //
    // 空的 if，註解宣稱在 mousemove 處理 —— 而 mousemove 裡只有中鍵
    // (buttons & 4) 與 space + 左鍵 (buttons & 1)，右鍵從來沒有被接上。
    // 功能只存在於註解裡（BUG-236）。
    const src = readFileSync(new URL('../../Game.ts', import.meta.url), 'utf8');
    expect(src, 'mousemove 沒有處理右鍵').toContain('e.buttons & 2');
    expect(src, '還留著那個空的 if (e.button === 2)')
      .not.toContain('// Right-click camera pan handled in mousemove');
  });

  it('should use the shared pan conversion, not its own arithmetic', () => {
    // 遊戲自己再寫一次除法就是第三份會漂移的算式。
    const src = readFileSync(new URL('../../Game.ts', import.meta.url), 'utf8');
    expect(src, '遊戲沒有用共用的換算').toContain('dragToPan(');
  });
});
