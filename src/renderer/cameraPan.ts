/**
 * 拖曳位移換算成相機焦點的位移。遊戲與展示區共用。
 *
 * 正確性的判準只有一條：**游標按住的那一點要黏在游標下面。** 拖曳 N 像素，
 * 世界就該移動「N 像素在目前縮放下代表的距離」—— 所以比例是
 * `視錐高度 / 畫布高度`（一像素幾格），不是任何固定的常數。
 *
 * 展示區原本自己寫了一版，分母寫死 600，等於假設畫布永遠 600 px 高；遊戲的
 * space + 左鍵那條路徑用的是真實高度。同一個手勢兩份算式，而且只有在
 * 600 px 高的視窗裡才會一致。
 */

/**
 * @param dx           水平拖曳的像素數
 * @param dy           垂直拖曳的像素數
 * @param viewSize     正交視錐的高度（格），即 `camera.top - camera.bottom`
 * @param canvasHeight 畫布高度（像素）
 */
export function dragToPan(
  dx: number, dy: number, viewSize: number, canvasHeight: number,
): { x: number; z: number } {
  // 畫布還沒佈局完時 `clientHeight` 是 0。除以零會讓相機焦點變成 NaN，
  // 而 NaN 一旦進到 cameraTarget 就再也回不來 —— 畫面整個消失，也沒有任何
  // 東西會報錯。
  const scale = canvasHeight > 0 ? viewSize / canvasHeight : 0;
  return { x: -dx * scale, z: -dy * scale };
}
