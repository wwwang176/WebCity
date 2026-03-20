# 里程碑與偉大工程 (Milestones & Great Works)

隨著城市成長，玩家解鎖新功能並可建造偉大工程。

---

## 里程碑 (Milestones)

| 里程碑 | 所需人口 | 解鎖內容 |
|--------|---------|---------|
| Tiny Town | 500 | 消防服務、警察、公車 |
| Small City | 1,000 | 高密度區域、地鐵 |
| Growing City | 2,500 | 工業特化 |
| Big City | 5,000 | 城市特化、鐵路 |
| Metropolis | 10,000 | 機場、偉大工程 |
| Megalopolis | 25,000 | 全部解鎖 |

### API

- `getMilestone(population)` — 取得當前最高里程碑
- `getNextMilestone(population)` — 取得下一個里程碑
- `isUnlocked(feature, population)` — 檢查功能是否已解鎖

---

## 偉大工程 (Great Works)

### 工程列表

| 工程 | 所需資金 | 所需人口 | 建造時間 | 幸福加成 | 觀光加成 | 收入加成 |
|------|---------|---------|---------|---------|---------|---------|
| International Airport | $40,000 | 10,000 | 80 ticks | +5 | +30% | +10% |
| Solar Farm | $25,000 | 5,000 | 60 ticks | +3 | 0% | +15% |
| Space Center | $50,000 | 10,000 | 100 ticks | +10 | +20% | +5% |
| Mega Stadium | $30,000 | 5,000 | 50 ticks | +5 | +50% | +10% |

### 建造流程

1. **locked** — 初始狀態，尚未滿足條件
2. **available** — 人口和資金都滿足，可以開始建造
3. **building** — 建造中，每 tick 推進一步
4. **completed** — 完成，獲得永久 buff

### 完成加成 (Completion Buff)

| 加成 | 說明 |
|------|------|
| `happinessBonus` | 全城市幸福度加成 |
| `touristBonus` | 觀光旅客倍率（0.3 = +30%） |
| `revenueBonus` | 收入倍率（0.1 = +10%） |
