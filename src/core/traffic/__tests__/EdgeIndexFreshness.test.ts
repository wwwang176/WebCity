import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * 每幀重建的那張「哪台車在哪條邊上的哪裡」是跟車判斷的唯一依據。它每幀都是重新
 * 配置的，所以現在這件事成立得很自然 —— 這一條守的是**以後**:曾經試過把那些項目
 * 池化重用（每幀省下幾百個短命物件），漏更新一個欄位前車就會在資料上凍結在舊位置，
 * 後車停在一台早就開走的車後面。
 *
 * 那次沒有留下來:`vid` 忘了更新的話沒有任何測試會紅，而代價只有整幀的 8.6%。
 * 這一條至少讓「位置凍結」那種寫法紅得出來。
 */

function straight(n: number): LaneEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    from: {
      id: `p${i}`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `p${i + 1}`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight' as const,
  }));
}

describe('跟車讀到的是這一幀的位置', () => {
  it('should follow a leader that keeps driving away', () => {
    const sim = new TrafficSimulation();
    const route = straight(20);

    // 車型與速度差異是隨機的 —— 釘死，失敗才重現得出來。
    const pin = <T extends { length: number; speedMultiplier: number; stallTime: number }>(v: T): T => {
      v.length = 0.22; v.speedMultiplier = 1; v.stallTime = 0;
      return v;
    };
    const leader = sim.addVehicleOnEdges(route);
    pin(leader);
    leader.edgeProgress = 0.5;
    const follower = pin(sim.addVehicleOnEdges(route));

    for (let f = 0; f < 240; f++) sim.advanceEdgeVehicles(1 / 60);

    // 前車一路開走，後車就該跟著走完好幾條邊。位置資料如果凍結在第一幀，後車會
    // 卡在那台幻影車後面 —— 大約 0.2 格的地方，連第一條邊都出不去。
    expect(follower.edgeIndex, '停在一台其實早就開走的車後面')
      .toBeGreaterThan(2);
    expect(leader.edgeIndex, '前車自己也沒動 —— 這個案例失去意義')
      .toBeGreaterThan(follower.edgeIndex);
  });
});
