import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/**
 * 分區邊界的一條線段。格線座標 —— 格子中心在整數上，所以邊界落在 .5。
 */
export interface OutlineSegment {
  x1: number; y1: number;
  x2: number; y2: number;
}

/** 四個方向的鄰居，以及那個方向上的邊。 */
const SIDES = [
  { dx: 0, dy: -1, ox1: -0.5, oy1: -0.5, ox2: 0.5, oy2: -0.5 },   // 北
  { dx: 0, dy: 1, ox1: -0.5, oy1: 0.5, ox2: 0.5, oy2: 0.5 },      // 南
  { dx: -1, dy: 0, ox1: -0.5, oy1: -0.5, ox2: -0.5, oy2: 0.5 },   // 西
  { dx: 1, dy: 0, ox1: 0.5, oy1: -0.5, ox2: 0.5, oy2: 0.5 },      // 東
] as const;

/**
 * 選取中的分區要畫在地圖上的外框。
 *
 * 畫外框而不是把整區塗亮:分區圖層本來就已經在那些格子上鋪了顏色，再疊一層半透明的
 * 白只會讓那一區看起來褪色，而不是被選中。
 *
 * 一條邊只有在它的另一側不屬於這一區時才畫。挖出來的洞因此會自己被描出來 —— 扣除
 * 模式常常把一區挖成環狀，少了洞的邊界，中間看起來還在選取範圍裡。
 */
export function districtOutline(cells: ReadonlySet<string>): OutlineSegment[] {
  const segments: OutlineSegment[] = [];
  for (const key of cells) {
    const { x, y } = parsePosKeyUnsafe(key);
    for (const s of SIDES) {
      if (cells.has(`${x + s.dx},${y + s.dy}`)) continue;
      segments.push({
        x1: x + s.ox1, y1: y + s.oy1,
        x2: x + s.ox2, y2: y + s.oy2,
      });
    }
  }
  return segments;
}
