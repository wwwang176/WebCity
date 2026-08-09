/**
 * 遠景時要不要畫矮物件與懸挑。
 *
 * 鏡頭是正交的，所以沒有「遠處的建築」—— 全畫面同一個距離，逐棟算距離
 * 沒有意義。唯一有效的訊號是視錐高度（`camera.top - camera.bottom`，單位是
 * 格；`zoomCamera` 的範圍是 3–200）。整件事因此只是一個全域布林翻兩層的
 * `visible`：零逐實例成本，不需要簡化幾何，也不需要每幀掃格子。
 *
 * 自成一個模組而不是留在 `BuildingRenderer` 裡：展示區也要用同一套門檻，
 * 而它畫的是普通 `Mesh`、刻意不載入遊戲。從 `BuildingRenderer` 匯入會把
 * `Grid` 與整個渲染器拖進展示區的相依圖。這裡不 import Three.js，是純算術。
 *
 * 各寫一份的下場已經示範過了 —— 展示區的地板顏色（BUG-231）。
 */

export const DETAIL_LOD = {
  /**
   * 一格 12 m，視錐 90 格 = 1080 m。1080p 的畫面上 1 公尺剛好約一像素，
   * 而矮物件多半是 1–4 m 的東西 —— 過了這條線它們本來就只是雜訊，但仍然
   * 吃滿三角形（單棟上限 320，量體才 400/800）而且每一個都要投影。
   */
  HIDE_ABOVE: 90,
  /**
   * 兩條線之間留 15 格的遲滯。只有一條的話，滾輪停在門檻上會讓整層每幀
   * 開關一次 —— 那比不做還糟，因為畫面在閃。預設視錐是 60，落在這條線
   * 以下，所以正常遊玩看得到全部細節，要主動縮出去才會掉。
   */
  SHOW_BELOW: 75,
} as const;

/**
 * 這個視錐高度下該不該藏細節。`wasHidden` 是上一幀的答案 —— 遲滯需要它，
 * 所以這個函式對同一個輸入會給出兩種答案，那是刻意的。
 */
export function detailHidden(frustumHeight: number, wasHidden: boolean): boolean {
  return wasHidden
    ? frustumHeight >= DETAIL_LOD.SHOW_BELOW
    : frustumHeight > DETAIL_LOD.HIDE_ABOVE;
}
