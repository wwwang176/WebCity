/**
 * 展示區的滑鼠操作。
 *
 * 遊戲的相機輸入綁在 src/input/ 的整套操作模式裡（工具、選取、拖曳建路），
 * 展示區不需要那些，也不該把它們拉進來。這裡只做三件事：轉、平移、縮放。
 *
 * 換算的數學抽成純函式，因為那是唯一會算錯又看不出來的部分 —— DOM 接線
 * 錯了會完全沒反應，靈敏度算錯只會「怪怪的」。
 */

/** 滑鼠拖曳像素 → 相機轉動弧度。 */
export const ORBIT_SENSITIVITY = {
  /** 每像素的水平轉動（弧度）。100 px 約 46 度。 */
  ANGLE_PER_PIXEL: 0.008,
  /** 每像素的仰角變化（弧度）。方向相反：往下拖 = 視角往上抬。 */
  ELEVATION_PER_PIXEL: -0.005,
} as const;

/** 滾輪一格（deltaY 約 100）對應的正交視野變化量。 */
export const ZOOM_PER_WHEEL_UNIT = 0.03;

/** 拖曳位移換成 orbitCamera 的兩個參數。 */
export function dragToOrbit(dx: number, dy: number): { angle: number; elevation: number } {
  return {
    angle: dx * ORBIT_SENSITIVITY.ANGLE_PER_PIXEL,
    elevation: dy * ORBIT_SENSITIVITY.ELEVATION_PER_PIXEL,
  };
}

/**
 * 拖曳位移換成 panCamera 的兩個參數。
 *
 * 與視野大小成正比：拉遠之後同樣的拖曳距離要走更多世界單位，否則遠看時
 * 平移會慢到像卡住。
 */
export function dragToPan(dx: number, dy: number, viewSize: number): { x: number; z: number } {
  const scale = viewSize / 600;
  return { x: -dx * scale, z: -dy * scale };
}

/** 滾輪 deltaY 換成 zoomCamera 的參數。 */
export function wheelToZoom(deltaY: number): number {
  return deltaY * ZOOM_PER_WHEEL_UNIT;
}

/** SceneManager 中這個模組會用到的部分。 */
export interface CameraTarget {
  orbitCamera(deltaAngle: number, deltaElevation: number): void;
  panCamera(dx: number, dz: number): void;
  zoomCamera(delta: number): void;
  readonly camera: { top: number; bottom: number };
}

/**
 * 接上滑鼠：左鍵拖曳轉動、右鍵（或按住 Shift 的左鍵）拖曳平移、滾輪縮放。
 */
export function attachCameraInput(dom: HTMLElement, scene: CameraTarget): void {
  let dragging: 'orbit' | 'pan' | null = null;
  let lastX = 0;
  let lastY = 0;

  dom.addEventListener('pointerdown', (e) => {
    dragging = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture(e.pointerId);
  });

  dom.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (dragging === 'orbit') {
      const o = dragToOrbit(dx, dy);
      scene.orbitCamera(o.angle, o.elevation);
    } else {
      const viewSize = scene.camera.top - scene.camera.bottom;
      const p = dragToPan(dx, dy, viewSize);
      scene.panCamera(p.x, p.z);
    }
  });

  const stop = (e: PointerEvent) => {
    dragging = null;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  };
  dom.addEventListener('pointerup', stop);
  dom.addEventListener('pointercancel', stop);

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    scene.zoomCamera(wheelToZoom(e.deltaY));
  }, { passive: false });

  // 右鍵是平移，不要跳出瀏覽器選單
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
}
