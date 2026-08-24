import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dragToPan } from '../cameraPan';

/**
 * The drag-to-pan conversion.
 *
 * The game and the showcase share this one function. A second copy in the showcase hardcoded 600 as
 * the denominator, which assumes the canvas is always 600 px tall and desynchronises the drag from
 * the cursor at any other height, while the game's space + left button path used the real canvas
 * height.
 *
 * There is one criterion for correctness: **the point under the cursor stays under the cursor.** Drag
 * N pixels and the world moves by whatever distance N pixels represents at the current zoom, no more
 * and no less.
 */
describe('dragToPan', () => {
  it('should keep the grabbed point under the cursor', () => {
    // A 60-cell frustum over a 600 px canvas is 10 px per cell, so a 100 px drag moves 10 cells.
    expect(dragToPan(100, 0, 60, 600).x).toBeCloseTo(-10, 9);
    expect(dragToPan(0, 100, 60, 600).z).toBeCloseTo(-10, 9);
  });

  it('should not depend on a hard-coded canvas height', () => {
    // Same frustum and same drag, twice the canvas height: one pixel represents half the world
    // distance.
    const tall = dragToPan(100, 0, 60, 1200).x;
    const short = dragToPan(100, 0, 60, 600).x;
    expect(Math.abs(tall), '畫布高度沒有被算進去').toBeCloseTo(Math.abs(short) / 2, 9);
  });

  it('should move the world opposite to the drag, so content follows the cursor', () => {
    expect(dragToPan(100, 0, 60, 600).x).toBeLessThan(0);
    expect(dragToPan(0, 100, 60, 600).z).toBeLessThan(0);
  });

  it('should move further per pixel when zoomed out', () => {
    // Without this proportion, panning while zoomed out is slow enough to feel stuck.
    const near = Math.abs(dragToPan(100, 0, 20, 600).x);
    const far = Math.abs(dragToPan(100, 0, 120, 600).x);
    expect(far).toBeCloseTo(near * 6, 9);
  });

  it('should survive a zero-height canvas', () => {
    // clientHeight is 0 before the canvas has been laid out. Dividing by zero turns the camera
    // target into NaN, and NaN in cameraTarget never comes back out: the view disappears entirely.
    expect(Number.isFinite(dragToPan(100, 0, 60, 0).x), '除以零讓焦點變成 NaN')
      .toBe(true);
  });
});

describe('the game wires right-drag to pan', () => {
  it('should handle the right button in mousemove', () => {
    // `Game.ts` must not carry an empty `if (e.button === 2)` whose comment claims the pan is
    // handled in mousemove: mousemove handles only the middle button (buttons & 4) and space + left
    // (buttons & 1), so the right button was never wired up and the feature existed only in the
    // comment (BUG-236).
    const src = readFileSync(new URL('../../Game.ts', import.meta.url), 'utf8');
    expect(src, 'mousemove 沒有處理右鍵').toContain('e.buttons & 2');
    expect(src, '還留著那個空的 if (e.button === 2)')
      .not.toContain('// Right-click camera pan handled in mousemove');
  });

  it('should use the shared pan conversion, not its own arithmetic', () => {
    // A division written again in the game is a third copy of the formula, free to drift.
    const src = readFileSync(new URL('../../Game.ts', import.meta.url), 'utf8');
    expect(src, '遊戲沒有用共用的換算').toContain('dragToPan(');
  });
});
