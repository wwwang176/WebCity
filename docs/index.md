# WebCity 遊戲機制 Wiki

WebCity 是一款網頁版都市經營模擬遊戲，靈感來自 Cities: Skylines 和 SimCity。

---

## 文件索引

### 核心系統

| 文件 | 說明 |
|------|------|
| [grid-system.md](grid-system.md) | 網格系統 — 世界結構、格子資料、地形、天然資源 |
| [simulation-loop.md](simulation-loop.md) | 模擬迴圈 — 遊戲時鐘、Tick 頻率分層、執行順序、SimulationConstants、SRP 重構 |
| [save-system.md](save-system.md) | 存檔系統 — IndexedDB 存檔、序列化、自動存檔、匯出入、深度驗證 |

### 城市規劃

| 文件 | 說明 |
|------|------|
| [road-system.md](road-system.md) | 道路系統 — 道路類型、建設/拆除、路網圖、統一查詢、增量渲染 |
| [rail-system.md](rail-system.md) | 鐵路系統 — 軌道建設、平交道、火車站 |
| [elevation-system.md](elevation-system.md) | 高架系統 — 多層高架道路/鐵路、斜坡、橋梁、統一道路查詢 |
| [zone-system.md](zone-system.md) | 區域規劃 — 區域類型、密度規則 |
| [district-policy-system.md](district-policy-system.md) | 區域與政策 — 行政區、政策限制、特化加成 |

### 建築與經濟

| 文件 | 說明 |
|------|------|
| [building-system.md](building-system.md) | 建築系統 — 區域建築、基礎設施、成長/升級/廢棄 |
| [economy-system.md](economy-system.md) | 經濟系統 — 稅制、RCI 需求、預算、地價、全球市場、商業可及性 |
| [milestone-greatworks.md](milestone-greatworks.md) | 里程碑與偉大工程 — 功能解鎖、偉大工程建造 |

### 市民

| 文件 | 說明 |
|------|------|
| [citizen-system.md](citizen-system.md) | 市民系統 — 生命週期、教育、幸福度、移民、出生 |

### 服務與設施

| 文件 | 說明 |
|------|------|
| [services-system.md](services-system.md) | 市政服務 — 電力/供水/警察/消防/醫療/教育/垃圾/污水/殯葬/公園/貨運 |

### 交通

| 文件 | 說明 |
|------|------|
| [traffic-system.md](traffic-system.md) | 交通系統 — 車輛、車道圖、壅塞、LaneGraphPathfinder、高速公路外部連線 |
| [transport-system.md](transport-system.md) | 大眾運輸 — 公車/地鐵/鐵路/渡輪/機場、模式選擇 |

### 環境與事件

| 文件 | 說明 |
|------|------|
| [environment-system.md](environment-system.md) | 環境系統 — 污染擴散、天然資源、水流 |
| [climate-disaster-system.md](climate-disaster-system.md) | 氣候與災害 — 四季效果、天災類型與傷害 |

### 新手引導

| 文件 | 說明 |
|------|------|
| [tutorial-system.md](tutorial-system.md) | 新手教程 — 9 步驟互動引導 |

### UI 與視覺化

| 文件 | 說明 |
|------|------|
| [overlay-system.md](overlay-system.md) | 覆蓋層系統 — 電力/供水/交通/污染/地價/犯罪等視覺化 |

### 開發工具

| 文件 | 說明 |
|------|------|
| [debug-viewmode.md](debug-viewmode.md) | 除錯工具與檢視模式 — Debug Panel、ViewMode 透明度 |

---

## 技術架構

- **語言**: TypeScript
- **渲染**: Three.js (3D Low Poly 等角視角)
- **建構工具**: Vite
- **測試**: Vitest (TDD)
- **套件管理**: pnpm
- **多執行緒**: Web Workers (模擬/交通/尋路)
- **資料同步**: SharedArrayBuffer + postMessage
- **UI 框架**: Preact 或 Solid
- **存檔**: IndexedDB

### 架構原則

- **Core 模組禁止 import Three.js** — 純邏輯
- **渲染層單向讀取 Core 狀態**
- **模擬 Tick 與渲染幀脫鉤**
- **TDD 強制** — 所有新功能先寫測試
